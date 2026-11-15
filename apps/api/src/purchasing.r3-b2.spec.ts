import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PurchasingController } from './enterprise';

describe('R3-B2 Purchasing regression', () => {
  const admin = {
    id: '11111111-1111-4111-8111-111111111111',
    roles: ['SUPER_ADMIN'],
    locations: [],
  } as any;

  const warehouseId = '22222222-2222-4222-8222-222222222222';
  const supplierId = '33333333-3333-4333-8333-333333333333';
  const variantId = '44444444-4444-4444-8444-444444444444';
  const orderId = '55555555-5555-4555-8555-555555555555';

  let db: any;
  let controller: PurchasingController;

  beforeEach(() => {
    db = {
      supplier: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      location: {
        findUniqueOrThrow: jest.fn(),
      },
      purchaseOrder: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $executeRaw: jest.fn(),
    };

    db.$transaction = jest.fn(async (callback: any) => callback(db));

    controller = new PurchasingController(db);
  });

  it('updates an existing supplier', async () => {
    db.supplier.findUnique.mockResolvedValue({
      id: supplierId,
      code: 'SUP-001',
      name: 'Original Supplier',
      active: true,
    });

    db.supplier.update.mockResolvedValue({
      id: supplierId,
      code: 'SUP-001',
      name: 'Updated Supplier',
      active: true,
    });

    const result = await controller.updateSupplier(
      supplierId,
      { name: 'Updated Supplier' },
    );

    expect(result.name).toBe('Updated Supplier');

    expect(db.supplier.update).toHaveBeenCalledWith({
      where: { id: supplierId },
      data: { name: 'Updated Supplier' },
    });
  });

  it('deactivates a supplier', async () => {
    db.supplier.findUnique.mockResolvedValue({
      id: supplierId,
      active: true,
    });

    db.supplier.update.mockResolvedValue({
      id: supplierId,
      active: false,
    });

    const result = await controller.updateSupplier(
      supplierId,
      { active: false },
    );

    expect(result.active).toBe(false);

    expect(db.supplier.update).toHaveBeenCalledWith({
      where: { id: supplierId },
      data: { active: false },
    });
  });

  it('rejects updates to missing suppliers', async () => {
    db.supplier.findUnique.mockResolvedValue(null);

    await expect(
      controller.updateSupplier(supplierId, { name: 'Missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(db.supplier.update).not.toHaveBeenCalled();
  });

  it('rejects purchase orders for inactive suppliers', async () => {
    db.location.findUniqueOrThrow.mockResolvedValue({
      id: warehouseId,
      type: 'WAREHOUSE',
    });

    db.supplier.findUnique.mockResolvedValue({
      id: supplierId,
      active: false,
    });

    await expect(
      controller.order(
        {
          supplierId,
          warehouseId,
          reference: 'PO-R3-TEST-001',
          lines: [
            {
              variantId,
              quantity: 5,
              unitCost: 100,
            },
          ],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('cancels an unreceived purchase order and audits it', async () => {
    db.purchaseOrder.findUnique.mockResolvedValue({
      id: orderId,
      warehouseId,
      status: 'SUBMITTED',
      lines: [
        {
          variantId,
          orderedQty: 10,
          receivedQty: 0,
        },
      ],
    });

    db.purchaseOrder.update.mockResolvedValue({
      id: orderId,
      status: 'CANCELLED',
    });

    const result = await controller.cancelOrder(orderId, admin);

    expect(result.status).toBe('CANCELLED');

    expect(db.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'PURCHASE_ORDER_CANCELLED',
        entityId: orderId,
      }),
    });
  });

  it('prevents cancellation after partial receiving', async () => {
    db.purchaseOrder.findUnique.mockResolvedValue({
      id: orderId,
      warehouseId,
      status: 'SUBMITTED',
      lines: [
        {
          variantId,
          orderedQty: 10,
          receivedQty: 3,
        },
      ],
    });

    await expect(
      controller.cancelOrder(orderId, admin),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(db.purchaseOrder.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('prevents cancelling an already received order', async () => {
    db.purchaseOrder.findUnique.mockResolvedValue({
      id: orderId,
      warehouseId,
      status: 'RECEIVED',
      lines: [
        {
          variantId,
          orderedQty: 10,
          receivedQty: 10,
        },
      ],
    });

    await expect(
      controller.cancelOrder(orderId, admin),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(db.purchaseOrder.update).not.toHaveBeenCalled();
  });
});