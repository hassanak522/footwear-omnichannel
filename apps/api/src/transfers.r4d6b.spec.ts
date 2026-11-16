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

const ID = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const DEST = '33333333-3333-4333-8333-333333333333';
const VARIANT = '44444444-4444-4444-8444-444444444444';

const admin = {
  id: '55555555-5555-4555-8555-555555555555',
  roles: ['SUPER_ADMIN'],
  locations: [],
} as any;

const destinationManager = {
  ...admin,
  roles: ['BRANCH_MANAGER'],
  locations: [DEST],
};

const outsideManager = {
  ...admin,
  roles: ['BRANCH_MANAGER'],
  locations: [],
};

const cashier = {
  ...admin,
  roles: ['CASHIER'],
  locations: [DEST],
};

const transfer = {
  id: ID,
  sourceId: SOURCE,
  destinationId: DEST,
  status: 'DISPATCHED',
  items: [{
    id: 'line-1',
    variantId: VARIANT,
    requestedQty: 10,
    dispatchedQty: 10,
    receivedQty: 0,
    damagedQty: 0,
    shortageQty: 0,
  }],
};

function detailSetup() {
  const receipts = [
    { id: 'receipt-1', receivedQty: 3, damagedQty: 1 },
    { id: 'receipt-2', receivedQty: 4, damagedQty: 2 },
  ];

  const audit = [
    { id: 'audit-1', action: 'TRANSFER_DISPATCH' },
    { id: 'audit-2', action: 'TRANSFER_RECEIVE' },
  ];

  const db = {
    stockTransfer: {
      findUnique: jest.fn().mockResolvedValue({
        ...transfer,
        receipts,
      }),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue(audit),
    },
  };

  return {
    service: new TransfersService(db as any),
    db,
    receipts,
    audit,
  };
}

function receiptSetup(options: {
  status?: string;
  received?: number;
  damaged?: number;
  prior?: any;
} = {}) {
  const current = {
    ...transfer,
    status: options.status ?? 'DISPATCHED',
    items: [{
      ...transfer.items[0],
      receivedQty: options.received ?? 0,
      damagedQty: options.damaged ?? 0,
    }],
  };

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    stockTransfer: {
      findUnique: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        ...current,
        ...data,
      })),
    },
    stockBalance: {
      upsert: jest.fn().mockResolvedValue({ id: 'balance-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    stockTransferItem: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([{
        ...current.items[0],
        receivedQty: (options.received ?? 0) + 3,
        damagedQty: (options.damaged ?? 0) + 1,
      }]),
    },
    stockTransferReceipt: {
      create: jest.fn().mockResolvedValue({}),
    },
    stockMovement: {
      create: jest.fn().mockResolvedValue({}),
    },
    integrationEvent: {
      findUnique: jest.fn().mockResolvedValue(options.prior ?? null),
      create: jest.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const db = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };

  return {
    service: new TransfersService(db as any),
    db,
    tx,
  };
}

const receiptDto = {
  idempotencyKey: 'r4d6b-receive-0001',
  items: [{
    variantId: VARIANT,
    receivedQty: 3,
    damagedQty: 1,
  }],
};

describe('R4-D6B transfer detail security', () => {
  it('returns receipt and audit history to an authorized manager', async () => {
    const { service, db, receipts, audit } = detailSetup();

    const result = await service.get(ID, destinationManager);

    expect(result.receipts).toEqual(receipts);
    expect(result.audit).toEqual(audit);

    expect(db.stockTransfer.findUnique).toHaveBeenCalledWith({
      where: { id: ID },
      include: {
        items: true,
        source: true,
        destination: true,
        receipts: {
          orderBy: [
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
        },
      },
    });

    expect(db.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        entityType: 'StockTransfer',
        entityId: ID,
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: 200,
    });
  });

  it('denies an outside manager before retrieving audit records', async () => {
    const { service, db } = detailSetup();

    await expect(
      service.get(ID, outsideManager),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('allows a super admin to retrieve transfer history', async () => {
    const { service, db } = detailSetup();

    await service.get(ID, admin);

    expect(db.auditLog.findMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing transfer without querying audit history', async () => {
    const { service, db } = detailSetup();
    db.stockTransfer.findUnique.mockResolvedValue(null);

    await expect(
      service.get(ID, destinationManager),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe('R4-D6B transfer receipt integrity', () => {
  it('records good and damaged quantities once', async () => {
    const { service, tx } = receiptSetup();

    await service.receive(ID, receiptDto, destinationManager);

    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: { id: 'balance-1' },
      data: {
        onHand: { increment: 4 },
        quarantined: { increment: 1 },
        version: { increment: 1 },
      },
    });

    expect(tx.stockTransferReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transferId: ID,
        variantId: VARIANT,
        receivedQty: 3,
        damagedQty: 1,
        idempotencyKey: receiptDto.idempotencyKey,
      }),
    });

    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a receipt exceeding outstanding quantity', async () => {
    const { service, tx } = receiptSetup({
      received: 8,
      damaged: 1,
    });

    await expect(
      service.receive(ID, receiptDto, destinationManager),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockTransferReceipt.create).not.toHaveBeenCalled();
  });

  it('rejects a cashier before opening a transaction', async () => {
    const { service, db } = receiptSetup();

    await expect(
      service.receive(ID, receiptDto, cashier),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects receipt by an outside manager', async () => {
    const { service, tx } = receiptSetup();

    await expect(
      service.receive(ID, receiptDto, outsideManager),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
  });

  it('rejects receiving a transfer in an invalid status', async () => {
    const { service, tx } = receiptSetup({
      status: 'CANCELLED',
    });

    await expect(
      service.receive(ID, receiptDto, destinationManager),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.stockTransferReceipt.create).not.toHaveBeenCalled();
  });

  it('does not duplicate stock movements on an idempotent retry', async () => {
    const prior = {
      source: 'TRANSFER_RECEIVE',
      payload: {
        transferId: ID,
        payload: receiptDto.items,
      },
    };

    const { service, tx } = receiptSetup({
      status: 'PARTIALLY_RECEIVED',
      prior,
    });

    await service.receive(ID, receiptDto, destinationManager);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockTransferReceipt.create).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with different quantities', async () => {
    const prior = {
      source: 'TRANSFER_RECEIVE',
      payload: {
        transferId: ID,
        payload: [{
          variantId: VARIANT,
          receivedQty: 9,
          damagedQty: 0,
        }],
      },
    };

    const { service, tx } = receiptSetup({ prior });

    await expect(
      service.receive(ID, receiptDto, destinationManager),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
});