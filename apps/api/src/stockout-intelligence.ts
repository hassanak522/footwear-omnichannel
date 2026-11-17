import {
  Controller, Get, Query, UseGuards,
  BadRequestException
} from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Db } from './db';
import { JwtAuthGuard, RolesGuard, Roles } from './auth';

class StockoutQuery {
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
export class StockoutIntelligenceController {
  constructor(private readonly db: Db) {}

  @Get('stockout-intelligence')
  async report(@Query() query: StockoutQuery) {
    const days = query.days ?? 7;
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);

    const [locations, balances, snapshots] = await Promise.all([
      this.db.location.findMany({
        where: { type: 'BRANCH', active: true },
        select: { id: true, name: true }
      }),
      this.db.stockBalance.findMany({
        where: {
          location: { type: 'BRANCH', active: true }
        },
        select: {
          locationId: true,
          variantId: true,
          variant: { select: { sku: true } }
        }
      }),
      this.db.stockAvailabilitySnapshot.findMany({
        where: { capturedAt: { gte: from, lt: to } },
        select: {
          batchId: true,
          locationId: true,
          variantId: true,
          capturedAt: true,
          available: true
        },
        orderBy: { capturedAt: 'asc' },
        take: 100001
      })
    ]);

    if (snapshots.length > 100000) {
      throw new BadRequestException(
        'Too many observations. Choose a shorter period.'
      );
    }

    const names = new Map(locations.map(l => [l.id, l.name]));
    const skus = new Map(
      balances.map(b => [
        b.locationId + ':' + b.variantId,
        b.variant.sku
      ])
    );

    const grouped = new Map<string, typeof snapshots>();

    for (const s of snapshots) {
      const key = s.locationId + ':' + s.variantId;
      const group = grouped.get(key) || [];
      group.push(s);
      grouped.set(key, group);
    }

    const rows = [...grouped.entries()].map(([key, items]) => {
      const first = items[0];
      let consecutiveZeroPairs = 0;

      for (let i = 1; i < items.length; i++) {
        const gap =
          items[i].capturedAt.getTime() -
          items[i - 1].capturedAt.getTime();

        if (
          items[i].available === 0 &&
          items[i - 1].available === 0 &&
          gap > 0 &&
          gap <= 45 * 60000
        ) {
          consecutiveZeroPairs++;
        }
      }

      const zeroObservations =
        items.filter(s => s.available === 0).length;

      return {
        locationId: first.locationId,
        branchName: names.get(first.locationId) || first.locationId,
        variantId: first.variantId,
        sku: skus.get(key) || first.variantId,
        observations: items.length,
        zeroObservations,
        observedStockoutPct:
          Math.round(10000 * zeroObservations / items.length) / 100,
        consecutiveZeroPairs,
        latestAvailable: items[items.length - 1].available,
        latestObservedAt: items[items.length - 1].capturedAt
      };
    });

    const branches = locations.map(l => {
      const branchRows = rows.filter(r => r.locationId === l.id);
      const branchBalances =
        balances.filter(b => b.locationId === l.id);

      return {
        locationId: l.id,
        branchName: l.name,
        inventoryPairs: branchBalances.length,
        observedPairs: branchRows.length,
        unobservedPairs: branchBalances.length -
          branchRows.length,
        zeroObservations: branchRows.reduce(
          (n, r) => n + r.zeroObservations, 0
        ),
        totalObservations: branchRows.reduce(
          (n, r) => n + r.observations, 0
        )
      };
    });

    const batches = new Set(snapshots.map(s => s.batchId));

    return {
      period: { from, to, days },
      summary: {
        activeBranches: locations.length,
        inventoryPairs: balances.length,
        observedPairs: rows.length,
        snapshotBatches: batches.size,
        totalObservations: snapshots.length,
        zeroObservations: rows.reduce(
          (n, r) => n + r.zeroObservations, 0
        ),
        repeatedZeroPairs: rows.reduce(
          (n, r) => n + r.consecutiveZeroPairs, 0
        )
      },
      branches,
      rows: rows.sort(
        (a, b) =>
          b.zeroObservations - a.zeroObservations ||
          b.consecutiveZeroPairs - a.consecutiveZeroPairs
      ),
      notes: [
        'Zero availability is observed only at capture time.',
        'Repeated zero readings do not prove continuous stockout.',
        'Missing stock balances are not counted as available inventory.',
        'Snapshot batches are counted across the requested period.',
        'No lost-sales estimate is calculated.',
        'Inventory balances and historical snapshots are never modified.'
      ]
    };
  }
}