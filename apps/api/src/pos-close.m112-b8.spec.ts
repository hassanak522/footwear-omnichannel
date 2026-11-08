import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PosService } from './pos';
import { Db } from './db';
import { assertLocation } from './auth';

jest.mock('./auth', () => {
  const actual = jest.requireActual('./auth');
  return { ...actual, assertLocation: jest.fn() };
});

const SHIFT = '34d22509-a4ef-4c7b-b405-ca86e9011f84';
const LOCATION = '0b0cc789-66ce-462b-9f94-f3ab33739975';
const OWNER = '28facca1-2d14-4395-88d2-31d0f6f203ac';

const dec = (n: number) => new Prisma.Decimal(n);

function setup(status = 'OPEN') {
  const shift = {
    id: SHIFT,
    locationId: LOCATION,
    deviceId: 'synthetic-device',
    cashierId: OWNER,
    openingCash: dec(0),
    status,
  };

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    posShift: {
      findUnique: jest.fn().mockResolvedValue(shift),
      update: jest.fn().mockResolvedValue({ ...shift, status: 'CLOSED' }),
    },
    posSale: {
      findMany: jest.fn().mockResolvedValue([
        { status: 'ACCEPTED', tenders: [{ type: 'CASH', amount: dec(8000) }] },
        { status: 'ACCEPTED', tenders: [{ type: 'CASH', amount: dec(3000) }] },
        { status: 'STOCK_CONFLICT', tenders: [] },
      ]),
    },
    drawerMovement: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    posShiftClosingSnapshot: {
      create: jest.fn().mockResolvedValue({ id: 'snapshot' }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit' }),
    },
  };

  const db = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const service = new PosService(db as unknown as Db);
  const principal = (roles: string[], id = OWNER) =>
    ({ id, roles } as any);

  return { tx, db, service, principal };
}

describe('M112-B8 POS shift closure safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (assertLocation as jest.Mock).mockImplementation(() => undefined);
  });

  it('rejects an already CLOSED shift without creating a snapshot', async () => {
    const { tx, service, principal } = setup('CLOSED');

    await expect(
      service.closeShift(SHIFT, { closingCash: 11000 }, principal(['CASHIER']))
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.posShift.update).not.toHaveBeenCalled();
    expect(tx.posShiftClosingSnapshot.create).not.toHaveBeenCalled();
  });

  it('rejects a non-owner cashier', async () => {
    const { tx, service, principal } = setup();

    await expect(
      service.closeShift(
        SHIFT,
        { closingCash: 11000 },
        principal(['CASHIER'], 'different-user')
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.posShift.update).not.toHaveBeenCalled();
    expect(tx.posShiftClosingSnapshot.create).not.toHaveBeenCalled();
  });

  it('rejects cross-branch access', async () => {
    const { tx, service, principal } = setup();

    (assertLocation as jest.Mock).mockImplementation(() => {
      throw new ForbiddenException('Cross-branch access denied');
    });

    await expect(
      service.closeShift(SHIFT, { closingCash: 11000 }, principal(['BRANCH_MANAGER']))
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.posShift.update).not.toHaveBeenCalled();
    expect(tx.posShiftClosingSnapshot.create).not.toHaveBeenCalled();
  });

  it('creates exactly one correct financial snapshot', async () => {
    const { tx, db, service, principal } = setup();

    await service.closeShift(
      SHIFT,
      { closingCash: 11000 },
      principal(['BRANCH_MANAGER'])
    );

    expect(tx.posShift.update).toHaveBeenCalledTimes(1);
    expect(tx.posShiftClosingSnapshot.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);

    const snapshot = tx.posShiftClosingSnapshot.create.mock.calls[0][0].data;

    expect(snapshot.expectedCash.toString()).toBe('11000');
    expect(snapshot.countedCash.toString()).toBe('11000');
    expect(snapshot.variance.toString()).toBe('0');
    expect(snapshot.acceptedSales).toBe(2);
    expect(snapshot.conflictedSales).toBe(1);

    expect((db.$transaction.mock.calls[0] as unknown as any[])[1]).toMatchObject({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('does not proceed to audit if snapshot creation fails', async () => {
    const { tx, service, principal } = setup();

    tx.posShiftClosingSnapshot.create.mockRejectedValue(
      new Error('Synthetic snapshot failure')
    );

    await expect(
      service.closeShift(SHIFT, { closingCash: 11000 }, principal(['BRANCH_MANAGER']))
    ).rejects.toThrow('Synthetic snapshot failure');

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects a second closure after the first closes the shift', async () => {
    const { tx, service, principal } = setup();

    tx.posShift.update.mockImplementation(async ({ data }: any) => {
      const current = await tx.posShift.findUnique.mock.results[0].value;
      Object.assign(current, data);
      return current;
    });

    await service.closeShift(
      SHIFT, { closingCash: 11000 }, principal(['BRANCH_MANAGER'])
    );

    await expect(
      service.closeShift(
        SHIFT, { closingCash: 11000 }, principal(['BRANCH_MANAGER'])
      )
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.posShiftClosingSnapshot.create).toHaveBeenCalledTimes(1);
  });
});

