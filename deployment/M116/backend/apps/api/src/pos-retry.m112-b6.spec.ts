import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { withPosTransactionRetry } from './pos';

function p2034() {
  return new Prisma.PrismaClientKnownRequestError(
    'Synthetic write conflict',
    {
      code: 'P2034',
      clientVersion: 'test',
    },
  );
}

describe('M112-B8I-05M-B6 POS transaction retry', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    jest.spyOn(global, 'setTimeout').mockImplementation(
      ((callback: (...args: unknown[]) => void) => {
        callback();
        return {} as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries transient P2034 and succeeds', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(p2034())
      .mockRejectedValueOnce(p2034())
      .mockResolvedValueOnce('SUCCESS');

    await expect(
      withPosTransactionRetry(operation),
    ).resolves.toBe('SUCCESS');

    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('returns HTTP 409 after six P2034 failures', async () => {
    const operation = jest.fn().mockImplementation(
      async () => { throw p2034(); },
    );

    await expect(
      withPosTransactionRetry(operation),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(operation).toHaveBeenCalledTimes(6);
  });

  it('does not retry non-P2034 errors', async () => {
    const failure = new Error('Synthetic non-retryable failure');
    const operation = jest.fn().mockRejectedValue(failure);

    await expect(
      withPosTransactionRetry(operation),
    ).rejects.toBe(failure);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not retry other Prisma errors', async () => {
    const failure = new Prisma.PrismaClientKnownRequestError(
      'Synthetic Prisma failure',
      {
        code: 'P2002',
        clientVersion: 'test',
      },
    );

    const operation = jest.fn().mockRejectedValue(failure);

    await expect(
      withPosTransactionRetry(operation),
    ).rejects.toBe(failure);

    expect(operation).toHaveBeenCalledTimes(1);
  });
});