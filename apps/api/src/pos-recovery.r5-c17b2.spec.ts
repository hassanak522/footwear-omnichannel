import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PosService } from './pos';

describe('R5-C17B2 offline sale recovery status', () => {
  const deviceId = '11111111-1111-4111-8111-111111111111';
  const localSaleId = '22222222-2222-4222-8222-222222222222';
  const locationId = '33333333-3333-4333-8333-333333333333';

  const user = {
    id: 'cashier-test',
    email: 'cashier@example.invalid',
    roles: ['CASHIER'],
    locations: [locationId],
  };

  let service: any;
  let db: any;

  beforeEach(() => {
    db = {
      posDevice: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: deviceId,
          locationId,
        }),
      },
      posSale: {
        findUnique: jest.fn(),
      },
    };

    service = Object.create(PosService.prototype);
    service.db = db;
    service.branchAccess = jest.fn();
  });

  const lookup = () =>
    service.offlineSaleStatus(deviceId, localSaleId, user);

  it('returns an accepted sale without writing to the database', async () => {
    db.posSale.findUnique.mockResolvedValue({
      id: 'server-sale-1',
      localSaleId,
      status: 'ACCEPTED',
      conflictReason: null,
    });

    await expect(lookup()).resolves.toEqual({
      found: true,
      id: 'server-sale-1',
      localSaleId,
      status: 'ACCEPTED',
      conflictReason: null,
    });

    expect(db.posSale.findUnique).toHaveBeenCalledWith({
      where: {
        deviceId_localSaleId: { deviceId, localSaleId },
      },
      select: {
        id: true,
        localSaleId: true,
        status: true,
        conflictReason: true,
      },
    });

    expect(service.branchAccess).toHaveBeenCalledWith(
      user,
      locationId,
    );
  });

  it('returns the original stock conflict', async () => {
    db.posSale.findUnique.mockResolvedValue({
      id: 'server-sale-2',
      localSaleId,
      status: 'STOCK_CONFLICT',
      conflictReason: 'Insufficient stock',
    });

    await expect(lookup()).resolves.toMatchObject({
      found: true,
      status: 'STOCK_CONFLICT',
      conflictReason: 'Insufficient stock',
    });
  });

  it('returns found false when the sale does not exist', async () => {
    db.posSale.findUnique.mockResolvedValue(null);

    await expect(lookup()).resolves.toEqual({
      found: false,
      deviceId,
      localSaleId,
    });
  });

  it('rejects invalid device identifiers', async () => {
    await expect(
      service.offlineSaleStatus('invalid', localSaleId, user),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.posDevice.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('rejects invalid local sale identifiers', async () => {
    await expect(
      service.offlineSaleStatus(deviceId, 'invalid', user),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.posSale.findUnique).not.toHaveBeenCalled();
  });

  it('blocks access to another branch before looking up the sale', async () => {
    service.branchAccess.mockImplementation(() => {
      throw new ForbiddenException('Branch access denied');
    });

    await expect(lookup()).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(db.posSale.findUnique).not.toHaveBeenCalled();
  });

  it('does not perform database writes', async () => {
    db.posSale.findUnique.mockResolvedValue(null);

    await lookup();

    expect(Object.keys(db)).toEqual(['posDevice', 'posSale']);
    expect(db.posDevice.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(db.posSale.findUnique).toHaveBeenCalledTimes(1);
  });
});
