'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

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
      await request(path, 'POST', body);
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

      setNotice('Operation completed successfully.');
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
    if (!selectedId) return;

    perform(
      `/transfers/${encodeURIComponent(selectedId)}/${name}`,
      { idempotencyKey: crypto.randomUUID() },
      confirmation,
    );
  }

  function submitReceipt() {
    if (!selectedId || !details) return;

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
    if (!selectedId) return;

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
                  <td>{t.status}</td>
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
                disabled={busy}
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