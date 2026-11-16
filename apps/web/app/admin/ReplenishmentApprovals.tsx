'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Location = {
  id: string;
  name: string;
  code?: string;
  type?: string;
};

type TransferItem = {
  variantId: string;
  requestedQty: number;
};

type Transfer = {
  id: string;
  transferNumber: string;
  sourceId: string;
  destinationId: string;
  status: string;
  createdAt: string;
  items: TransferItem[];
};

type Product = {
  variants?: Array<{id:string;sku:string}>;
};

const API = '/api/v1';

async function request(path:string, method='GET', body?:unknown) {
  const response = await fetch(API + path,{
    method,
    credentials:'include',
    cache:'no-store',
    headers:{'Content-Type':'application/json'},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });

  const raw = await response.text();
  let data:any;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join('; ')
      : data?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export default function ReplenishmentApprovals() {
  const [transfers,setTransfers] = useState<Transfer[]>([]);
  const [locations,setLocations] = useState<Location[]>([]);
  const [skuMap,setSkuMap] = useState<Record<string,string>>({});
  const [branch,setBranch] = useState('ALL');
  const [search,setSearch] = useState('');
  const [selectedId,setSelectedId] = useState('');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [transferData,locationData,productData] =
        await Promise.all([
          request('/transfers'),
          request('/inventory/locations'),
          request('/catalog/products')
        ]);

      if (!Array.isArray(transferData) ||
          !Array.isArray(locationData) ||
          !Array.isArray(productData)) {
        throw new Error('Unexpected API response');
      }

      const sku:Record<string,string> = {};

      for (const product of productData as Product[]) {
        for (const variant of product.variants || []) {
          sku[variant.id] = variant.sku;
        }
      }

      setTransfers(transferData);
      setLocations(locationData);
      setSkuMap(sku);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load');
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(() => {
    void load();
  },[load]);

  const locationMap = useMemo(
    () => new Map(locations.map(l => [l.id,l])),
    [locations]
  );

  const pending = useMemo(() => transfers.filter(t => {
    const source = locationMap.get(t.sourceId);
    const destination = locationMap.get(t.destinationId);

    return t.status === 'REQUESTED' &&
      source?.type === 'WAREHOUSE' &&
      destination?.type === 'BRANCH';
  }),[transfers,locationMap]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return pending.filter(t => {
      const destination = locationMap.get(t.destinationId);
      const matchesBranch =
        branch === 'ALL' || t.destinationId === branch;

      const matchesSearch =
        !q ||
        t.transferNumber.toLowerCase().includes(q) ||
        (destination?.name || '').toLowerCase().includes(q) ||
        t.items.some(item =>
          (skuMap[item.variantId] || item.variantId)
            .toLowerCase().includes(q)
        );

      return matchesBranch && matchesSearch;
    });
  },[pending,branch,search,locationMap,skuMap]);

  const totalUnits = filtered.reduce(
    (sum,t) => sum + t.items.reduce(
      (n,item) => n + item.requestedQty,0
    ),0
  );

  async function approve(t:Transfer) {
    if (busy) return;

    const latest = transfers.find(x => x.id === t.id);

    if (latest?.status !== 'REQUESTED') {
      setError('This request is no longer pending.');
      return;
    }

    const destination = locationMap.get(t.destinationId);
    const units = t.items.reduce(
      (n,item) => n + item.requestedQty,0
    );

    if (!window.confirm(
      `Approve ${t.transferNumber} for ` +
      `${destination?.name || t.destinationId}?\n\n` +
      `${units} unit(s) will be reserved at the source warehouse. ` +
      'Approval does not dispatch inventory.'
    )) return;

    setBusy(true);
    setSelectedId(t.id);
    setError('');
    setNotice('');

    try {
      await request(
        `/transfers/${encodeURIComponent(t.id)}/approve`,
        'POST',
        {idempotencyKey:crypto.randomUUID()}
      );

      setNotice(
        `${t.transferNumber} approved. ` +
        'Warehouse stock is now reserved pending dispatch.'
      );

      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Approval failed'
      );
    } finally {
      setBusy(false);
      setSelectedId('');
    }
  }

  return (
    <section className="card stack">
      <div className="row">
        <div>
          <h2>Warehouse replenishment approvals</h2>
          <p className="muted">
            Review pending warehouse-to-branch transfer requests.
            Approval reserves source stock but does not dispatch it.
          </p>
        </div>

        <button
          className="secondary"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="grid">
        <div className="card">
          <span className="muted">Pending requests</span>
          <div className="metric">{pending.length}</div>
        </div>
        <div className="card">
          <span className="muted">Filtered requests</span>
          <div className="metric">{filtered.length}</div>
        </div>
        <div className="card">
          <span className="muted">Filtered requested units</span>
          <div className="metric">{totalUnits}</div>
        </div>
      </div>

      <div className="grid">
        <label>
          Destination branch
          <select
            value={branch}
            onChange={e => setBranch(e.target.value)}
          >
            <option value="ALL">All branches</option>
            {locations.filter(l => l.type === 'BRANCH').map(l => (
              <option key={l.id} value={l.id}>
                {l.code || l.name} - {l.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Search transfer, branch or SKU
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search pending requests"
          />
        </label>
      </div>

      {filtered.map(t => {
        const source = locationMap.get(t.sourceId);
        const destination = locationMap.get(t.destinationId);

        return (
          <article className="card stack" key={t.id}>
            <div className="row">
              <strong>{t.transferNumber}</strong>
              <span>REQUESTED</span>
              <span className="muted">
                {new Date(t.createdAt).toLocaleString()}
              </span>
            </div>

            <p>
              <strong>From:</strong> {source?.name || t.sourceId}
              {' | '}
              <strong>To:</strong> {destination?.name || t.destinationId}
            </p>

            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Requested units</th>
                  </tr>
                </thead>
                <tbody>
                  {t.items.map(item => (
                    <tr key={item.variantId}>
                      <td>
                        {skuMap[item.variantId] || item.variantId}
                      </td>
                      <td>{item.requestedQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row">
              <strong>
                Total: {t.items.reduce(
                  (n,item) => n + item.requestedQty,0
                )} units
              </strong>

              <button
                className="right"
                disabled={busy || loading}
                onClick={() => void approve(t)}
              >
                {busy && selectedId === t.id
                  ? 'Approving...'
                  : 'Approve transfer'}
              </button>
            </div>
          </article>
        );
      })}

      {!loading && filtered.length === 0 && (
        <p className="muted">
          No pending warehouse-to-branch requests match the filters.
        </p>
      )}

      <p className="muted">
        Requests are limited to records returned by the existing
        transfers API. Approval permissions and available-stock
        checks are enforced by the backend. Dispatch and receipt
        remain in the Transfers workflow.
      </p>
    </section>
  );
}