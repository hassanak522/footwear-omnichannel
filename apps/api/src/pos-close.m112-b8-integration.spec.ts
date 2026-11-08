import { Prisma, PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PosService } from './pos';
import { Db } from './db';

const TEST_DB = 'footwear_omnichannel_test';

const LOCATION = '0b0cc789-66ce-462b-9f94-f3ab33739975';
const DEVICE = 'b75f845b-6e99-48ab-9af4-8f7422d52628';
const CASHIER = '28facca1-2d14-4395-88d2-31d0f6f203ac';

const B7_SHIFT = '34d22509-a4ef-4c7b-b405-ca86e9011f84';

const db = new PrismaClient();
const service = new PosService(db as unknown as Db);

const principal = {
  id: CASHIER,
  email: 'm112-manager-a@localhost.invalid',
  roles: ['BRANCH_MANAGER'],
  locations: [LOCATION],
};

const createdShifts: string[] = [];

async function createSyntheticShift() {
  const id = randomUUID();

  await db.posShift.create({
    data: {
      id,
      deviceId: DEVICE,
      locationId: LOCATION,
      cashierId: CASHIER,
      openingCash: new Prisma.Decimal(0),
    },
  });

  createdShifts.push(id);
  return id;
}

async function snapshotCount(id: string) {
  return db.posShiftClosingSnapshot.count({
    where: { shiftId: id },
  });
}

async function auditCount(id: string) {
  return db.auditLog.count({
    where: {
      entityType: 'PosShift',
      entityId: id,
      action: 'POS_SHIFT_CLOSED_SNAPSHOT',
    },
  });
}

describe('M112-B8 PostgreSQL closure integration', () => {
  beforeAll(async () => {
    const result = await db.$queryRaw<Array<{ db: string }>>`
      SELECT current_database() AS db
    `;

    if (result[0]?.db !== TEST_DB) {
      throw new Error(
        'SAFETY STOP: Integration tests require footwear_omnichannel_test'
      );
    }

    await db.$connect();

    const device = await db.posDevice.findUnique({
      where: { id: DEVICE },
    });

    const user = await db.user.findUnique({
      where: { id: CASHIER },
    });

    if (!device?.active || device.locationId !== LOCATION || user?.status !== 'ACTIVE') {
      throw new Error('SAFETY STOP: Synthetic prerequisites invalid');
    }
  });

  afterAll(async () => {
    try {
      for (const id of createdShifts) {
        await db.$transaction(async tx => {
          await tx.auditLog.deleteMany({
            where: {
              entityType: 'PosShift',
              entityId: id,
              action: 'POS_SHIFT_CLOSED_SNAPSHOT',
            },
          });

          await tx.posShiftClosingSnapshot.deleteMany({
            where: { shiftId: id },
          });

          await tx.posShift.deleteMany({
            where: { id },
          });
        });
      }
    } finally {
      await db.$disconnect();
    }
  });

  it('allows exactly one of two concurrent closure attempts', async () => {
    const id = await createSyntheticShift();

    const results = await Promise.allSettled([
      service.closeShift(id, { closingCash: 0 }, principal),
      service.closeShift(id, { closingCash: 0 }, principal),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const shift = await db.posShift.findUniqueOrThrow({
      where: { id },
    });

    expect(shift.status).toBe('CLOSED');
    expect(await snapshotCount(id)).toBe(1);
    expect(await auditCount(id)).toBe(1);
  });

  it('rejects another closure of an already closed shift', async () => {
    const id = await createSyntheticShift();

    await service.closeShift(id, { closingCash: 0 }, principal);

    await expect(
      service.closeShift(id, { closingCash: 0 }, principal)
    ).rejects.toBeInstanceOf(ConflictException);

    expect(await snapshotCount(id)).toBe(1);
    expect(await auditCount(id)).toBe(1);
  });

  it('rolls back the shift update if snapshot insertion fails', async () => {
    const id = await createSyntheticShift();

    const originalCreate = db.posShiftClosingSnapshot.create;

    // Force a real PostgreSQL uniqueness violation by pre-inserting
    // a snapshot for the same synthetic shift.
    await db.posShiftClosingSnapshot.create({
      data: {
        shiftId: id,
        locationId: LOCATION,
        deviceId: DEVICE,
        cashierId: CASHIER,
        openingCash: 0,
        cashSales: 0,
        cardSales: 0,
        otherSales: 0,
        expectedCash: 0,
        countedCash: 0,
        variance: 0,
        acceptedSales: 0,
        conflictedSales: 0,
        closedAt: new Date(),
      },
    });

    await expect(
      service.closeShift(id, { closingCash: 0 }, principal)
    ).rejects.toThrow();

    const shift = await db.posShift.findUniqueOrThrow({
      where: { id },
    });

    expect(shift.status).toBe('OPEN');
    expect(shift.closedAt).toBeNull();
    expect(shift.closingCash).toBeNull();
    expect(await snapshotCount(id)).toBe(1);
    expect(await auditCount(id)).toBe(0);
  });

  it('preserves the original B7 financial snapshot', async () => {
    const snapshot = await db.posShiftClosingSnapshot.findUniqueOrThrow({
      where: { shiftId: B7_SHIFT },
    });

    expect(snapshot.expectedCash.toString()).toBe('11000');
    expect(snapshot.countedCash.toString()).toBe('11000');
    expect(snapshot.variance.toString()).toBe('0');
    expect(snapshot.acceptedSales).toBe(2);
    expect(snapshot.conflictedSales).toBe(1);
  });
});
