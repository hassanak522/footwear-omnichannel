const { recoverPendingSale } = require('../../pos-desktop/src/sale-recovery') as {
  recoverPendingSale: (
    row: { id: string; payload: string },
    deviceId: string,
    request: (...args: any[]) => Promise<any>
  ) => Promise<any>;
};

describe('R5-C17B3 desktop recovery behavior', () => {
  const deviceId = '11111111-1111-4111-8111-111111111111';
  const shiftId = '22222222-2222-4222-8222-222222222222';
  const saleId = '33333333-3333-4333-8333-333333333333';

  const payload = {
    deviceId,
    shiftId,
    localSaleId: saleId,
    soldAt: '2026-11-17T10:00:00.000Z',
    lines: [{ variantId: 'variant-1', quantity: 1, unitPrice: 100 }],
    tenders: [{ type: 'CASH', amount: 100 }],
  };

  const row = () => ({
    id: saleId,
    payload: JSON.stringify(payload),
  });

  it('confirms an existing accepted sale through authoritative sync', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        found: true, id: 'server-sale', localSaleId: saleId,
        status: 'ACCEPTED',
      })
      .mockResolvedValueOnce({
        localSaleId: saleId, status: 'ACCEPTED', duplicate: true,
      });

    await expect(recoverPendingSale(row(), deviceId, request))
      .resolves.toMatchObject({ status: 'ACCEPTED' });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual([
      '/pos/sales/sync', 'POST', payload,
    ]);
  });

  it('preserves the original stock conflict', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        found: true, id: 'server-sale', localSaleId: saleId,
        status: 'STOCK_CONFLICT',
      })
      .mockResolvedValueOnce({
        localSaleId: saleId, status: 'STOCK_CONFLICT',
        conflictReason: 'Insufficient stock',
      });

    await expect(recoverPendingSale(row(), deviceId, request))
      .resolves.toMatchObject({
        status: 'STOCK_CONFLICT',
        conflictReason: 'Insufficient stock',
      });
  });

  it('submits the original payload when the sale is missing', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({
        found: false, deviceId, localSaleId: saleId,
      })
      .mockResolvedValueOnce({
        localSaleId: saleId, status: 'ACCEPTED',
      });

    await recoverPendingSale(row(), deviceId, request);

    expect(request.mock.calls[1][2]).toEqual(payload);
  });

  it('rejects a different local sale ID without a network call', async () => {
    const request = jest.fn();

    await expect(recoverPendingSale({
      id: 'different-id',
      payload: JSON.stringify(payload),
    }, deviceId, request)).rejects.toThrow(
      'Local sale identifier mismatch'
    );

    expect(request).not.toHaveBeenCalled();
  });

  it('rejects another device without a network call', async () => {
    const request = jest.fn();

    await expect(recoverPendingSale(
      row(), 'different-device', request
    )).rejects.toThrow('different POS device');

    expect(request).not.toHaveBeenCalled();
  });

  it('stops when the recovery lookup is unavailable', async () => {
    const request = jest.fn()
      .mockRejectedValue(new Error('Network unavailable'));

    await expect(recoverPendingSale(row(), deviceId, request))
      .rejects.toThrow('Network unavailable');

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid lookup responses without submitting', async () => {
    const request = jest.fn().mockResolvedValue({});

    await expect(recoverPendingSale(row(), deviceId, request))
      .rejects.toThrow('Invalid recovery response');

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched authoritative sync response', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({
        localSaleId: 'wrong-sale',
        status: 'ACCEPTED',
      });

    await expect(recoverPendingSale(row(), deviceId, request))
      .rejects.toThrow('Sync response sale identifier mismatch');
  });

  it('does not accept an unexpected server status', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({
        localSaleId: saleId,
        status: 'UNKNOWN',
      });

    await expect(recoverPendingSale(row(), deviceId, request))
      .rejects.toThrow('Unexpected server status');
  });

  it('does not submit after a lookup identity mismatch', async () => {
    const request = jest.fn().mockResolvedValue({
      found: true,
      id: 'server-sale',
      localSaleId: 'wrong-sale',
      status: 'ACCEPTED',
    });

    await expect(recoverPendingSale(row(), deviceId, request))
      .rejects.toThrow('Recovery response sale identifier mismatch');

    expect(request).toHaveBeenCalledTimes(1);
  });
});
