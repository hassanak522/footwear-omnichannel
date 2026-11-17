'use strict';

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');

const prisma = new PrismaClient();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing');
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const lock = await tx.$queryRaw`
        SELECT pg_try_advisory_xact_lock(514, 14) AS acquired
      `;

      if (!lock[0]?.acquired) {
        return { status: 'SKIPPED_LOCKED' };
      }

      const now = new Date();
      const cutoff = new Date(now.getTime() - 25 * 60 * 1000);

      const recent = await tx.stockAvailabilitySnapshot.findFirst({
        where: { capturedAt: { gte: cutoff } },
        select: { batchId: true, capturedAt: true },
        orderBy: { capturedAt: 'desc' }
      });

      if (recent) {
        return {
          status: 'SKIPPED_RECENT',
          batchId: recent.batchId,
          capturedAt: recent.capturedAt
        };
      }

      const balances = await tx.stockBalance.findMany({
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
          safetyBuffer: true
        }
      });

      if (balances.length === 0) {
        return { status: 'SKIPPED_NO_BALANCES' };
      }

      const batchId = randomUUID();

      const rows = balances.map((b) => ({
        batchId,
        capturedAt: now,
        locationId: b.locationId,
        variantId: b.variantId,
        onHand: b.onHand,
        quarantined: b.quarantined,
        reservedOnline: b.reservedOnline,
        reservedReplenish: b.reservedReplenish,
        safetyBuffer: b.safetyBuffer,
        available: Math.max(
          0,
          b.onHand -
          b.quarantined -
          b.reservedOnline -
          b.reservedReplenish -
          b.safetyBuffer
        )
      }));

      const inserted = await tx.stockAvailabilitySnapshot.createMany({
        data: rows
      });

      if (inserted.count !== rows.length) {
        throw new Error('Snapshot row count mismatch');
      }

      return {
        status: 'CAPTURED',
        batchId,
        capturedAt: now,
        rows: inserted.count
      };
    },
    {
      maxWait: 5000,
      timeout: 60000,
      isolationLevel: 'RepeatableRead'
    }
  );

  console.log(JSON.stringify(result));

  if (result.status === 'SKIPPED_NO_BALANCES') {
    throw new Error('No active branch stock balances');
  }
}

main()
  .catch((error) => {
    console.error('SNAPSHOT_WORKER_FAILED', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });