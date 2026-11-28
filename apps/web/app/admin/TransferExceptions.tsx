'use client';

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';

type Item = {
  variantId:string;
  requestedQty:number;
  dispatchedQty:number;
  receivedQty:number;
  damagedQty:number;
  shortageQty:number;
};

type Transfer = {
  id:string;
  transferNumber:string;
  sourceId:string;
  destinationId:string;
  status:string;
  createdAt:string;
  items:Item[];
};

type Location = {
  id:string;
  name:string;
  type:string;
};

function qty(value:unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function outstanding(item:Item) {
  return Math.max(0,
    qty(item.dispatchedQty) -
    qty(item.receivedQty) -
    qty(item.damagedQty) -
    qty(item.shortageQty)
  );
}

async function api(path:string,method='GET',body?:unknown) {
  const response = await fetch('/api/v1'+path,{
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
    throw new Error(
      Array.isArray(data?.message)
        ? data.message.join('; ')
        : data?.message || `HTTP ${response.status}`
    );
  }

  return data;
}

export default function TransferExceptions() {
  const [transfers,setTransfers] = useState<Transfer[]>([]);
  const [locations,setLocations] = useState<Location[]>([]);
  const [skuMap,setSkuMap] = useState<Record<string,string>>({});
  const [status,setStatus] = useState('ALL');
  const [search,setSearch] = useState('');
  const [selectedId,setSelectedId] = useState('');
  const [reason,setReason] = useState('');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const pendingKeys = useRef<Record<string,string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [ts,ls,ps] = await Promise.all([
        api('/transfers'),
        api('/inventory/locations'),
        api('/catalog/products')
      ]);

      if (!Array.isArray(ts) ||
          !Array.isArray(ls) ||
          !Array.isArray(ps)) {
        throw new Error('Unexpected API response');
      }

      const skus:Record<string,string> = {};

      for (const p of ps) {
        for (const v of p.variants || []) {
          skus[v.id] = v.sku;
        }
      }

      setTransfers(ts);
      setLocations(ls);
      setSkuMap(skus);
    } catch(e) {
      setError(e instanceof Error ? e.message : 'Load failed');
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

  const rows = useMemo(() => transfers.filter(t => {
    const source = locationMap.get(t.sourceId);
    const destination = locationMap.get(t.destinationId);

    return source?.type === 'WAREHOUSE' &&
      destination?.type === 'BRANCH';
  }),[transfers,locationMap]);

  const metrics = useMemo(() => {
    const items = rows.flatMap(t => t.items || []);

    const dispatched = items.reduce(
      (n,i) => n + qty(i.dispatchedQty),0
    );

    const received = items.reduce(
      (n,i) => n + qty(i.receivedQty),0
    );

    const damaged = items.reduce(
      (n,i) => n + qty(i.damagedQty),0
    );

    const shortages = items.reduce(
      (n,i) => n + qty(i.shortageQty),0
    );

    const open = items.reduce(
      (n,i) => n + outstanding(i),0
    );

    return {
      dispatched,
      received,
      damaged,
      shortages,
      open,
      fulfillment:dispatched > 0
        ? (100 * received / dispatched).toFixed(1)
        : '—',
      partial:rows.filter(t =>
        t.status === 'PARTIALLY_RECEIVED'
      ).length
    };
  },[rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter(t => {
      const items = t.items || [];
      const hasException =
        t.status === 'PARTIALLY_RECEIVED' ||
        t.status === 'SHORTAGE_CLOSED' ||
        items.some(i =>
          qty(i.damagedQty) > 0 ||
          qty(i.shortageQty) > 0
        );

      if (status === 'EXCEPTIONS' && !hasException) return false;
      if (status === 'PARTIAL' &&
          t.status !== 'PARTIALLY_RECEIVED') return false;
      if (status === 'SHORTAGES' &&
          !items.some(i => qty(i.shortageQty) > 0)) return false;
      if (status === 'DAMAGED' &&
          !items.some(i => qty(i.damagedQty) > 0)) return false;
      if (status === 'OUTSTANDING' &&
          !items.some(i => outstanding(i) > 0)) return false;

      const destination = locationMap.get(t.destinationId);

      return !q ||
        (t.transferNumber || t.id).toLowerCase().includes(q) ||
        (destination?.name || '').toLowerCase().includes(q) ||
        items.some(i =>
          (skuMap[i.variantId] || i.variantId)
            .toLowerCase().includes(q)
        );
    });
  },[rows,status,search,locationMap,skuMap]);

  const selected = rows.find(t => t.id === selectedId);

  function select(t:Transfer) {
    setSelectedId(t.id);
    setReason('');
    setError('');
    setNotice('');
  }

  async function closeShortage() {
    if (!selected || !['DISPATCHED','PARTIALLY_RECEIVED'].includes(String(selected.status)) ||
        busy) return;

    const cleanReason = reason.trim();

    if (cleanReason.length < 10) {
      setError('Enter a shortage reason of at least 10 characters.');
      return;
    }

    const missing = selected.items.reduce(
      (n,i) => n + outstanding(i),0
    );

    if (missing <= 0) {
      setError('No outstanding units remain.');
      return;
    }

    if (!window.confirm(
      `Close ${selected.transferNumber} with ${missing} ` +
      'outstanding unit(s) recorded as shortages? ' +
      'This action cannot be treated as a stock receipt.'
    )) return;

    setBusy(true);
    setError('');
    setNotice('');

    const signature = JSON.stringify({
      id:selected.id,
      reason:cleanReason
    });

    const key = pendingKeys.current[signature] ||
      crypto.randomUUID();

    pendingKeys.current[signature] = key;

    try {
      await api(
        `/transfers/${encodeURIComponent(selected.id)}/close-shortage`,
        'POST',
        {idempotencyKey:key,reason:cleanReason}
      );

      delete pendingKeys.current[signature];

      setSelectedId('');
      setReason('');
      setNotice(
        `${selected.transferNumber}: outstanding quantities ` +
        'recorded as shortages.'
      );

      await load();
    } catch(e) {
      setError(
        e instanceof Error ? e.message : 'Shortage closure failed'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div className="row">
        <div>
          <h2>Transfer exceptions & fulfillment</h2>
          <p className="muted">
            Warehouse-to-branch fulfillment, damaged inventory,
            outstanding quantities and shortage resolution.
          </p>
        </div>
        <button
          className="secondary"
          disabled={loading || busy}
          onClick={() => void load()}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="grid">
        {[
          ['Dispatched units',metrics.dispatched],
          ['Good units received',metrics.received],
          ['Damaged units',metrics.damaged],
          ['Recorded shortage units',metrics.shortages],
          ['Outstanding units',metrics.open],
          ['Good-unit fulfillment',metrics.fulfillment === '—'
            ? '—' : metrics.fulfillment+'%']
        ].map(([label,value]) => (
          <div className="card" key={String(label)}>
            <span className="muted">{label}</span>
            <div className="metric">{value}</div>
          </div>
        ))}
      </div>

      <p className="muted">
        Metrics cover {rows.length} warehouse-to-branch transfers
        returned by the API. They are not lifetime totals.
        Good-unit fulfillment = good units received /
        dispatched units.
      </p>

      <div className="grid">
        <label>
          Exception filter
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="ALL">All warehouse transfers</option>
            <option value="EXCEPTIONS">Transfers with exceptions</option>
            <option value="PARTIAL">Partially received</option>
            <option value="SHORTAGES">Recorded shortages</option>
            <option value="DAMAGED">Damaged quantities</option>
            <option value="OUTSTANDING">Outstanding quantities</option>
          </select>
        </label>

        <label>
          Search
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Transfer, branch or SKU"
          />
        </label>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Transfer</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Received</th>
              <th>Damaged</th>
              <th>Shortage</th>
              <th>Outstanding</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(t => {
              const items = t.items || [];
              const sum = (field:
                'receivedQty'|'damagedQty'|'shortageQty'
              ) => items.reduce(
                (n,i) => n + qty(i[field]),0
              );

              return (
                <tr key={t.id}>
                  <td>{t.transferNumber || t.id}</td>
                  <td>
                    {locationMap.get(t.destinationId)?.name ||
                      t.destinationId}
                  </td>
                  <td>{t.status}</td>
                  <td>{sum('receivedQty')}</td>
                  <td>{sum('damagedQty')}</td>
                  <td>{sum('shortageQty')}</td>
                  <td>
                    {items.reduce(
                      (n,i) => n + outstanding(i),0
                    )}
                  </td>
                  <td>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => select(t)}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && visible.length === 0 && (
        <p className="muted">No matching transfers.</p>
      )}

      {selected && (
        <div className="card stack">
          <div className="row">
            <h3>{selected.transferNumber || selected.id}</h3>
            <span>{selected.status}</span>
            <button
              className="secondary right"
              disabled={busy}
              onClick={() => setSelectedId('')}
            >
              Close details
            </button>
          </div>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Dispatched</th>
                  <th>Received</th>
                  <th>Damaged</th>
                  <th>Shortage</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {selected.items.map(i => (
                  <tr key={i.variantId}>
                    <td>{skuMap[i.variantId] || i.variantId}</td>
                    <td>{i.dispatchedQty}</td>
                    <td>{i.receivedQty}</td>
                    <td>{i.damagedQty}</td>
                    <td>{i.shortageQty}</td>
                    <td>{outstanding(i)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {['DISPATCHED','PARTIALLY_RECEIVED'].includes(String(selected.status)) &&
            selected.items.some(i => outstanding(i) > 0) && (
            <>
              <p className="muted">
                Only authorized warehouse managers or super
                administrators may close remaining shortages.
                This records a shortage; it does not add stock.
              </p>

              <label>
                Shortage closure reason
                <textarea
                  rows={3}
                  value={reason}
                  disabled={busy}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Explain the missing units..."
                />
              </label>

              <button
                className="danger"
                disabled={busy || reason.trim().length < 10}
                onClick={() => void closeShortage()}
              >
                {busy
                  ? 'Closing shortage...'
                  : 'Close outstanding shortage'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}