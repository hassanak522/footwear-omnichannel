import {
  Controller,
  Get,
  Query,
  BadRequestException,
  UseGuards
} from '@nestjs/common';
import { Db } from './db';
import { JwtAuthGuard, Roles, RolesGuard } from './auth';

@Controller('hq/aging-inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AgingInventoryController {
  constructor(private readonly db: Db) {}

  @Get()
  async list(
    @Query('thresholdDays') rawThreshold?: string,
    @Query('locationId') locationId?: string
  ) {
    const thresholdDays =
      rawThreshold === undefined ? 90 : Number(rawThreshold);

    if (
      !Number.isInteger(thresholdDays) ||
      thresholdDays < 1 ||
      thresholdDays > 3650
    ) {
      throw new BadRequestException(
        'thresholdDays must be an integer from 1 to 3650'
      );
    }

    if (
      locationId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locationId)
    ) {
      throw new BadRequestException('Invalid locationId');
    }

    const now = new Date();
    const cutoff = new Date(
      now.getTime() - thresholdDays * 86400000
    );

    const balances = await this.db.stockBalance.findMany({
      where: {
        onHand: { gt: 0 },
        ...(locationId ? { locationId } : {})
      },
      include: {
        location: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true
          }
        },
        variant: {
          select: {
            id: true,
            sku: true,
            size: true,
            color: true,
            price: true,
            cost: true,
            product: {
              select: {
                title: true
              }
            }
          }
        }
      }
    });

    const locationIds = [...new Set(
      balances.map(b => b.locationId)
    )];

    const variantIds = [...new Set(
      balances.map(b => b.variantId)
    )];

    if (!balances.length) {
      return {
        generatedAt: now.toISOString(),
        thresholdDays,
        summary: {
          candidates: 0,
          units: 0,
          estimatedCostValue: '0.00',
          unknownCostCandidates: 0
        },
        rows: [],
        notes: [
          'No positive stock balances found.'
        ]
      };
    }

    const [receipts, sales] = await Promise.all([
      this.db.stockMovement.groupBy({
        by: ['locationId', 'variantId'],
        where: {
          locationId: { in: locationIds },
          variantId: { in: variantIds },
          quantityDelta: { gt: 0 },
          type: {
            in: [
              'OPENING_BALANCE',
              'SUPPLIER_RECEIPT',
              'TRANSFER_RECEIPT',
              'SALE_RETURN',
              'ADJUSTMENT'
            ]
          }
        },
        _min: {
          createdAt: true
        },
        _max: {
          createdAt: true
        }
      }),
      this.db.posSaleLine.findMany({
        where: {
          variantId: { in: variantIds },
          sale: {
            locationId: { in: locationIds },
            status: 'ACCEPTED'
          }
        },
        select: {
          variantId: true,
          sale: {
            select: {
              locationId: true,
              soldAt: true
            }
          }
        }
      })
    ]);

    const receiptMap = new Map<string, {
      first: Date | null;
      latest: Date | null;
    }>();

    for (const r of receipts) {
      receiptMap.set(
        r.locationId + ':' + r.variantId,
        {
          first: r._min.createdAt,
          latest: r._max.createdAt
        }
      );
    }

    const lastSaleMap = new Map<string, Date>();

    for (const s of sales) {
      const key =
        s.sale.locationId + ':' + s.variantId;

      const existing = lastSaleMap.get(key);

      if (!existing || existing < s.sale.soldAt) {
        lastSaleMap.set(key, s.sale.soldAt);
      }
    }

    const rows = balances.map(b => {
      const key = b.locationId + ':' + b.variantId;
      const receipt = receiptMap.get(key);
      const firstReceipt = receipt?.first ?? null;
      const latestReceipt = receipt?.latest ?? null;
      const lastSale = lastSaleMap.get(key) ?? null;

      const ageDays = firstReceipt
        ? Math.max(0, Math.floor(
            (now.getTime() - firstReceipt.getTime()) /
            86400000
          ))
        : null;

      const daysSinceSale = lastSale
        ? Math.max(0, Math.floor(
            (now.getTime() - lastSale.getTime()) /
            86400000
          ))
        : null;

      const possibleAging =
        ageDays !== null && ageDays >= thresholdDays;

      const noRecentSale =
        !lastSale || lastSale < cutoff;

      const candidate =
        possibleAging && noRecentSale;

      const cost = b.variant.cost?.toNumber() ?? null;

      return {
        locationId: b.locationId,
        location: b.location.name,
        locationCode: b.location.code,
        locationType: b.location.type,
        variantId: b.variantId,
        sku: b.variant.sku,
        product: b.variant.product.title,
        size: b.variant.size,
        color: b.variant.color,
        onHand: b.onHand,
        quarantined: b.quarantined,
        unitPrice: b.variant.price.toString(),
        unitCost: b.variant.cost?.toString() ?? null,
        estimatedCostValue:
          cost === null
            ? null
            : (cost * b.onHand).toFixed(2),
        firstRecordedReceipt: firstReceipt,
        latestRecordedReceipt: latestReceipt,
        lastAcceptedSale: lastSale,
        oldestRecordedAgeDays: ageDays,
        daysSinceLastSale: daysSinceSale,
        possibleAging,
        noRecentSale,
        candidate,
        ageConfidence: 'ESTIMATED',
        reason: !firstReceipt
          ? 'NO_RECEIPT_HISTORY'
          : candidate
            ? 'OLD_RECEIPT_AND_NO_RECENT_SALE'
            : possibleAging
              ? 'OLD_RECEIPT_BUT_RECENT_SALES'
              : 'BELOW_THRESHOLD'
      };
    });

    const candidates = rows.filter(r => r.candidate);

    const knownCost = candidates.reduce(
      (sum, r) =>
        sum + Number(r.estimatedCostValue ?? 0),
      0
    );

    return {
      generatedAt: now.toISOString(),
      thresholdDays,
      summary: {
        candidates: candidates.length,
        units: candidates.reduce(
          (sum, r) => sum + r.onHand,
          0
        ),
        estimatedCostValue: knownCost.toFixed(2),
        unknownCostCandidates: candidates.filter(
          r => r.unitCost === null
        ).length
      },
      rows,
      notes: [
        'Inventory age is estimated from the earliest recorded positive stock movement at each location.',
        'Transfers and adjustments can affect the estimate. Remaining inventory is not tracked by receipt lot.',
        'Candidate status requires both an old recorded receipt and no accepted POS sale within the threshold.',
        'Unsynchronized offline POS sales are not included.',
        'Missing receipt history is not automatically classified as aging.',
        'Cost values use current variant cost, not historical purchase cost.',
        'This endpoint does not change prices or inventory.'
      ]
    };
  }
}