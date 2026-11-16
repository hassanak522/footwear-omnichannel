'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Row = Record<string, any>;
type TransferLine = {
  variantId: string;
  quantity: number;
};

type ReceiptLine = {
  variantId: string;
  receivedQty: number;
  damagedQty: number;
};

const API = '/api/v1';

const panel: React.CSSProperties = {
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  padding: 16,
  marginBottom: 16,
};

const input: React.CSSProperties = {
  width: '100%',
  padding: 9,
  border: '1px solid #94a3b8',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
};

const button: React.CSSProperties = {
  padding: '9px 14px',
  border: '1px solid #94a3b8',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  marginRight: 8,
  marginBottom: 8,
};

const row: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'end',
};

const cell: React.CSSProperties = {
  flex: '1 1 200px',
  minWidth: 170,
};

async function request(
  path: string,
  method = 'GET',
  body?: unknown,
) {
  const response = await fetch(API + path, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });

  const raw = await response.text();

  let result: any;
  try {
    result = raw ? JSON.parse(raw) : null;
  } catch {
    result = raw;
  }

  if (!response.ok) {
    const message = Array.isArray(result?.message)
      ? result.message.join('; ')
      : result?.message || `HTTP ${response.status}`;

    throw new Error(message);
  }

  return result;
}

function asArray(value: unknown): Row[] {
  return Array.isArray(value) ? value : [];
}

function variantLabel(variant: Row): string {
  const productName =
    variant.productTitle ||
    variant.product?.title ||
    variant.title ||
    'Product';

  return [
    productName,
    variant.sku,
    variant.size,
    variant.color,
  ].filter(Boolean).join(' / ');
}

function remaining(item: Row): number {
  return Math.max(
    0,
    Number(item.dispatchedQty || 0) -
    Number(item.receivedQty || 0) -
    Number(item.damagedQty || 0) -
    Number(item.shortageQty || 0),
  );
}

/* R4-E3 STATUS INDICATORS */
const transferStatusInfo: Record<string, {
  label: string;
  description: string;
  background: string;
  color: string;
}> = {
  REQUESTED: {
    label: 'Requested',
    description: 'Awaiting source-location approval.',
    background: '#dbeafe',
    color: '#1e40af',
  },
  APPROVED: {
    label: 'Approved',
    description: 'Stock reserved and awaiting dispatch.',
    background: '#fef3c7',
    color: '#92400e',
  },
  PICKING: {
    label: 'Picking',
    description: 'Picking in progress.',
    background: '#e0e7ff',
    color: '#3730a3',
  },
  DISPATCHED: {
    label: 'Dispatched',
    description: 'Stock dispatched; awaiting destination receipt.',
    background: '#ffedd5',
    color: '#9a3412',
  },
  PARTIALLY_RECEIVED: {
    label: 'Partially received',
    description: 'Some dispatched quantities remain outstanding.',
    background: '#fef3c7',
    color: '#92400e',
  },
  RECEIVED: {
    label: 'Received',
    description: 'All dispatched quantities accounted for.',
    background: '#dcfce7',
    color: '#166534',
  },
  SHORTAGE_CLOSED: {
    label: 'Shortage closed',
    description: 'Outstanding quantities recorded as shortages.',
    background: '#f3e8ff',
    color: '#6b21a8',
  },
  CANCELLED: {
    label: 'Cancelled',
    description: 'Transfer cancelled before dispatch.',
    background: '#f1f5f9',
    color: '#475569',
  },
};

function TransferStatusBadge({ status }: { status: string }) {
  const info = transferStatusInfo[status];

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '5px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: info?.background || '#f1f5f9',
        color: info?.color || '#334155',
      }}
      title={info?.description || status}
    >
      {info?.label || status}
    </span>
  );
}
export default function TransferManagement() {
  const [transfers, setTransfers] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [variants, setVariants] = useState<Row[]>([]);

  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');

  const [lines, setLines] = useState<TransferLine[]>([
    { variantId: '', quantity: 1 },
  ]);

  const [selectedId, setSelectedId] = useState('');
  const [details, setDetails] = useState<Row | null>(null);

  const [receipt, setReceipt] = useState<ReceiptLine[]>([]);
  const [shortageReason, setShortageReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelRequest, setCancelRequest] = useState<{
    transferId: string;
    reason: string;
    key: string;
  } | null>(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');

  // R4-E2 RETRY PROTECTION
  // Retain the same key for an identical operation until it succeeds.
  const pendingOperations = useRef<Map<string, string>>(new Map());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const variantMap = useMemo(
    () => new Map(variants.map(v => [v.id, v])),
    [variants],
  );

  const locationMap = useMemo(
    () => new Map(locations.map(l => [l.id, l])),
    [locations],
  );

  const load = useCallback(async () => {
    const [t, l, p] = await Promise.all([
      request('/transfers'),
      request('/inventory/locations'),
      request('/catalog/products'),
    ]);

    setTransfers(asArray(t));
    setLocations(asArray(l));

    const products = asArray(p);

    setVariants(
      products.flatMap(product =>
        asArray(product.variants).map(variant => ({
          ...variant,
          productTitle: product.title,
        })),
      ),
    );
  }, []);

  useEffect(() => {
    load().catch(e => setError(e.message));
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return transfers.filter(t => {
      if (status !== 'ALL' && t.status !== status) {
        return false;
      }

      const source = locationMap.get(t.sourceId);
      const destination = locationMap.get(t.destinationId);

      const searchable = [
        t.transferNumber,
        t.status,
        source?.name,
        source?.code,
        destination?.name,
        destination?.code,
      ].join(' ').toLowerCase();

      return searchable.includes(q);
    });
  }, [transfers, search, status, locationMap]);

  async function openTransfer(id: string) {
    setError('');
    setNotice('');

    try {
      const transfer = await request(
        `/transfers/${encodeURIComponent(id)}`,
      );

      setSelectedId(id);
      setDetails(transfer);

      setReceipt(
        asArray(transfer.items).map(item => ({
          variantId: item.variantId,
          receivedQty: 0,
          damagedQty: 0,
        })),
      );
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function perform(
    path: string,
    body: unknown,
    confirmation?: string,
  ) {
    if (confirmation && !window.confirm(confirmation)) {
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const original = body as Record<string, unknown>;
      const { idempotencyKey: _ignoredKey, ...payload } = original;
      const signature = JSON.stringify({ path, payload });

      let key = pendingOperations.current.get(signature);
      if (!key) {
        key = crypto.randomUUID();
        pendingOperations.current.set(signature, key);
      }

      const protectedBody = {
        ...payload,
        idempotencyKey: key,
      };

      await request(path, 'POST', protectedBody);
      pendingOperations.current.delete(signature);
      await load();

      if (selectedId) {
        const updated = await request(
          `/transfers/${encodeURIComponent(selectedId)}`,
        );

        setDetails(updated);

        setReceipt(
          asArray(updated.items).map(item => ({
            variantId: item.variantId,
            receivedQty: 0,
            damagedQty: 0,
          })),
        );
      }

      /* R4-E3B OPERATION FEEDBACK */
      const operation = path.split('/').pop();

      const messages: Record<string, string> = {
        approve: 'Transfer approved. Source stock is reserved.',
        dispatch: 'Transfer dispatched. Awaiting destination receipt.',
        receive: 'Receipt recorded. Stock balances have been updated.',
        'close-shortage': 'Transfer shortage closed and recorded.',
      };

      setNotice(messages[operation || ''] ||
        'Transfer operation completed successfully.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createTransfer() {
    if (!sourceId || !destinationId) {
      setError('Select source and destination locations.');
      return;
    }

    if (sourceId === destinationId) {
      setError('Source and destination must differ.');
      return;
    }

    if (
      !lines.length ||
      lines.some(l =>
        !l.variantId ||
        !Number.isInteger(l.quantity) ||
        l.quantity < 1
      )
    ) {
      setError('Select valid variants and positive quantities.');
      return;
    }

    if (new Set(lines.map(l => l.variantId)).size !== lines.length) {
      setError('Duplicate variants are not allowed.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const created = await request('/transfers', 'POST', {
        sourceId,
        destinationId,
        items: lines,
        idempotencyKey: crypto.randomUUID(),
      });

      await load();

      setLines([{ variantId: '', quantity: 1 }]);
      setSourceId('');
      setDestinationId('');

      setNotice('Transfer request created.');

      if (created?.id) {
        await openTransfer(created.id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function action(
    name: string,
    confirmation: string,
  ) {
    if (!selectedId || !details || busy) return;

    const allowed: Record<string, string[]> = {
      approve: ['REQUESTED'],
      dispatch: ['APPROVED'],
    };

    if (!allowed[name]?.includes(String(details.status))) {
      setError('This action is not permitted in the current transfer status.');
      return;
    }

    perform(
      `/transfers/${encodeURIComponent(selectedId)}/${name}`,
      { idempotencyKey: crypto.randomUUID() },
      confirmation,
    );
  }

  function submitReceipt() {
    if (!selectedId || !details || busy) return;

    if (!['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(String(details.status))) {
      setError('Only dispatched transfers can receive stock.');
      return;
    }

    const items = receipt.map(line => ({
      variantId: line.variantId,
      receivedQty: Number(line.receivedQty),
      damagedQty: Number(line.damagedQty),
    }));

    if (items.some(line =>
      !Number.isInteger(line.receivedQty) ||
      !Number.isInteger(line.damagedQty) ||
      line.receivedQty < 0 ||
      line.damagedQty < 0
    )) {
      setError('Receipt quantities must be nonnegative integers.');
      return;
    }

    const total = items.reduce(
      (sum, line) => sum + line.receivedQty + line.damagedQty,
      0,
    );

    if (total < 1) {
      setError('Enter at least one received or damaged unit.');
      return;
    }

    for (const line of items) {
      const original = asArray(details.items).find(
        item => item.variantId === line.variantId,
      );

      if (
        !original ||
        line.receivedQty + line.damagedQty > remaining(original)
      ) {
        setError('Receipt exceeds outstanding dispatched stock.');
        return;
      }
    }

    perform(
      `/transfers/${encodeURIComponent(selectedId)}/receive`,
      {
        items,
        idempotencyKey: crypto.randomUUID(),
      },
      'Confirm the physical quantities received at this branch?',
    );
  }

  async function cancelTransfer() {
    if (!selectedId || !details) return;

    const reason = cancelReason.trim();

    if (reason.length < 10) {
      setError('Cancellation reason must contain at least 10 characters.');
      return;
    }

    if (!['REQUESTED', 'APPROVED'].includes(details.status)) {
      setError('This transfer can no longer be cancelled.');
      return;
    }

    if (!window.confirm(
      'Cancel this transfer? Approved reservations will be released.'
    )) {
      return;
    }

    const existing =
      cancelRequest?.transferId === selectedId &&
      cancelRequest?.reason === reason
        ? cancelRequest
        : null;

    const pending = existing || {
      transferId: selectedId,
      reason,
      key: crypto.randomUUID(),
    };

    setCancelRequest(pending);
    setBusy(true);
    setError('');
    setNotice('');

    try {
      await request(
        `/transfers/${encodeURIComponent(selectedId)}/cancel`,
        'POST',
        {
          reason,
          idempotencyKey: pending.key,
        },
      );

      const updated = await request(
        `/transfers/${encodeURIComponent(selectedId)}`,
      );

      setDetails(updated);
      await load();

      setCancelRequest(null);
      setCancelReason('');
      setNotice('Transfer cancelled successfully.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function closeShortage() {
    if (!selectedId || !details || busy) return;

    if (details.status !== 'PARTIALLY_RECEIVED') {
      setError('Shortage closure requires a partially received transfer.');
      return;
    }

    if (shortageReason.trim().length < 10) {
      setError('Enter a shortage reason of at least 10 characters.');
      return;
    }

    perform(
      `/transfers/${encodeURIComponent(selectedId)}/close-shortage`,
      {
        reason: shortageReason.trim(),
        idempotencyKey: crypto.randomUUID(),
      },
      'Close this transfer with its remaining units recorded as shortages?',
    );
  }

  const activeLocations = locations.filter(l => l.active !== false);

  const sources = activeLocations.filter(
    l => l.type === 'WAREHOUSE' || l.type === 'BRANCH',
  );

  const destinations = activeLocations.filter(
    l => l.type === 'BRANCH',
  );

  return (
    <section className="stack">
      <h2>Warehouse & Branch Transfers</h2>

      <p className="muted">
        Create, approve, dispatch and receive stock transfers.
        Inventory changes are processed by the secured backend.
      </p>

      {error && (
        <div role="alert" style={{ ...panel, borderColor: '#dc2626' }}>
          {error}
        </div>
      )}

      {notice && (
        <div role="status" style={panel}>
          {notice}
        </div>
      )}

      <div style={panel}>
        <h3>Create transfer request</h3>

        <div style={row}>
          <label style={cell}>
            Source location
            <select
              style={input}
              value={sourceId}
              onChange={e => setSourceId(e.target.value)}
            >
              <option value="">Select source</option>
              {sources.map(l => (
                <option key={l.id} value={l.id}>
                  {l.code} - {l.name}
                </option>
              ))}
            </select>
          </label>

          <label style={cell}>
            Destination branch
            <select
              style={input}
              value={destinationId}
              onChange={e => setDestinationId(e.target.value)}
            >
              <option value="">Select branch</option>
              {destinations
                .filter(l => l.id !== sourceId)
                .map(l => (
                  <option key={l.id} value={l.id}>
                    {l.code} - {l.name}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <h4>Products to transfer</h4>

        {lines.map((line, index) => (
          <div key={index} style={row}>
            <label style={{ flex: '3 1 250px' }}>
              Product / SKU
              <select
                style={input}
                value={line.variantId}
                onChange={e => setLines(old =>
                  old.map((x, i) =>
                    i === index
                      ? { ...x, variantId: e.target.value }
                      : x
                  )
                )}
              >
                <option value="">Select variant</option>
                {variants
                  .filter(v => v.active !== false)
                  .map(v => (
                    <option key={v.id} value={v.id}>
                      {variantLabel(v)}
                    </option>
                  ))}
              </select>
            </label>

            <label style={cell}>
              Quantity
              <input
                style={input}
                type="number"
                min={1}
                step={1}
                value={line.quantity}
                onChange={e => setLines(old =>
                  old.map((x, i) =>
                    i === index
                      ? { ...x, quantity: Number(e.target.value) }
                      : x
                  )
                )}
              />
            </label>

            <button
              style={button}
              disabled={busy || lines.length === 1}
              onClick={() => setLines(old =>
                old.filter((_, i) => i !== index)
              )}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          style={button}
          disabled={busy}
          onClick={() => setLines(old => [
            ...old,
            { variantId: '', quantity: 1 },
          ])}
        >
          + Add product
        </button>

        <button
          style={button}
          disabled={busy}
          onClick={createTransfer}
        >
          Create transfer
        </button>
      </div>

      <div style={panel}>
        <h3>Transfer register</h3>

        <div style={row}>
          <label style={cell}>
            Search
            <input
              style={input}
              value={search}
              placeholder="Transfer number, branch or status"
              onChange={e => setSearch(e.target.value)}
            />
          </label>

          <label style={cell}>
            Status
            <select
              style={input}
              value={status}
              onChange={e => setStatus(e.target.value)}
            >
              {[
                'ALL',
                'REQUESTED',
                'APPROVED',
                'PICKING',
                'DISPATCHED',
                'PARTIALLY_RECEIVED',
                'RECEIVED',
                'SHORTAGE_CLOSED',
                'CANCELLED',
              ].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <button
            style={button}
            disabled={busy}
            onClick={() => {
              setError('');
              load().catch(e => setError(e.message));
            }}
          >
            Refresh
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>Transfer</th>
                <th>Source</th>
                <th>Destination</th>
                <th>Status</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id}>
                  <td>{t.transferNumber}</td>
                  <td>
                    {locationMap.get(t.sourceId)?.name || t.sourceId}
                  </td>
                  <td>
                    {locationMap.get(t.destinationId)?.name ||
                      t.destinationId}
                  </td>
                  <td><TransferStatusBadge status={String(t.status)} /></td>
                  <td>
                    {t.createdAt
                      ? new Date(t.createdAt).toLocaleString()
                      : '-'}
                  </td>
                  <td>
                    <button
                      style={button}
                      onClick={() => openTransfer(t.id)}
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <p className="muted">No matching transfers.</p>
        )}
      </div>

      {details && (
        <div style={panel}>
          <h3>Transfer details</h3>

          <div style={{ marginBottom: 14 }}>
            <TransferStatusBadge status={String(details.status)} />
            <p className="muted" style={{ marginTop: 8 }}>
              {transferStatusInfo[String(details.status)]?.description ||
                'Review this transfer before taking action.'}
            </p>
            {['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(String(details.status)) && (
              <p>
                <strong>Outstanding units: </strong>
                {asArray(details.items).reduce(
                  (sum, item) => sum + remaining(item),
                  0,
                )}
              </p>
            )}
          </div>

          <p>
            <strong>{details.transferNumber}</strong>
            {' â€” '}
            {details.status}
          </p>

          <p>
            {locationMap.get(details.sourceId)?.name ||
              details.source?.name ||
              details.sourceId}
            {' â†’ '}
            {locationMap.get(details.destinationId)?.name ||
              details.destination?.name ||
              details.destinationId}
          </p>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Requested</th>
                  <th>Dispatched</th>
                  <th>Good</th>
                  <th>Damaged</th>
                  <th>Shortage</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {asArray(details.items).map(item => (
                  <tr key={item.id}>
                    <td>
                      {variantLabel(
                        variantMap.get(item.variantId) || {
                          sku: item.variantId,
                        },
                      )}
                    </td>
                    <td>{item.requestedQty}</td>
                    <td>{item.dispatchedQty}</td>
                    <td>{item.receivedQty}</td>
                    <td>{item.damagedQty}</td>
                    <td>{item.shortageQty}</td>
                    <td>{remaining(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* R4-D5 Transfer Reporting */}
          <div style={panel}>
            <h4>Transfer reporting</h4>
            <p className="muted">
              Summary of the selected transfer and its
              recorded stock quantities.
            </p>

            {(() => {
              const items = asArray(details.items);

              const sum = (field: string) =>
                items.reduce(
                  (total, item) =>
                    total + Number(item[field] || 0),
                  0,
                );

              const dispatched = sum('dispatchedQty');
              const good = sum('receivedQty');
              const damaged = sum('damagedQty');
              const shortage = sum('shortageQty');
              const outstanding =
                dispatched - good - damaged - shortage;

              const exportCsv = () => {
                const columns = [
                  'Transfer Number',
                  'Transfer ID',
                  'Status',
                  'Source ID',
                  'Destination ID',
                  'Variant ID',
                  'Requested',
                  'Dispatched',
                  'Good Received',
                  'Damaged',
                  'Shortage',
                  'Outstanding',
                ];

                const csvCell = (value: unknown) => {
                  const text = String(value ?? '');
                  const safe = /^[\s]*[=+\-@]/.test(text)
                    ? "'" + text
                    : text;

                  return '"' +
                    safe.replace(/"/g, '""') +
                    '"';
                };

                const rows = items.map(item => [
                  details.transferNumber,
                  details.id,
                  details.status,
                  details.sourceId,
                  details.destinationId,
                  item.variantId,
                  item.requestedQty,
                  item.dispatchedQty,
                  item.receivedQty,
                  item.damagedQty,
                  item.shortageQty,
                  Number(item.dispatchedQty || 0) -
                    Number(item.receivedQty || 0) -
                    Number(item.damagedQty || 0) -
                    Number(item.shortageQty || 0),
                ]);

                const csv = [columns, ...rows]
                  .map(values => values.map(csvCell).join(','))
                  .join('\r\n');

                const blob = new Blob(
                  ['\uFEFF' + csv],
                  { type: 'text/csv;charset=utf-8' },
                );

                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download =
                  'transfer-' +
                  String(details.transferNumber || details.id)
                    .replace(/[^a-zA-Z0-9_-]/g, '_') +
                  '.csv';

                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
              };

              return (
                <>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 20,
                  }}>
                    <div>
                      <strong>Requested</strong>
                      <p>{sum('requestedQty')}</p>
                    </div>
                    <div>
                      <strong>Dispatched</strong>
                      <p>{dispatched}</p>
                    </div>
                    <div>
                      <strong>Good received</strong>
                      <p>{good}</p>
                    </div>
                    <div>
                      <strong>Damaged</strong>
                      <p>{damaged}</p>
                    </div>
                    <div>
                      <strong>Shortage</strong>
                      <p>{shortage}</p>
                    </div>
                    <div>
                      <strong>Outstanding</strong>
                      <p>{outstanding}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    style={button}
                    onClick={exportCsv}
                    disabled={items.length === 0}
                  >
                    Export transfer CSV
                  </button>

                  <p className="muted">
                    Export includes this transfer only.
                    It does not include audit records or
                    historical inventory ledger entries.
                  </p>
                </>
              );
            })()}
          </div>
          {/* R4-D3 Transfer Audit Trail */}
          <div style={panel}>
            <h4>Transfer audit history</h4>
            <p className="muted">
              Recorded transfer events in chronological order.
            </p>

            {asArray(details.audit).length === 0 ? (
              <p className="muted">
                No audit records available for this transfer.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  textAlign: 'left',
                }}>
                  <thead>
                    <tr>
                      <th>Date and time</th>
                      <th>Action</th>
                      <th>Actor ID</th>
                      <th>Recorded change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asArray(details.audit).map(entry => (
                      <tr key={entry.id}>
                        <td>
                          {entry.createdAt
                            ? new Date(entry.createdAt).toLocaleString()
                            : '-'}
                        </td>
                        <td>{entry.action}</td>
                        <td>
                          <code>{entry.actorId || '-'}</code>
                        </td>
                        <td>
                          <details>
                            <summary>View event details</summary>
                            <pre style={{
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                              fontSize: 12,
                            }}>
                              {JSON.stringify({
                                before: entry.before,
                                after: entry.after,
                              }, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {/* R4-D2 Transfer Reconciliation */}
          <div style={panel}>
            <h4>Transfer reconciliation</h4>

            {(() => {
              const items = asArray(details.items);

              const totals = items.reduce(
                (acc, item) => {
                  acc.dispatched += Number(item.dispatchedQty || 0);
                  acc.good += Number(item.receivedQty || 0);
                  acc.damaged += Number(item.damagedQty || 0);
                  acc.shortage += Number(item.shortageQty || 0);
                  return acc;
                },
                {
                  dispatched: 0,
                  good: 0,
                  damaged: 0,
                  shortage: 0,
                },
              );

              const accounted =
                totals.good + totals.damaged + totals.shortage;

              const outstanding = totals.dispatched - accounted;

              const invalid = items.some(item => {
                const values = [
                  item.dispatchedQty,
                  item.receivedQty,
                  item.damagedQty,
                  item.shortageQty,
                ].map(Number);

                return values.some(
                  n => !Number.isSafeInteger(n) || n < 0,
                ) || values[1] + values[2] + values[3] > values[0];
              });

              const active = [
                'DISPATCHED',
                'PARTIALLY_RECEIVED',
                'RECEIVED',
                'SHORTAGE_CLOSED',
              ].includes(details.status);

              const inconsistent =
                invalid ||
                (active && items.length === 0) ||
                (active && outstanding < 0) ||
                (['RECEIVED', 'SHORTAGE_CLOSED'].includes(
                  details.status,
                ) && outstanding !== 0) ||
                (details.status === 'RECEIVED' &&
                  totals.shortage > 0);

              return (
                <>
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 20,
                    marginBottom: 12,
                  }}>
                    <div>
                      <strong>Dispatched</strong>
                      <p>{totals.dispatched}</p>
                    </div>
                    <div>
                      <strong>Good received</strong>
                      <p>{totals.good}</p>
                    </div>
                    <div>
                      <strong>Damaged</strong>
                      <p>{totals.damaged}</p>
                    </div>
                    <div>
                      <strong>Shortage recorded</strong>
                      <p>{totals.shortage}</p>
                    </div>
                    <div>
                      <strong>Outstanding</strong>
                      <p>{outstanding}</p>
                    </div>
                  </div>

                  <p>
                    <strong>Reconciliation status: </strong>
                    {!active
                      ? 'Not dispatched'
                      : inconsistent
                        ? 'REVIEW REQUIRED'
                        : outstanding > 0
                          ? 'Pending receipt / resolution'
                          : totals.shortage > 0
                            ? 'Accounted for with shortage'
                            : totals.damaged > 0
                              ? 'Accounted for with damage'
                              : 'Quantity accounted for'}
                  </p>

                  {inconsistent && (
                    <p role="alert" style={{
                      color: '#dc2626',
                      fontWeight: 600,
                    }}>
                      Quantity or status inconsistency detected.
                      Investigate before closing this transfer.
                    </p>
                  )}

                  <p className="muted">
                    This is a read-only quantity reconciliation.
                    It does not independently verify physical
                    stock, receipt provenance, or ledger entries.
                  </p>
                </>
              );
            })()}
          </div>
          <div style={panel}>
            <h4>Receipt history</h4>
            <p className="muted">
              Chronological records of stock received at the
              destination. Damaged units are tracked separately.
            </p>

            {asArray(details.receipts).length === 0 ? (
              <p className="muted">
                No receipt records for this transfer.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%',
                  textAlign: 'left',
                }}>
                  <thead>
                    <tr>
                      <th>Date and time</th>
                      <th>Product</th>
                      <th>Good</th>
                      <th>Damaged</th>
                      <th>Received by (user ID)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asArray(details.receipts).map(r => (
                      <tr key={r.id}>
                        <td>
                          {r.createdAt
                            ? new Date(r.createdAt).toLocaleString()
                            : '-'}
                        </td>
                        <td>
                          {variantLabel(
                            variantMap.get(r.variantId) || {
                              sku: r.variantId,
                            },
                          )}
                        </td>
                        <td>{r.receivedQty}</td>
                        <td>{r.damagedQty}</td>
                        <td>
                          <code>{r.actorId || '-'}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {['REQUESTED', 'APPROVED'].includes(details.status) && (
            <div style={panel}>
              <h4>Cancel transfer</h4>

              <p className="muted">
                Requested transfers can be cancelled without stock changes.
                Approved transfers release their reserved source stock.
                Dispatched transfers cannot be cancelled.
              </p>

              <label>
                Cancellation reason
                <textarea
                  style={input}
                  rows={3}
                  value={cancelReason}
                  onChange={e => {
                    setCancelReason(e.target.value);
                    setCancelRequest(null);
                  }}
                  placeholder="Explain why this transfer is being cancelled"
                />
              </label>

              <button
                style={button}
                disabled={busy || cancelReason.trim().length < 10}
                onClick={cancelTransfer}
              >
                Cancel transfer
              </button>
            </div>
          )}
          {details.status === 'REQUESTED' && (
            <button
              style={button}
              disabled={busy}
              onClick={() => action(
                'approve',
                'Approve this transfer and reserve source stock?',
              )}
            >
              Approve transfer
            </button>
          )}

          {details.status === 'APPROVED' && (
            <button
              style={button}
              disabled={busy}
              onClick={() => action(
                'dispatch',
                'Confirm that all requested units have been dispatched?',
              )}
            >
              Dispatch stock
            </button>
          )}

          {['DISPATCHED', 'PARTIALLY_RECEIVED'].includes(
            details.status,
          ) && (
            <div style={panel}>
              <h4>Receive stock at destination</h4>

              <p className="muted">
                Good quantities increase available physical stock.
                Damaged quantities are recorded as quarantined.
              </p>

              {receipt.map((line, index) => {
                const original = asArray(details.items).find(
                  item => item.variantId === line.variantId,
                );

                return (
                  <div key={line.variantId} style={row}>
                    <div style={cell}>
                      <strong>
                        {variantLabel(
                          variantMap.get(line.variantId) || {
                            sku: line.variantId,
                          },
                        )}
                      </strong>
                      <p className="muted">
                        Outstanding: {original
                          ? remaining(original)
                          : 0}
                      </p>
                    </div>

                    <label style={cell}>
                      Good quantity
                      <input
                        style={input}
                        type="number"
                        min={0}
                        step={1}
                        value={line.receivedQty}
                        onChange={e => setReceipt(old =>
                          old.map((x, i) =>
                            i === index
                              ? {
                                  ...x,
                                  receivedQty: Number(e.target.value),
                                }
                              : x
                          )
                        )}
                      />
                    </label>

                    <label style={cell}>
                      Damaged quantity
                      <input
                        style={input}
                        type="number"
                        min={0}
                        step={1}
                        value={line.damagedQty}
                        onChange={e => setReceipt(old =>
                          old.map((x, i) =>
                            i === index
                              ? {
                                  ...x,
                                  damagedQty: Number(e.target.value),
                                }
                              : x
                          )
                        )}
                      />
                    </label>
                  </div>
                );
              })}

              <button
                style={button}
                disabled={busy}
                onClick={submitReceipt}
              >
                Confirm receipt
              </button>
            </div>
          )}

          {details.status === 'PARTIALLY_RECEIVED' && (
            <div style={panel}>
              <h4>Close outstanding shortage</h4>

              <p className="muted">
                This records outstanding units as shortages.
                It does not add missing units to branch stock.
              </p>

              <label>
                Reason
                <textarea
                  style={input}
                  rows={3}
                  value={shortageReason}
                  onChange={e => setShortageReason(e.target.value)}
                  placeholder="Explain the missing stock"
                />
              </label>

              <button
                style={button}
                disabled={busy || shortageReason.trim().length < 10}
                onClick={closeShortage}
              >
                Close shortage
              </button>
            </div>
          )}

          <button
            style={button}
            onClick={() => {
              setDetails(null);
              setSelectedId('');
              setReceipt([]);
            }}
          >
            Close details
          </button>
        </div>
      )}
    </section>
  );
}