import { ConflictException } from '@nestjs/common';
import { StockCountsController } from './enterprise';

describe('R5-C2 stock count posting safeguards', () => {
  const countId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  const variantId = '33333333-3333-4333-8333-333333333333';

  const admin = {
    id: '44444444-4444-4444-8444-444444444444',
    roles: ['SUPER_ADMIN'],
    locations: [],
  };

  function setup(
    status = 'OPEN',
    expectedQty = 10,
    actualQty = 10,
    countedQty = 8
  ) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      stockCount: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: countId,
          locationId,
          status,
          lines: [{
            variantId,
            expectedQty,
            countedQty,
          }],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      stockBalance: {
        upsert: jest.fn().mockResolvedValue({
          id: '55555555-5555-4555-8555-555555555555',
          onHand: actualQty,
          quarantined: 0,
          reservedOnline: 0,
          reservedReplenish: 0,
          safetyBuffer: 0,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      stockMovement: {
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const db = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };

    const controller = new StockCountsController(db as any);

    return { tx, db, controller };
  }

  it('rejects a previously posted count', async () => {
    const { controller, tx } = setup('POSTED');

    await expect(
      controller.post(countId, admin as any)
    ).rejects.toThrow(ConflictException);

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.stockCount.update).not.toHaveBeenCalled();
  });

  it('rejects stale expected stock', async () => {
    const { controller, tx } = setup('OPEN', 10, 12);

    await expect(
      controller.post(countId, admin as any)
    ).rejects.toThrow('Stock changed since count was created');

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.stockCount.update).not.toHaveBeenCalled();
  });

  it('rejects quantities below protected inventory', async () => {
    const { controller, tx } = setup();

    tx.stockBalance.upsert.mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      onHand: 10,
      quarantined: 9,
      reservedOnline: 0,
      reservedReplenish: 0,
      safetyBuffer: 0,
    });

    await expect(
      controller.post(countId, admin as any)
    ).rejects.toThrow('Count below protected inventory');

    expect(tx.stockBalance.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('rejects a user assigned to another location', async () => {
    const { controller, tx } = setup();

    const otherBranch = {
      id: admin.id,
      roles: ['BRANCH_MANAGER'],
      locations: ['66666666-6666-4666-8666-666666666666'],
    };

    await expect(
      controller.post(countId, otherBranch as any)
    ).rejects.toThrow();

    expect(tx.stockBalance.upsert).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('posts a valid variance with an audit record', async () => {
    const { controller, tx } = setup();

    const result = await controller.post(countId, admin as any);

    expect(result).toEqual({ id: countId, status: 'POSTED' });
    expect(tx.stockBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          onHand: 8,
          version: { increment: 1 },
        },
      })
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantityDelta: -2,
          referenceType: 'STOCK_COUNT',
          referenceId: countId,
        }),
      })
    );
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});