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
  code?:string;
  type:string;
};

type Receipt = {
  variantId:string;
  receivedQty:number;
  damagedQty:number;
};

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

function outstanding(item:Item) {
  return Math.max(
    0,
    item.dispatchedQty -
    item.receivedQty -
    item.damagedQty -
    item.shortageQty
  );
}

export default function DispatchReceiving() {
  const [transfers,setTransfers] = useState<Transfer[]>([]);
  const [locations,setLocations] = useState<Location[]>([]);
  const [skus,setSkus] = useState<Record<string,string>>({});
  const [selectedId,setSelectedId] = useState('');
  const [receipt,setReceipt] = useState<Receipt[]>([]);
  const [filter,setFilter] = useState('ALL');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');

  const pendingKeys = useRef<Record<string,string>>({});

  const load = useCallback(async () => {
    setLoading(true);
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

      const map:Record<string,string> = {};

      for (const p of ps) {
        for (const v of p.variants || []) {
          map[v.id] = v.sku;
        }
      }

      setTransfers(ts);
      setLocations(ls);
      setSkus(map);
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

  const active = useMemo(() => transfers.filter(t => {
    const source = locationMap.get(t.sourceId);
    const destination = locationMap.get(t.destinationId);

    return source?.type === 'WAREHOUSE' &&
      destination?.type === 'BRANCH' &&
      ['APPROVED','DISPATCHED','PARTIALLY_RECEIVED']
        .includes(t.status);
  }),[transfers,locationMap]);

  const visible = active.filter(t =>
    filter === 'ALL' || t.status === filter
  );

  const selected = active.find(t => t.id === selectedId);

  const summary = {
    ready:active.filter(t => t.status === 'APPROVED').length,
    transit:active.filter(t =>
      ['DISPATCHED','PARTIALLY_RECEIVED'].includes(t.status)
    ).length,
    outstanding:active.reduce(
      (sum,t) => sum + t.items.reduce(
        (n,item) => n + outstanding(item),0
      ),0
    )
  };

  function choose(t:Transfer) {
    setSelectedId(t.id);
    setError('');
    setNotice('');

    setReceipt(t.items.map(item => ({
      variantId:item.variantId,
      receivedQty:outstanding(item),
      damagedQty:0
    })));
  }

  function changeReceipt(
    variantId:string,
    field:'receivedQty'|'damagedQty',
    value:number
  ) {
    setReceipt(old => old.map(r =>
      r.variantId === variantId
        ? {...r,[field]:value}
        : r
    ));
  }

  async function dispatch() {
    if (!selected || selected.status !== 'APPROVED' || busy) return;

    if (!window.confirm(
      `Dispatch ${selected.transferNumber}? ` +
      'Source warehouse inventory will be deducted.'
    )) return;

    setBusy(true);
    setError('');
    setNotice('');

    const actionKey = `dispatch:${selected.id}`;
    const idempotencyKey =
      pendingKeys.current[actionKey] || crypto.randomUUID();

    pendingKeys.current[actionKey] = idempotencyKey;

    try {
      await api(
        `/transfers/${encodeURIComponent(selected.id)}/dispatch`,
        'POST',
        {idempotencyKey}
      );

      delete pendingKeys.current[actionKey];

      setNotice(
        `${selected.transferNumber} dispatched successfully.`
      );

      await load();
    } catch(e) {
      setError(e instanceof Error ? e.message : 'Dispatch failed');
    } finally {
      setBusy(false);
    }
  }

  async function receive() {
    if (!selected || busy ||
        !['DISPATCHED','PARTIALLY_RECEIVED']
          .includes(selected.status)) return;

    const items = selected.items.map(item => {
      const entered = receipt.find(
        r => r.variantId === item.variantId
      );

      return {
        variantId:item.variantId,
        receivedQty:Number(entered?.receivedQty ?? 0),
        damagedQty:Number(entered?.damagedQty ?? 0)
      };
    });

    const valid = items.every((r,index) => {
      const remaining = outstanding(selected.items[index]);

      return Number.isInteger(r.receivedQty) &&
        Number.isInteger(r.damagedQty) &&
        r.receivedQty >= 0 &&
        r.damagedQty >= 0 &&
        r.receivedQty + r.damagedQty <= remaining;
    });

    const total = items.reduce(
      (sum,r) => sum + r.receivedQty + r.damagedQty,0
    );

    if (!valid || total < 1) {
      setError(
        'Enter valid quantities within outstanding limits. ' +
        'At least one unit must be received or damaged.'
      );
      return;
    }

    if (!window.confirm(
      `Confirm physical receipt of ${total} unit(s)? ` +
      'Received units increase branch inventory; ' +
      'damaged units will be quarantined.'
    )) return;

    setBusy(true);
    setError('');
    setNotice('');

    const signature = JSON.stringify({
      transferId:selected.id,
      items
    });

    const actionKey = `receive:${signature}`;
    const idempotencyKey =
      pendingKeys.current[actionKey] || crypto.randomUUID();

    pendingKeys.current[actionKey] = idempotencyKey;

    try {
      await api(
        `/transfers/${encodeURIComponent(selected.id)}/receive`,
        'POST',
        {items,idempotencyKey}
      );

      delete pendingKeys.current[actionKey];

      setNotice('Branch receipt recorded successfully.');
      setSelectedId('');
      setReceipt([]);

      await load();
    } catch(e) {
      setError(e instanceof Error ? e.message : 'Receipt failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div className="row">
        <div>
          <h2>Warehouse dispatch & branch receiving</h2>
          <p className="muted">
            Dispatch approved transfers and record physical
            branch receipts, including damaged stock.
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

      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <div className="grid">
        <div className="card">
          <span className="muted">Ready to dispatch</span>
          <div className="metric">{summary.ready}</div>
        </div>
        <div className="card">
          <span className="muted">In transit / partial</span>
          <div className="metric">{summary.transit}</div>
        </div>
        <div className="card">
          <span className="muted">Outstanding units</span>
          <div className="metric">{summary.outstanding}</div>
        </div>
      </div>

      <label>
        Transfer status
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
        >
          <option value="ALL">All active transfers</option>
          <option value="APPROVED">Approved</option>
          <option value="DISPATCHED">Dispatched</option>
          <option value="PARTIALLY_RECEIVED">
            Partially received
          </option>
        </select>
      </label>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Transfer</th>
              <th>Warehouse</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Outstanding</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(t => (
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
                  {t.items.reduce(
                    (n,item) => n + outstanding(item),0
                  )}
                </td>
                <td>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => choose(t)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && visible.length === 0 && (
        <p className="muted">No matching transfers.</p>
      )}

      {selected && (
        <div className="card stack">
          <div className="row">
            <h3>{selected.transferNumber}</h3>
            <span>{selected.status}</span>
            <button
              className="secondary right"
              disabled={busy}
              onClick={() => setSelectedId('')}
            >
              Close
            </button>
          </div>

          <p>
            {locationMap.get(selected.sourceId)?.name ||
              selected.sourceId}
            {' → '}
            {locationMap.get(selected.destinationId)?.name ||
              selected.destinationId}
          </p>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Requested</th>
                  <th>Dispatched</th>
                  <th>Previously received</th>
                  <th>Damaged</th>
                  <th>Outstanding</th>
                  <th>Receive now</th>
                  <th>Damaged now</th>
                </tr>
              </thead>
              <tbody>
                {selected.items.map(item => {
                  const r = receipt.find(
                    x => x.variantId === item.variantId
                  );

                  const canReceive =
                    ['DISPATCHED','PARTIALLY_RECEIVED']
                      .includes(selected.status);

                  return (
                    <tr key={item.variantId}>
                      <td>
                        {skus[item.variantId] || item.variantId}
                      </td>
                      <td>{item.requestedQty}</td>
                      <td>{item.dispatchedQty}</td>
                      <td>{item.receivedQty}</td>
                      <td>{item.damagedQty}</td>
                      <td>{outstanding(item)}</td>
                      <td>
                        <input
                          aria-label={`Receive ${item.variantId}`}
                          type="number"
                          min={0}
                          max={outstanding(item)}
                          step={1}
                          disabled={!canReceive || busy}
                          value={r?.receivedQty ?? 0}
                          onChange={e => changeReceipt(
                            item.variantId,
                            'receivedQty',
                            Number(e.target.value)
                          )}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Damaged ${item.variantId}`}
                          type="number"
                          min={0}
                          max={outstanding(item)}
                          step={1}
                          disabled={!canReceive || busy}
                          value={r?.damagedQty ?? 0}
                          onChange={e => changeReceipt(
                            item.variantId,
                            'damagedQty',
                            Number(e.target.value)
                          )}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected.status === 'APPROVED' && (
            <button disabled={busy} onClick={() => void dispatch()}>
              {busy ? 'Processing...' : 'Confirm dispatch'}
            </button>
          )}

          {['DISPATCHED','PARTIALLY_RECEIVED']
            .includes(selected.status) && (
            <button disabled={busy} onClick={() => void receive()}>
              {busy ? 'Processing...' : 'Record branch receipt'}
            </button>
          )}

          <p className="muted">
            Only authorized users can dispatch or receive.
            Inventory changes are enforced by the backend.
            Outstanding shortages can be closed in Transfers.
          </p>
        </div>
      )}
    </section>
  );
}