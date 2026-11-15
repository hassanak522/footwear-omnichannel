import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PurchasingController } from './enterprise';

describe('R3-D3 Purchase receipt history', () => {
  const warehouseId = '22222222-2222-4222-8222-222222222222';
  const orderId = '55555555-5555-4555-8555-555555555555';
  const variantId = '44444444-4444-4444-8444-444444444444';

  const admin = {
    id: '11111111-1111-4111-8111-111111111111',
    roles: ['SUPER_ADMIN'],
    locations: [],
  } as any;

  const unauthorized = {
    id: '66666666-6666-4666-8666-666666666666',
    roles: ['WAREHOUSE_MANAGER'],
    locations: ['77777777-7777-4777-8777-777777777777'],
  } as any;

  let db: any;
  let controller: PurchasingController;

  beforeEach(() => {
    db = {
      purchaseOrder: {
        findUnique: jest.fn(),
      },
      stockMovement: {
        findMany: jest.fn(),
      },
    };

    controller = new PurchasingController(db);
  });

  const order = () => ({
    id: orderId,
    reference: 'PO-R3-001',
    warehouseId,
    status: 'SUBMITTED',
    supplier: {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Test Supplier',
    },
    lines: [
      {
        variantId,
        orderedQty: 20,
        receivedQty: 10,
      },
    ],
  });

  it('returns an empty receipt history for an unreceived order', async () => {
    db.purchaseOrder.findUnique.mockResolvedValue({
      ...order(),
      lines: [{
        variantId,
        orderedQty: 20,
        receivedQty: 0,
      }],
    });

    db.stockMovement.findMany.mockResolvedValue([]);

    const result = await controller.receiptHistory(orderId, admin);

    expect(result.receipts).toEqual([]);
    expect(result.totals).toEqual({
      ordered: 20,
      received: 0,
      remaining: 20,
    });
  });

  it('returns multiple receipts grouped by receipt ID', async () => {
    db.purchaseOrder.findUnique.mockResolvedValue(order());

    db.stockMovement.findMany.mockResolvedValue([
      {
        id: 'movement-1',
        variantId,
        quantityDelta: 6,
        createdAt: new Date('2026-11-15T10:00:00Z'),
        metadata: {
          receiptId: 'receipt-1',
          goodQty: 5,
          damagedQty: 1,
        },
      },
      {
        id: 'movement-2',
        variantId,
        quantityDelta: 4,
        createdAt: new Date('2026-11-15T12:00:00Z'),
        metadata: {
          receiptId: 'receipt-2',
          goodQty: 3,
          damagedQty: 1,
        },
      },
    ]);

    const result = await controller.receiptHistory(orderId, admin);

    expect(result.receipts).toHaveLength(2);
    expect(result.receipts[0].receiptId).toBe('receipt-1');
    expect(result.receipts[1].receiptId).toBe('receipt-2');

    expect(result.totals).toEqual({
      ordered: 20,
      received: 10,
      remaining: 10,
    });
  });

  it('reports good and damaged quantities separately', async () => {
    db.purchaseOrder.findUnique.mockResolvedValue(order());

    db.stockMovement.findMany.mockResolvedValue([
      {
        id: 'movement-1',
        variantId,
        quantityDelta: 10,
        createdAt: new Date('2026-11-15T10:00:00Z'),
        metadata: {
          receiptId: 'receipt-1',
          goodQty: 8,
          damagedQty: 2,
        },
      },
    ]);

    const result = await controller.receiptHistory(orderId, admin);
    const line = result.receipts[0].lines[0];

    expect(line.goodQty).toBe(8);
    expect(line.damagedQty).toBe(2);
    expect(line.totalQty).toBe(10);
  });

  it('rejects missing purchase orders', async () => {
    db.purchaseOrder.findUnique.mockResolvedValue(null);

    await expect(
      controller.receiptHistory(orderId, admin),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(db.stockMovement.findMany).not.toHaveBeenCalled();
  });

  it('rejects access to another warehouse', async () => {
    db.purchaseOrder.findUnique.mockResolvedValue(order());

    await expect(
      controller.receiptHistory(orderId, unauthorized),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.stockMovement.findMany).not.toHaveBeenCalled();
  });

  it('queries only supplier receipts for the requested order', async () => {
    db.purchaseOrder.findUnique.mockResolvedValue(order());
    db.stockMovement.findMany.mockResolvedValue([]);

    await controller.receiptHistory(orderId, admin);

    expect(db.stockMovement.findMany).toHaveBeenCalledWith({
      where: {
        locationId: warehouseId,
        referenceType: 'PURCHASE_ORDER',
        referenceId: orderId,
        type: 'SUPPLIER_RECEIPT',
      },
      orderBy: { createdAt: 'asc' },
    });
  });
});