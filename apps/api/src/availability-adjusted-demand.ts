import {
  BadRequestException, Controller, Get, Query, UseGuards
} from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Db } from './db';
import { JwtAuthGuard, Roles, RolesGuard } from './auth';

class DemandQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  days?: number;
}

@Controller('hq')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AvailabilityAdjustedDemandController {
  constructor(private readonly db: Db) {}

  @Get('availability-adjusted-demand')
  async report(@Query() query: DemandQuery) {
    const days = query.days ?? 7;
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);

    const [balances, sales, snapshots] = await Promise.all([
      this.db.stockBalance.findMany({
        where: {
          location: { type: 'BRANCH', active: true }
        },
        select: {
          locationId: true,
          variantId: true,
          onHand: true,
          quarantined: true,
          reservedOnline: true,
          reservedReplenish: true,
          safetyBuffer: true,
          location: { select: { name: true } },
          variant: { select: { sku: true } }
        }
      }),
      this.db.posSale.findMany({
        where: {
          status: 'ACCEPTED',
          soldAt: { gte: from, lt: to },
          location: { type: 'BRANCH', active: true }
        },
        select: {
          locationId: true,
          lines: {
            select: { variantId: true, quantity: true }
          }
        },
        take: 10001
      }),
      this.db.stockAvailabilitySnapshot.findMany({
        where: { capturedAt: { gte: from, lt: to } },
        select: {
          batchId: true,
          locationId: true,
          variantId: true,
          available: true,
          capturedAt: true
        },
        orderBy: { capturedAt: 'asc' },
        take: 100001
      })
    ]);

    if (sales.length > 10000) {
      throw new BadRequestException(
        'More than 10000 sales. Select a shorter period.'
      );
    }

    if (snapshots.length > 100000) {
      throw new BadRequestException(
        'More than 100000 snapshots. Select a shorter period.'
      );
    }

    const keyOf = (locationId:string, variantId:string) =>
      locationId + ':' + variantId;

    const units = new Map<string, number>();

    for (const sale of sales) {
      for (const line of sale.lines) {
        const key = keyOf(sale.locationId, line.variantId);
        units.set(key, (units.get(key) || 0) + line.quantity);
      }
    }

    const observations = new Map<string, {
      total:number;
      available:number;
      zero:number;
    }>();

    const batchIds = new Set<string>();

    for (const snapshot of snapshots) {
      batchIds.add(snapshot.batchId);

      const key = keyOf(
        snapshot.locationId, snapshot.variantId
      );

      const row = observations.get(key) || {
        total: 0,
        available: 0,
        zero: 0
      };

      row.total++;

      if (snapshot.available > 0) row.available++;
      else row.zero++;

      observations.set(key, row);
    }

    const expectedSnapshots = days * 48;
    const expectedCount = Math.max(1, expectedSnapshots);

    const rows = balances.map(balance => {
      const key = keyOf(
        balance.locationId, balance.variantId
      );

      const soldUnits = units.get(key) || 0;
      const obs = observations.get(key) || {
        total: 0,
        available: 0,
        zero: 0
      };

      const currentAvailable = Math.max(
        0,
        balance.onHand -
        balance.quarantined -
        balance.reservedOnline -
        balance.reservedReplenish -
        balance.safetyBuffer
      );

      const coveragePct = Math.min(
        100,
        100 * obs.total / expectedCount
      );

      const availableObservationPct = obs.total > 0
        ? 100 * obs.available / obs.total
        : null;

      const observedDailySales = soldUnits / days;

      // This estimate is deliberately conservative.
      // It is not a measured lost-sales figure.
      const eligible =
        soldUnits > 0 &&
        obs.total >= 20 &&
        obs.available >= 10 &&
        coveragePct >= 70;

      const availabilityFraction = obs.total > 0
        ? obs.available / obs.total
        : 0;

      const adjustmentMultiplier = eligible
        ? Math.min(2, 1 / availabilityFraction)
        : null;

      const adjustedDailyDemand = adjustmentMultiplier !== null
        ? observedDailySales * adjustmentMultiplier
        : null;

      const potentialSuppressedUnits = adjustedDailyDemand !== null
        ? Math.max(0, adjustedDailyDemand * days - soldUnits)
        : null;

      const confidence = !eligible
        ? 'INSUFFICIENT_DATA'
        : obs.zero === 0
          ? 'OBSERVED_AVAILABLE'
          : 'EXPLORATORY_ESTIMATE';

      return {
        locationId: balance.locationId,
        branchName: balance.location.name,
        variantId: balance.variantId,
        sku: balance.variant.sku,
        currentAvailable,
        soldUnits,
        observedDailySales,
        snapshotObservations: obs.total,
        availableObservations: obs.available,
        zeroObservations: obs.zero,
        coveragePct: Math.round(coveragePct * 100) / 100,
        availableObservationPct:
          availableObservationPct === null
            ? null
            : Math.round(availableObservationPct * 100) / 100,
        adjustmentMultiplier,
        adjustedDailyDemand,
        potentialSuppressedUnits,
        confidence
      };
    });

    const covered = rows.filter(
      r => r.confidence !== 'INSUFFICIENT_DATA'
    );

    return {
      period: {
        from,
        to,
        days,
        timezone: 'UTC',
        toExclusive: true
      },
      summary: {
        skuBranchPairs: rows.length,
        acceptedSales: sales.length,
        snapshotBatches: batchIds.size,
        observedSkuBranchPairs: rows.filter(
          r => r.snapshotObservations > 0
        ).length,
        adjustmentEligiblePairs: covered.length,
        insufficientDataPairs:
          rows.length - covered.length,
        observedZeroReadings: rows.reduce(
          (n, r) => n + r.zeroObservations, 0
        )
      },
      rows,
      notes: [
        'Only accepted, synchronized POS sales are counted.',
        'Snapshot availability is observed at discrete instants.',
        'Expected coverage assumes a 30-minute capture schedule.',
        'Coverage is an approximate count-based indicator, not continuous uptime.',
        'Availability observations are not weighted by elapsed time.',
        'Adjusted demand assumes comparable demand during available and unavailable observations.',
        'The multiplier is capped at 2 and is exploratory, not a validated statistical forecast.',
        'Potential suppressed units are hypothetical, not confirmed lost sales.',
        'A zero-sales SKU cannot receive an adjusted estimate.',
        'Current inventory is not historical inventory.',
        'Historical SKU/branch pairs without a current stock balance are excluded.',
        'No inventory, sales, or financial records are modified.'
      ]
    };
  }
}