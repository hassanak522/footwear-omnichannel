import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { TransfersService } from './transfers';

jest.mock('./auth', () => ({
  ...jest.requireActual('./auth'),
  assertLocation: jest.fn((u: any, locationId: string) => {
    if (
      !u.roles.includes('SUPER_ADMIN') &&
      !u.locations.includes(locationId)
    ) {
      throw new ForbiddenException('Location access denied');
    }
  }),
}));

const TRANSFER_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const VARIANT_ID = '33333333-3333-4333-8333-333333333333';

const admin = {
  id: '44444444-4444-4444-8444-444444444444',
  roles: ['SUPER_ADMIN'],
  locations: [],
} as any;

const cashier = {
  ...admin,
  roles: ['CASHIER'],
  locations: [SOURCE_ID],
};

const wrongLocation = {
  ...admin,
  roles: ['WAREHOUSE_MANAGER'],
  locations: [],
};

const dto = {
  idempotencyKey: 'cancel-test-key-0001',
  reason: 'Approved transfer cancelled after review',
};

function setup(
  status = 'APPROVED',
  reserved = 12,
  prior: any = null,
) {
  const transfer = {
    id: TRANSFER_ID,
    sourceId: SOURCE_ID,
    status,
    items: [
      {
        id: 'line-1',
        variantId: VARIANT_ID,
        requestedQty: 5,
      },
    ],
  };

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),

    stockTransfer: {
      findUnique: jest.fn().mockResolvedValue(transfer),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        ...transfer,
        ...data,
      })),
    },

    stockBalance: {
      upsert: jest.fn().mockResolvedValue({
        id: 'balance-1',
        reservedReplenish: reserved,
        onHand: 30,
        reservedOnline: 2,
      }),
      update: jest.fn().mockResolvedValue({}),
    },

    integrationEvent: {
      findUnique: jest.fn().mockResolvedValue(prior),
      create: jest.fn().mockResolvedValue({}),
    },

    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const db = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };

  const service = new TransfersService(db as any);

  return { service, tx, db, transfer };
}

describe('R4-C2 transfer cancellation', () => {
  it('cancels REQUESTED without touching stock', async () => {
    const { service, tx } = setup('REQUESTED');

    const result = await service.cancel(
      TRANSFER_ID,
      dto,
      admin,
    );

    expect(result.status).toBe('CANCELLED');
    expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockTransfer.update).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('releases exactly the approved reservation', async () => {
    const { service, tx } = setup('APPROVED', 12);

    const result = await service.cancel(
      TRANSFER_ID,
      dto,
      admin,
    );

    expect(result.status).toBe('CANCELLED');

    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: { id: 'balance-1' },
      data: {
        reservedReplenish: { decrement: 5 },
        version: { increment: 1 },
      },
    });

    expect(tx.stockBalance.update).toHaveBeenCalledTimes(1);

    expect(tx.integrationEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'TRANSFER_CANCEL',
        idempotencyKey: dto.idempotencyKey,
      }),
    });
  });

  it('does not release stock twice on an idempotent retry', async () => {
    const prior = {
      source: 'TRANSFER_CANCEL',
      payload: {
        transferId: TRANSFER_ID,
        payload: { reason: dto.reason },
      },
    };

    const { service, tx } = setup(
      'CANCELLED',
      7,
      prior,
    );

    const result = await service.cancel(
      TRANSFER_ID,
      dto,
      admin,
    );

    expect(result.status).toBe('CANCELLED');
    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockTransfer.update).not.toHaveBeenCalled();
    expect(tx.integrationEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of a key with a different payload', async () => {
    const prior = {
      source: 'TRANSFER_CANCEL',
      payload: {
        transferId: TRANSFER_ID,
        payload: { reason: 'Different cancellation reason' },
      },
    };

    const { service, tx } = setup(
      'CANCELLED',
      7,
      prior,
    );

    await expect(
      service.cancel(TRANSFER_ID, dto, admin),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
  });

  it.each([
    'DISPATCHED',
    'PARTIALLY_RECEIVED',
    'RECEIVED',
    'SHORTAGE_CLOSED',
    'CANCELLED',
  ])('blocks cancellation in %s status', async status => {
    const { service, tx } = setup(status);

    await expect(
      service.cancel(TRANSFER_ID, dto, admin),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockTransfer.update).not.toHaveBeenCalled();
  });

  it('rejects cancellation when reservation is insufficient', async () => {
    const { service, tx } = setup('APPROVED', 3);

    await expect(
      service.cancel(TRANSFER_ID, dto, admin),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockTransfer.update).not.toHaveBeenCalled();
  });

  it('rejects a short cancellation reason', async () => {
    const { service, tx } = setup();

    await expect(
      service.cancel(
        TRANSFER_ID,
        { ...dto, reason: 'short' },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
  });

  it('rejects cashier cancellation', async () => {
    const { service, db } = setup();

    await expect(
      service.cancel(TRANSFER_ID, dto, cashier),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a manager outside the source location', async () => {
    const { service, tx } = setup();

    await expect(
      service.cancel(TRANSFER_ID, dto, wrongLocation),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
  });
});