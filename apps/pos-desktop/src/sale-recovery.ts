import type { SalePayload } from './global';

export type PendingSale = {
  id: string;
  payload: string;
};

export type RecoveryResult = {
  status: 'ACCEPTED' | 'STOCK_CONFLICT';
  localSaleId: string;
  conflictReason?: string | null;
};

export type RecoveryRequest = (
  path: string,
  method?: string,
  body?: unknown
) => Promise<any>;

export async function recoverPendingSale(
  row: PendingSale,
  registeredDeviceId: string,
  request: RecoveryRequest
): Promise<RecoveryResult> {
  const payload: SalePayload = JSON.parse(row.payload);

  if (!payload.localSaleId || payload.localSaleId !== row.id) {
    throw new Error('Local sale identifier mismatch. Synchronization blocked.');
  }

  if (!payload.deviceId || !payload.shiftId) {
    throw new Error('Incomplete local sale identity. Synchronization blocked.');
  }

  if (payload.deviceId !== registeredDeviceId) {
    throw new Error('Sale belongs to a different POS device. Synchronization blocked.');
  }

  const lookup = await request(
    '/pos/sales/status/' +
      encodeURIComponent(payload.deviceId) + '/' +
      encodeURIComponent(payload.localSaleId)
  );

  if (!lookup || typeof lookup.found !== 'boolean') {
    throw new Error('Invalid recovery response. Local sale preserved.');
  }

  if (lookup.deviceId && lookup.deviceId !== payload.deviceId) {
    throw new Error('Recovery response device mismatch. Local sale preserved.');
  }

  if (lookup.localSaleId && lookup.localSaleId !== row.id) {
    throw new Error('Recovery response sale identifier mismatch.');
  }

  if (lookup.found) {
    if (!lookup.id || lookup.localSaleId !== row.id) {
      throw new Error('Incomplete or mismatched recovery identity. Local sale preserved.');
    }

    if (!['ACCEPTED', 'STOCK_CONFLICT'].includes(lookup.status)) {
      throw new Error('Unexpected recovery status. Local sale preserved.');
    }
  }

  // Status lookup is advisory. The authoritative sync endpoint
  // validates the original payload hash and idempotency key.
  const result = await request('/pos/sales/sync', 'POST', payload);

  if (!result || result.localSaleId !== row.id) {
    throw new Error('Sync response sale identifier mismatch.');
  }

  if (result.status !== 'ACCEPTED' && result.status !== 'STOCK_CONFLICT') {
    throw new Error('Unexpected server status. Local sale preserved.');
  }

  return result as RecoveryResult;
}