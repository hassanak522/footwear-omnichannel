import { Prisma, PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PosService } from './pos';
import { Db } from './db';

const TEST_DB = 'footwear_m115_api_b16z_20261107';
const LOCATION = '8bfeb93a-4081-41ff-9109-057f6d8fe3d6';
const DEVICE = '9142e314-4148-4ae5-bd0f-8cf4dce5f441';
const CASHIER = '24a7bff7-e9c5-4e7d-97dc-f26715f9d7c6';

const db = new PrismaClient();
const service = new PosService(db as unknown as Db);
const principal = {
  id: CASHIER,
  email: 'm115-test-manager@localhost.invalid',
  roles: ['BRANCH_MANAGER'],
  locations: [LOCATION],
};
const createdShifts: string[] = [];
let databaseVerified = false;

async function assertDatabaseIdentity() {
  const result = await db.$queryRaw<Array<{ db: string }>>`
    SELECT current_database() AS db
  `;
  if (result[0]?.db !== TEST_DB) {
    throw new Error(`SAFETY STOP: Integration tests require ${TEST_DB}`);
  }
}

async function createSyntheticShift() {
  if (!databaseVerified) throw new Error('SAFETY STOP: Database not verified');
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
  return db.posShiftClosingSnapshot.count({ where: { shiftId: id } });
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
    await assertDatabaseIdentity();
    await db.$connect();
    const [device, user, location, role, assignment] = await Promise.all([
      db.posDevice.findUnique({ where: { id: DEVICE } }),
      db.user.findUnique({ where: { id: CASHIER } }),
      db.location.findUnique({ where: { id: LOCATION } }),
      db.userRole.findFirst({ where: { userId: CASHIER, role: { code: 'BRANCH_MANAGER' } } }),
      db.userLocation.findFirst({ where: { userId: CASHIER, locationId: LOCATION } }),
    ]);
    if (
      !device?.active || device.locationId !== LOCATION ||
      user?.status !== 'ACTIVE' || !location?.active ||
      !role || !assignment
    ) {
      throw new Error('SAFETY STOP: Synthetic prerequisites invalid');
    }
    databaseVerified = true;
  });

  afterAll(async () => {
    try {
      if (!databaseVerified) return;
      await assertDatabaseIdentity();
      for (const id of createdShifts) {
        await db.$transaction(async tx => {
          await tx.auditLog.deleteMany({
            where: {
              entityType: 'PosShift',
              entityId: id,
              action: 'POS_SHIFT_CLOSED_SNAPSHOT',
            },
          });
          await tx.posShiftClosingSnapshot.deleteMany({ where: { shiftId: id } });
          await tx.posShift.deleteMany({ where: { id } });
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
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const shift = await db.posShift.findUniqueOrThrow({ where: { id } });
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
    await db.posShiftClosingSnapshot.create({
      data: {
        shiftId: id, locationId: LOCATION, deviceId: DEVICE, cashierId: CASHIER,
        openingCash: 0, cashSales: 0, cardSales: 0, otherSales: 0,
        expectedCash: 0, countedCash: 0, variance: 0,
        acceptedSales: 0, conflictedSales: 0, closedAt: new Date(),
      },
    });
    await expect(service.closeShift(id, { closingCash: 0 }, principal)).rejects.toThrow();
    const shift = await db.posShift.findUniqueOrThrow({ where: { id } });
    expect(shift.status).toBe('OPEN');
    expect(shift.closedAt).toBeNull();
    expect(shift.closingCash).toBeNull();
    expect(await snapshotCount(id)).toBe(1);
    expect(await auditCount(id)).toBe(0);
  });

  it('preserves a synthetic financial snapshot', async () => {
    const id = await createSyntheticShift();
    await db.posShiftClosingSnapshot.create({
      data: {
        shiftId: id, locationId: LOCATION, deviceId: DEVICE, cashierId: CASHIER,
        openingCash: 0, cashSales: 11000, cardSales: 0, otherSales: 0,
        expectedCash: 11000, countedCash: 11000, variance: 0,
        acceptedSales: 2, conflictedSales: 1, closedAt: new Date(),
      },
    });
    const snapshot = await db.posShiftClosingSnapshot.findUniqueOrThrow({
      where: { shiftId: id },
    });
    expect(snapshot.expectedCash.toString()).toBe('11000');
    expect(snapshot.countedCash.toString()).toBe('11000');
    expect(snapshot.variance.toString()).toBe('0');
    expect(snapshot.acceptedSales).toBe(2);
    expect(snapshot.conflictedSales).toBe(1);
  });
});