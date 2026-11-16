'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Location = {
  id: string;
  name: string;
  code: string;
  type: string;
  active: boolean;
};

type Balance = {
  id: string;
  locationId: string;
  variantId: string;
  onHand: number;
  quarantined: number;
  reservedOnline: number;
  reservedReplenish: number;
  safetyBuffer: number;
  variant: {
    sku: string;
    barcode?: string;
    size?: string;
    color?: string;
    product?: { title?: string };
  };
};

async function api<T>(path: string): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      Array.isArray(body?.message)
        ? body.message.join('; ')
        : body?.message || `HTTP ${response.status}`
    );
  }

  return body as T;
}

const inputStyle: React.CSSProperties = {
  padding: 9,
  border: '1px solid #94a3b8',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  width: '100%',
};

export default function WarehouseInventory() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [balances, setBalances] = useState<Balance[]>([]);
  const [search, setSearch] = useState('');
  const [threshold, setThreshold] = useState(5);
  const [onlyLow, setOnlyLow] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;

    api<Location[]>('/inventory/locations')
      .then(rows => {
        if (!active) return;
        const warehouses = rows.filter(
          l => l.type === 'WAREHOUSE' && l.active
        );
        setLocations(warehouses);
        setWarehouseId(warehouses[0]?.id || '');
      })
      .catch(e => {
        if (active) setError(String(e.message));
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setBalances([]);

    if (!warehouseId) return;

    setLoading(true);
    setError('');

    api<Balance[]>(
      '/inventory/balances?locationId=' +
      encodeURIComponent(warehouseId)
    )
      .then(rows => {
        if (active) setBalances(rows);
      })
      .catch(e => {
        if (active) setError(String(e.message));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [warehouseId, reload]);

  const getSellable = useCallback((b: Balance) =>
    b.onHand -
    b.quarantined -
    b.reservedOnline -
    b.reservedReplenish -
    b.safetyBuffer, []);

  const hasIssue = useCallback((b: Balance) =>
    b.onHand < 0 ||
    b.quarantined < 0 ||
    b.reservedOnline < 0 ||
    b.reservedReplenish < 0 ||
    b.safetyBuffer < 0 ||
    getSellable(b) < 0, [getSellable]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return balances.filter(b => {
      const searchable = [
        b.variant.sku,
        b.variant.barcode,
        b.variant.product?.title,
        b.variant.size,
        b.variant.color,
      ].filter(Boolean).join(' ').toLowerCase();

      if (term && !searchable.includes(term)) return false;
      if (onlyLow && getSellable(b) > threshold) return false;
      if (onlyIssues && !hasIssue(b)) return false;

      return true;
    });
  }, [balances, search, onlyLow, onlyIssues, threshold, getSellable, hasIssue]);

  const summary = useMemo(() => ({
    skus: balances.length,
    onHand: balances.reduce((n,b) => n+b.onHand,0),
    sellable: balances.reduce((n,b) => n+getSellable(b),0),
    low: balances.filter(b => getSellable(b)<=threshold).length,
    issues: balances.filter(hasIssue).length,
  }), [balances, threshold, getSellable, hasIssue]);

  return (
    <section className="card stack">
      <h2>Warehouse inventory control</h2>
      <p className="muted">
        Read-only warehouse stock visibility. Low-stock alerts use
        a configurable sellable-unit threshold. Discrepancy indicators
        identify invalid stock balance relationships, not physical
        count differences.
      </p>

      <div className="row" style={{flexWrap:'wrap',gap:12}}>
        <label style={{flex:'1 1 220px'}}>
          Warehouse
          <select
            style={inputStyle}
            value={warehouseId}
            onChange={e=>setWarehouseId(e.target.value)}
          >
            <option value="">Select warehouse</option>
            {locations.map(l=>(
              <option key={l.id} value={l.id}>
                {l.code} - {l.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{flex:'1 1 220px'}}>
          Search SKU / barcode
          <input
            style={inputStyle}
            value={search}
            onChange={e=>setSearch(e.target.value)}
            placeholder="Search warehouse inventory"
          />
        </label>

        <label style={{flex:'1 1 120px'}}>
          Low-stock threshold
          <input
            style={inputStyle}
            type="number"
            min={0}
            max={100000}
            value={threshold}
            onChange={e=>setThreshold(
              Math.max(0,Math.min(100000,Number(e.target.value)||0))
            )}
          />
        </label>
      </div>

      <div className="row" style={{flexWrap:'wrap',gap:16}}>
        <label>
          <input
            type="checkbox"
            checked={onlyLow}
            onChange={e=>setOnlyLow(e.target.checked)}
          />
          {' '}Low stock only
        </label>
        <label>
          <input
            type="checkbox"
            checked={onlyIssues}
            onChange={e=>setOnlyIssues(e.target.checked)}
          />
          {' '}Balance issues only
        </label>
        <button
          type="button"
          className="secondary"
          disabled={loading || !warehouseId}
          onClick={()=>setReload(x=>x+1)}
        >
          Refresh warehouse
        </button>
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {loading && <p role="status">Loading warehouse stock...</p>}

      {!loading && !error && warehouseId && (
        <>
          <div className="grid">
            {[
              ['Stocked SKUs',summary.skus],
              ['On-hand units',summary.onHand],
              ['Sellable units',summary.sellable],
              ['Low-stock SKUs',summary.low],
              ['Balance issues',summary.issues],
            ].map(([label,value])=>(
              <div className="card" key={String(label)}>
                <span className="muted">{label}</span>
                <div className="metric">{value}</div>
              </div>
            ))}
          </div>

          <p className="muted">
            Showing {filtered.length} of {balances.length} stocked variants.
            Variants with no stock-balance record are not included.
          </p>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Size / color</th>
                  <th>On hand</th>
                  <th>Reserved</th>
                  <th>Quarantined</th>
                  <th>Safety buffer</th>
                  <th>Sellable</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b=>{
                  const sellable=getSellable(b);
                  const issue=hasIssue(b);
                  const low=sellable<=threshold;

                  return (
                    <tr key={b.id}>
                      <td title={b.variantId}>{b.variant.sku}</td>
                      <td>
                        {[b.variant.size,b.variant.color]
                          .filter(Boolean).join(' / ') || '-'}
                      </td>
                      <td>{b.onHand}</td>
                      <td>{b.reservedOnline+b.reservedReplenish}</td>
                      <td>{b.quarantined}</td>
                      <td>{b.safetyBuffer}</td>
                      <td>{sellable}</td>
                      <td>
                        {issue ? 'Balance issue' :
                          low ? 'Low stock' : 'Healthy'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length===0 && (
            <p className="muted">No warehouse stock matches the filters.</p>
          )}
        </>
      )}

      {!loading && !error && locations.length===0 && (
        <p className="muted">No accessible active warehouses found.</p>
      )}
    </section>
  );
}