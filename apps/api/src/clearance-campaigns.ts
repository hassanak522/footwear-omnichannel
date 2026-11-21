import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from './db';
import {
  CurrentUser,
  JwtAuthGuard,
  Principal,
  Roles,
  RolesGuard
} from './auth';

type CampaignInput = {
  code: string;
  title: string;
  description?: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  startsAt: string;
  endsAt: string;
  variantIds: string[];
  branchIds: string[];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('hq/clearance-campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class ClearanceCampaignController {
  constructor(private readonly db: Db) {}

  private effectiveStatus(c: {
    status: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    if (c.status === 'CANCELLED') return 'CANCELLED';
    if (c.status === 'DRAFT') return 'DRAFT';

    const now = new Date();

    if (c.endsAt <= now) return 'EXPIRED';
    if (c.startsAt > now) return 'SCHEDULED';

    return 'ACTIVE';
  }

  private validate(input: CampaignInput) {
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Campaign data required');
    }

    if (
      typeof input.code !== 'string' ||
      !/^[A-Z0-9_-]{3,50}$/.test(input.code.trim().toUpperCase())
    ) {
      throw new BadRequestException('Invalid campaign code');
    }

    if (
      typeof input.title !== 'string' ||
      input.title.trim().length < 3 ||
      input.title.trim().length > 150
    ) {
      throw new BadRequestException('Invalid campaign title');
    }

    if (
      input.description !== undefined &&
      (typeof input.description !== 'string' ||
       input.description.length > 1000)
    ) {
      throw new BadRequestException('Invalid description');
    }

    if (!['PERCENT', 'FIXED'].includes(input.type)) {
      throw new BadRequestException('Invalid discount type');
    }

    if (
      typeof input.value !== 'number' ||
      !Number.isFinite(input.value) ||
      input.value <= 0 ||
      input.value > 100000000 ||
      Math.round(input.value * 100) !== input.value * 100
    ) {
      throw new BadRequestException('Invalid discount value');
    }

    if (input.type === 'PERCENT' && input.value > 100) {
      throw new BadRequestException(
        'Percentage cannot exceed 100'
      );
    }

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      endsAt <= startsAt
    ) {
      throw new BadRequestException('Invalid campaign dates');
    }

    const validIds = (ids: unknown): ids is string[] =>
      Array.isArray(ids) &&
      ids.length > 0 &&
      ids.length <= 1000 &&
      ids.every(id =>
        typeof id === 'string' && uuidPattern.test(id)
      ) &&
      new Set(ids).size === ids.length;

    if (!validIds(input.variantIds)) {
      throw new BadRequestException(
        'Select valid, unique footwear variants'
      );
    }

    if (!validIds(input.branchIds)) {
      throw new BadRequestException(
        'Select valid, unique retail branches'
      );
    }

    return { startsAt, endsAt };
  }

  @Get()
  async list() {
    const campaigns = await this.db.clearanceCampaign.findMany({
      include: {
        variants: true,
        branches: true
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    return campaigns.map(c => ({
      ...c,
      effectiveStatus: this.effectiveStatus(c),
      value: c.value.toString()
    }));
  }

  @Get('eligible')
  async eligible(
    @Query('variantId') variantId?: string,
    @Query('locationId') locationId?: string
  ) {
    if (
      !variantId ||
      !locationId ||
      !uuidPattern.test(variantId) ||
      !uuidPattern.test(locationId)
    ) {
      throw new BadRequestException(
        'Valid variantId and locationId required'
      );
    }

    const now = new Date();

    const campaigns = await this.db.clearanceCampaign.findMany({
      where: {
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
        variants: { some: { variantId } },
        branches: { some: { locationId } }
      },
      orderBy: { createdAt: 'asc' }
    });

    return {
      variantId,
      locationId,
      campaigns: campaigns.map(c => ({
        id: c.id,
        code: c.code,
        title: c.title,
        type: c.type,
        value: c.value.toString(),
        endsAt: c.endsAt
      })),
      checkoutEnabled: false,
      warning:
        'Eligibility only. Checkout must independently validate and calculate the discount.'
    };
  }

  @Post()
  async create(
    @CurrentUser() user: Principal,
    @Body() input: CampaignInput
  ) {
    const { startsAt, endsAt } = this.validate(input);

    const [variants, branches] = await Promise.all([
      this.db.productVariant.findMany({
        where: {
          id: { in: input.variantIds },
          active: true,
          product: { active: true }
        },
        select: { id: true }
      }),
      this.db.location.findMany({
        where: {
          id: { in: input.branchIds },
          type: 'BRANCH',
          active: true
        },
        select: { id: true }
      })
    ]);

    if (variants.length !== input.variantIds.length) {
      throw new BadRequestException(
        'One or more variants are invalid or inactive'
      );
    }

    if (branches.length !== input.branchIds.length) {
      throw new BadRequestException(
        'One or more branches are invalid or inactive'
      );
    }

    try {
      return await this.db.$transaction(async tx => {
        const campaign = await tx.clearanceCampaign.create({
          data: {
            code: input.code.trim().toUpperCase(),
            title: input.title.trim(),
            description: input.description?.trim(),
            type: input.type,
            value: new Prisma.Decimal(input.value),
            startsAt,
            endsAt,
            createdById: user.id,
            variants: {
              create: input.variantIds.map(variantId => ({
                variantId
              }))
            },
            branches: {
              create: input.branchIds.map(locationId => ({
                locationId
              }))
            }
          }
        });

        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: 'CLEARANCE_CAMPAIGN_CREATED',
            entityType: 'ClearanceCampaign',
            entityId: campaign.id,
            after: {
              code: campaign.code,
              type: input.type,
              value: input.value,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              variantIds: input.variantIds,
              branchIds: input.branchIds
            }
          }
        });

        return {
          id: campaign.id,
          code: campaign.code,
          status: campaign.status
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Campaign code already exists'
        );
      }

      throw error;
    }
  }

  @Post(':id/activate')
  async activate(
    @CurrentUser() user: Principal,
    @Param('id') id: string
  ) {
    if (!uuidPattern.test(id)) {
      throw new BadRequestException('Invalid campaign ID');
    }

    return this.db.$transaction(async tx => {
      const campaign = await tx.clearanceCampaign.findUnique({
        where: { id }
      });

      if (!campaign || campaign.status !== 'DRAFT') {
        throw new ConflictException(
          'Only draft campaigns can be activated'
        );
      }

      if (campaign.endsAt <= new Date()) {
        throw new ConflictException(
          'Campaign has already expired'
        );
      }

      const updated = await tx.clearanceCampaign.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'ACTIVE' }
      });

      if (updated.count !== 1) {
        throw new ConflictException('Campaign status changed');
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'CLEARANCE_CAMPAIGN_ACTIVATED',
          entityType: 'ClearanceCampaign',
          entityId: id,
          before: { status: 'DRAFT' },
          after: { status: 'ACTIVE' }
        }
      });

      return {
        id,
        status: this.effectiveStatus({
          status: 'ACTIVE',
          startsAt: campaign.startsAt,
          endsAt: campaign.endsAt
        })
      };
    });
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentUser() user: Principal,
    @Param('id') id: string
  ) {
    if (!uuidPattern.test(id)) {
      throw new BadRequestException('Invalid campaign ID');
    }

    return this.db.$transaction(async tx => {
      const campaign = await tx.clearanceCampaign.findUnique({
        where: { id }
      });

      if (
        !campaign ||
        !['DRAFT', 'ACTIVE'].includes(campaign.status)
      ) {
        throw new ConflictException(
          'Campaign cannot be cancelled'
        );
      }

      const updated = await tx.clearanceCampaign.updateMany({
        where: { id, status: campaign.status },
        data: { status: 'CANCELLED' }
      });

      if (updated.count !== 1) {
        throw new ConflictException('Campaign status changed');
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'CLEARANCE_CAMPAIGN_CANCELLED',
          entityType: 'ClearanceCampaign',
          entityId: id,
          before: { status: campaign.status },
          after: { status: 'CANCELLED' }
        }
      });

      return { id, status: 'CANCELLED' };
    });
  }
}