'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';

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
  dispatchedAt?:string|null;
  receivedAt?:string|null;
  items:Item[];
};

type Location = {
  id:string;
  name:string;
  code?:string;
  type:string;
};

type Summary = {
  requested:number;
  dispatched:number;
  received:number;
  damaged:number;
  shortage:number;
  outstanding:number;
};

function num(value:unknown):number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function total(items:Item[]):Summary {
  return (items || []).reduce((a,i) => {
    a.requested += num(i.requestedQty);
    a.dispatched += num(i.dispatchedQty);
    a.received += num(i.receivedQty);
    a.damaged += num(i.damagedQty);
    a.shortage += num(i.shortageQty);
    a.outstanding += Math.max(0,
      num(i.dispatchedQty) -
      num(i.receivedQty) -
      num(i.damagedQty) -
      num(i.shortageQty)
    );
    return a;
  },{
    requested:0,dispatched:0,received:0,
    damaged:0,shortage:0,outstanding:0
  });
}

function percent(a:number,b:number):string {
  return b > 0 ? (a * 100 / b).toFixed(1)+'%' : '—';
}

function csvCell(value:unknown):string {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? "'"+raw : raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}

async function api(path:string) {
  const response = await fetch('/api/v1'+path,{
    credentials:'include',
    cache:'no-store'
  });

  if (!response.ok) {
    throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  }

  return response.json();
}

export default function FulfillmentAnalytics() {
  const [transfers,setTransfers] = useState<Transfer[]>([]);
  const [locations,setLocations] = useState<Location[]>([]);
  const [branch,setBranch] = useState('ALL');
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [search,setSearch] = useState('');
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [ts,ls] = await Promise.all([
        api('/transfers'),
        api('/inventory/locations')
      ]);

      if (!Array.isArray(ts) || !Array.isArray(ls)) {
        throw new Error('Unexpected transfer or location response');
      }

      setTransfers(ts);
      setLocations(ls);
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

  const warehouseTransfers = useMemo(() =>
    transfers.filter(t =>
      locationMap.get(t.sourceId)?.type === 'WAREHOUSE' &&
      locationMap.get(t.destinationId)?.type === 'BRANCH'
    ),[transfers,locationMap]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return warehouseTransfers.filter(t => {
      const date = t.createdAt?.slice(0,10) || '';
      const destination = locationMap.get(t.destinationId);

      return (branch === 'ALL' || t.destinationId === branch) &&
        (!from || date >= from) &&
        (!to || date <= to) &&
        (!q ||
          (t.transferNumber || t.id).toLowerCase().includes(q) ||
          (destination?.name || '').toLowerCase().includes(q));
    });
  },[warehouseTransfers,branch,from,to,search,locationMap]);

  const overall = useMemo(
    () => total(filtered.flatMap(t => t.items || [])),
    [filtered]
  );

  const branchRows = useMemo(() => {
    const grouped = new Map<string,Transfer[]>();

    for (const t of filtered) {
      const group = grouped.get(t.destinationId) || [];
      group.push(t);
      grouped.set(t.destinationId,group);
    }

    return [...grouped.entries()].map(([id,ts]) => ({
      id,
      name:locationMap.get(id)?.name || id,
      count:ts.length,
      ...total(ts.flatMap(t => t.items || []))
    })).sort((a,b) => a.name.localeCompare(b.name));
  },[filtered,locationMap]);

  const statusRows = useMemo(() => {
    const grouped = new Map<string,number>();

    for (const t of filtered) {
      grouped.set(t.status,(grouped.get(t.status) || 0)+1);
    }

    return [...grouped.entries()]
      .map(([name,count]) => ({name,count}))
      .sort((a,b) => b.count-a.count);
  },[filtered]);

  function exportCSV() {
    const headers = [
      'Transfer','Created Date','Source','Destination','Status',
      'Requested','Dispatched','Good Received','Damaged',
      'Shortage','Outstanding','Good Fulfillment %'
    ];

    const rows = filtered.map(t => {
      const s = total(t.items || []);
      return [
        t.transferNumber || t.id,
        t.createdAt,
        locationMap.get(t.sourceId)?.name || t.sourceId,
        locationMap.get(t.destinationId)?.name || t.destinationId,
        t.status,s.requested,s.dispatched,s.received,
        s.damaged,s.shortage,s.outstanding,
        s.dispatched > 0
          ? (100*s.received/s.dispatched).toFixed(1)
          : ''
      ];
    });

    const csv = [headers,...rows]
      .map(row => row.map(csvCell).join(','))
      .join('\r\n');

    const blob = new Blob(['\uFEFF'+csv],{
      type:'text/csv;charset=utf-8;'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'royal-step-fulfillment-analytics.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const maxBranchUnits = Math.max(
    1,...branchRows.map(r => r.dispatched)
  );

  return (
    <section className="card stack">
      <div className="row">
        <div>
          <h2>Warehouse-to-branch fulfillment analytics</h2>
          <p className="muted">
            Operational performance across warehouse transfers
            and retail branches.
          </p>
        </div>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <p role="alert" className="error">{error}</p>}

      <div className="grid">
        <label>
          Destination branch
          <select
            value={branch}
            onChange={e => setBranch(e.target.value)}
          >
            <option value="ALL">All branches</option>
            {locations.filter(l => l.type === 'BRANCH').map(l => (
              <option value={l.id} key={l.id}>{l.name}</option>
            ))}
          </select>
        </label>

        <label>
          Created from (UTC)
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={e => setFrom(e.target.value)}
          />
        </label>

        <label>
          Created through (UTC)
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={e => setTo(e.target.value)}
          />
        </label>

        <label>
          Search transfer or branch
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search"
          />
        </label>
      </div>

      <div className="grid">
        {[
          ['Transfers',filtered.length],
          ['Requested units',overall.requested],
          ['Dispatched units',overall.dispatched],
          ['Good units received',overall.received],
          ['Damaged units',overall.damaged],
          ['Shortage units',overall.shortage],
          ['Outstanding units',overall.outstanding],
          ['Good-unit fulfillment',
            percent(overall.received,overall.dispatched)]
        ].map(([label,value]) => (
          <div className="card" key={String(label)}>
            <span className="muted">{label}</span>
            <div className="metric">{value}</div>
          </div>
        ))}
      </div>

      <p className="muted">
        Data scope: the API returns up to 200 recent transfers
        accessible to your account. Date filters apply to
        transfer creation dates, not dispatch or receipt dates.
        Metrics are not complete historical totals.
      </p>

      <h3>Branch fulfillment performance</h3>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Branch</th>
              <th>Transfers</th>
              <th>Dispatched</th>
              <th>Good received</th>
              <th>Damaged</th>
              <th>Shortage</th>
              <th>Outstanding</th>
              <th>Fulfillment</th>
            </tr>
          </thead>
          <tbody>
            {branchRows.map(r => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.count}</td>
                <td>{r.dispatched}</td>
                <td>{r.received}</td>
                <td>{r.damaged}</td>
                <td>{r.shortage}</td>
                <td>{r.outstanding}</td>
                <td>{percent(r.received,r.dispatched)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Dispatched vs. good units received</h3>
      {branchRows.map(r => (
        <div key={r.id} className="stack">
          <strong>{r.name}</strong>
          <div
            style={{
              height:14,
              background:'#e5e7eb',
              borderRadius:8,
              overflow:'hidden'
            }}
            aria-label={`${r.name}: ${r.dispatched} dispatched`}
          >
            <div style={{
              width:`${100*r.dispatched/maxBranchUnits}%`,
              height:'100%',
              background:'#104c72'
            }}/>
          </div>
          <div
            style={{
              height:14,
              background:'#e5e7eb',
              borderRadius:8,
              overflow:'hidden'
            }}
            aria-label={`${r.name}: ${r.received} received`}
          >
            <div style={{
              width:`${100*r.received/maxBranchUnits}%`,
              height:'100%',
              background:'#ef3321'
            }}/>
          </div>
          <small className="muted">
            Dispatched: {r.dispatched} | Good received: {r.received}
          </small>
        </div>
      ))}

      <p className="muted">
        Blue bars represent dispatched units; red bars
        represent good units received. Both use the same scale.
      </p>

      <h3>Transfer status breakdown</h3>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Status</th><th>Transfers</th></tr>
          </thead>
          <tbody>
            {statusRows.map(r => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row">
        <h3>Transfer-level report</h3>
        <button
          className="secondary right"
          disabled={loading || !filtered.length}
          onClick={exportCSV}
        >
          Export filtered CSV
        </button>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Transfer</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Requested</th>
              <th>Dispatched</th>
              <th>Good received</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => {
              const s = total(t.items || []);
              return (
                <tr key={t.id}>
                  <td>{t.transferNumber || t.id}</td>
                  <td>
                    {locationMap.get(t.destinationId)?.name ||
                      t.destinationId}
                  </td>
                  <td>{t.status}</td>
                  <td>{s.requested}</td>
                  <td>{s.dispatched}</td>
                  <td>{s.received}</td>
                  <td>{s.outstanding}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length === 0 && (
        <p className="muted">
          No warehouse-to-branch transfers match these filters.
        </p>
      )}
    </section>
  );
}