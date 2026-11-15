import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CatalogController } from './catalog';
import { Db } from './db';

describe('R2-B2 Catalog editing', () => {
  let controller: CatalogController;
  let productFind: jest.Mock;
  let productUpdate: jest.Mock;
  let variantFind: jest.Mock;
  let variantUpdate: jest.Mock;

  beforeEach(() => {
    productFind = jest.fn();
    productUpdate = jest.fn();
    variantFind = jest.fn();
    variantUpdate = jest.fn();

    const db = {
      product: {
        findUnique: productFind,
        update: productUpdate,
      },
      productVariant: {
        findUnique: variantFind,
        update: variantUpdate,
      },
    } as unknown as Db;

    controller = new CatalogController(db);
  });

  it('updates an existing product without replacing its ID', async () => {
    productFind.mockResolvedValue({ id: 'product-1' });
    productUpdate.mockResolvedValue({
      id: 'product-1',
      title: 'Updated Product',
    });

    const result = await controller.updateProduct(
      'product-1',
      { title: 'Updated Product' },
    );

    expect(result.id).toBe('product-1');
    expect(productUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-1' },
        data: { title: 'Updated Product' },
      }),
    );
  });

  it('rejects a missing product', async () => {
    productFind.mockResolvedValue(null);

    await expect(
      controller.updateProduct('missing', { title: 'Test' }),
    ).rejects.toThrow(NotFoundException);

    expect(productUpdate).not.toHaveBeenCalled();
  });

  it('updates a variant without changing its ID', async () => {
    variantFind.mockResolvedValue({ id: 'variant-1' });
    variantUpdate.mockResolvedValue({
      id: 'variant-1',
      price: 2500,
    });

    const result = await controller.updateVariant(
      'variant-1',
      { price: 2500 },
    );

    expect(result.id).toBe('variant-1');
    expect(variantUpdate).toHaveBeenCalledWith({
      where: { id: 'variant-1' },
      data: { price: 2500 },
    });
  });

  it('rejects a missing variant', async () => {
    variantFind.mockResolvedValue(null);

    await expect(
      controller.updateVariant('missing', { price: 100 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects duplicate SKU or barcode constraints', async () => {
    variantFind.mockResolvedValue({ id: 'variant-1' });

    variantUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.19.0' },
      ),
    );

    await expect(
      controller.updateVariant('variant-1', { sku: 'DUPLICATE' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects invalid category or brand references', async () => {
    productFind.mockResolvedValue({ id: 'product-1' });

    productUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        { code: 'P2003', clientVersion: '6.19.0' },
      ),
    );

    await expect(
      controller.updateProduct('product-1', {
        categoryId: '00000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('propagates unexpected database errors', async () => {
    variantFind.mockResolvedValue({ id: 'variant-1' });
    variantUpdate.mockRejectedValue(new Error('Unexpected DB failure'));

    await expect(
      controller.updateVariant('variant-1', { price: 200 }),
    ).rejects.toThrow('Unexpected DB failure');
  });
});