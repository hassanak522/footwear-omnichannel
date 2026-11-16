'use client';

import { useEffect, useRef, useState } from 'react';

type Location = {
  id: string;
  name: string;
  code?: string;
  type?: string;
};

type Movement = {
  id: string;
  locationId: string;
  variantId: string;
  type: string;
  quantityDelta: number;
  referenceType?: string | null;
  referenceId?: string | null;
  actorId?: string | null;
  notes?: string | null;
  createdAt: string;
  variant?: {
    sku?: string;
    barcode?: string | null;
  };
  actor?: {
    name?: string;
    email?: string;
  } | null;
};

type Result = {
  locationId: string;
  page: number;
  take: number;
  total: number;
  totalPages: number;
  items: Movement[];
};

const API = '/api/v1';

const types = [
  'OPENING_BALANCE',
  'SUPPLIER_RECEIPT',
  'SALE',
  'SALE_RETURN',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'TRANSFER_DISPATCH',
  'TRANSFER_RECEIPT',
  'ADJUSTMENT',
  'QUARANTINE',
  'QUARANTINE_RELEASE',
];

async function getJson(path: string): Promise<any> {
  const response = await fetch(API + path, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  const text = await response.text();
  let value: any;

  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('Unexpected response from inventory API');
  }

  if (!response.ok) {
    const message = Array.isArray(value?.message)
      ? value.message.join('; ')
      : value?.message || `HTTP ${response.status}`;

    throw new Error(message);
  }

  return value;
}

const control: React.CSSProperties = {
  width: '100%',
  padding: 9,
  border: '1px solid #94a3b8',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
};

const field: React.CSSProperties = {
  flex: '1 1 180px',
  minWidth: 160,
};

export default function StockMovementHistory() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [type, setType] = useState('');
  const [variantId, setVariantId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const requestNumber = useRef(0);

  useEffect(() => {
    let cancelled = false;

    getJson('/inventory/locations')
      .then(value => {
        if (cancelled) return;

        const rows: Location[] = Array.isArray(value) ? value : [];
        const physical = rows.filter(
          l => l.type === 'WAREHOUSE' || l.type === 'BRANCH'
        );

        setLocations(physical);
        setLocationId(physical[0]?.id || '');
      })
      .catch(e => {
        if (!cancelled) setError(String(e.message));
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const current = ++requestNumber.current;

    if (!locationId) {
      setResult(null);
      return;
    }

    if (from && to && from > to) {
      setResult(null);
      setError('Start date must not be after end date.');
      return;
    }

    const params = new URLSearchParams({
      locationId,
      page: String(page),
      take: '50',
    });

    if (type) params.set('type', type);
    if (variantId.trim()) params.set('variantId', variantId.trim());
    if (from) params.set('from', new Date(from + 'T00:00:00').toISOString());
    if (to) params.set('to', new Date(to + 'T23:59:59.999').toISOString());

    setLoading(true);
    setError('');
    setResult(null);

    getJson('/inventory/movements?' + params.toString())
      .then(value => {
        if (current === requestNumber.current) {
          setResult(value as Result);
        }
      })
      .catch(e => {
        if (current === requestNumber.current) {
          setError(String(e.message));
        }
      })
      .finally(() => {
        if (current === requestNumber.current) {
          setLoading(false);
        }
      });

    return () => {
      requestNumber.current++;
    };
  }, [locationId, type, variantId, from, to, page, reload]);

  function resetPage() {
    setPage(1);
  }

  return (
    <section className="card stack">
      <h2>Stock movement history</h2>
      <p className="muted">
        Read-only inventory ledger for warehouse and branch stock.
        Records are retrieved from the secured inventory API.
      </p>

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <label style={field}>
          Location
          <select
            style={control}
            value={locationId}
            onChange={e => {
              setLocationId(e.target.value);
              resetPage();
            }}
          >
            <option value="">Select location</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>
                {l.code ? l.code + ' - ' : ''}{l.name}
              </option>
            ))}
          </select>
        </label>

        <label style={field}>
          Movement type
          <select
            style={control}
            value={type}
            onChange={e => {
              setType(e.target.value);
              resetPage();
            }}
          >
            <option value="">All types</option>
            {types.map(t => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>

        <label style={field}>
          Variant ID (optional)
          <input
            style={control}
            value={variantId}
            placeholder="Product variant UUID"
            onChange={e => {
              setVariantId(e.target.value);
              resetPage();
            }}
          />
        </label>

        <label style={field}>
          From date
          <input
            style={control}
            type="date"
            value={from}
            onChange={e => {
              setFrom(e.target.value);
              resetPage();
            }}
          />
        </label>

        <label style={field}>
          To date
          <input
            style={control}
            type="date"
            value={to}
            onChange={e => {
              setTo(e.target.value);
              resetPage();
            }}
          />
        </label>
      </div>

      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={() => setReload(x => x + 1)}
          disabled={loading || !locationId}
        >
          Refresh movements
        </button>
        <span className="muted">
          {result ? `${result.total} matching movements` : ''}
        </span>
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {loading && <p role="status">Loading stock movements...</p>}

      {!loading && !error && result?.items.length === 0 && (
        <p className="muted">No movements match these filters.</p>
      )}

      {!loading && result && result.items.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Date / time</th>
                <th>SKU</th>
                <th>Movement</th>
                <th>Change</th>
                <th>Reference</th>
                <th>Staff</th>
                <th>Reason / notes</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map(m => (
                <tr key={m.id}>
                  <td>{new Date(m.createdAt).toLocaleString()}</td>
                  <td title={m.variantId}>
                    {m.variant?.sku || m.variantId}
                  </td>
                  <td>{m.type.replace(/_/g, ' ')}</td>
                  <td style={{
                    fontWeight: 700,
                    color: m.quantityDelta < 0
                      ? '#dc2626'
                      : m.quantityDelta > 0
                        ? '#15803d'
                        : 'inherit',
                  }}>
                    {m.quantityDelta > 0 ? '+' : ''}
                    {m.quantityDelta}
                  </td>
                  <td title={m.referenceId || ''}>
                    {m.referenceType || '-'}
                    {m.referenceId && (
                      <div className="muted" style={{fontSize:12}}>
                        {m.referenceId}
                      </div>
                    )}
                  </td>
                  <td>
                    {m.actor?.name || m.actor?.email ||
                      m.actorId || 'System / unknown'}
                  </td>
                  <td>{m.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && (
        <div className="row" style={{gap:12, alignItems:'center'}}>
          <button
            type="button"
            className="secondary"
            disabled={loading || page <= 1}
            onClick={() => setPage(p => Math.max(1,p-1))}
          >
            Previous
          </button>
          <span>
            Page {result.page} of {Math.max(1,result.totalPages)}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={loading || page >= result.totalPages}
            onClick={() => setPage(p => p+1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}