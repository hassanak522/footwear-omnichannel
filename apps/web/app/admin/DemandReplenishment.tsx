'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';

type Location = {
  id:string;
  name:string;
  type:string;
  isActive?:boolean;
};

type Balance = {
  locationId:string;
  variantId:string;
  onHand:number;
  quarantined:number;
  reservedOnline:number;
  reservedReplenish:number;
  safetyBuffer:number;
  variant?:{sku?:string};
};

type Plan = {
  branchId:string;
  branchName:string;
  variantId:string;
  sku:string;
  available:number;
  target:number;
  required:number;
  allocated:number;
  unmet:number;
  daysCover:number;
  priority:string;
};

function available(b:Balance) {
  return Math.max(0,
    Number(b.onHand || 0) -
    Number(b.quarantined || 0) -
    Number(b.reservedOnline || 0) -
    Number(b.reservedReplenish || 0) -
    Number(b.safetyBuffer || 0)
  );
}

function csvCell(value:unknown) {
  const raw = String(value ?? '');
  const safe = /^\s*[=+\-@\t\r]/.test(raw)
    ? "'"+raw : raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}

async function api(path:string) {
  const response = await fetch('/api/v1'+path,{
    credentials:'include',
    cache:'no-store'
  });

  if (!response.ok) {
    throw new Error(`Inventory request failed: HTTP ${response.status}`);
  }

  return response.json();
}

export default function DemandReplenishment() {
  const [locations,setLocations] = useState<Location[]>([]);
  const [balances,setBalances] = useState<Balance[]>([]);
  const [warehouseId,setWarehouseId] = useState('');
  const [dailyDemand,setDailyDemand] = useState(2);
  const [leadDays,setLeadDays] = useState(3);
  const [coverDays,setCoverDays] = useState(7);
  const [safety,setSafety] = useState(5);
  const [branch,setBranch] = useState('ALL');
  const [search,setSearch] = useState('');
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const locs = await api('/inventory/locations');

      if (!Array.isArray(locs)) {
        throw new Error('Unexpected locations response');
      }

      const relevant:Location[] = locs.filter(
        (l:Location) => l.isActive !== false &&
          ['WAREHOUSE','BRANCH'].includes(l.type)
      );

      const responses = await Promise.all(
        relevant.map(async l => {
          const result = await api(
            '/inventory/balances?locationId=' +
            encodeURIComponent(l.id)
          );

          if (!Array.isArray(result)) {
            throw new Error('Unexpected inventory response');
          }

          return result as Balance[];
        })
      );

      setLocations(relevant);
      setBalances(responses.flat());

      setWarehouseId(previous =>
        relevant.some(l =>
          l.id === previous && l.type === 'WAREHOUSE'
        )
          ? previous
          : relevant.find(l => l.type === 'WAREHOUSE')?.id || ''
      );
    } catch(e) {
      setError(e instanceof Error ? e.message : 'Unable to load');
      setLocations([]);
      setBalances([]);
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(() => {
    void load();
  },[load]);

  const valid =
    Number.isFinite(dailyDemand) && dailyDemand > 0 &&
    Number.isInteger(leadDays) && leadDays >= 0 &&
    Number.isInteger(coverDays) && coverDays >= 1 &&
    Number.isInteger(safety) && safety >= 0 &&
    dailyDemand <= 100000 &&
    leadDays <= 365 &&
    coverDays <= 365 &&
    safety <= 100000;

  const plan = useMemo(() => {
    if (!warehouseId || !valid) return [] as Plan[];

    const warehouse = new Map(
      balances.filter(b => b.locationId === warehouseId)
        .map(b => [b.variantId,available(b)])
    );

    const names = new Map(locations.map(l => [l.id,l.name]));

    const branches = new Set(
      locations.filter(l => l.type === 'BRANCH').map(l => l.id)
    );

    const raw:Plan[] = [];

    for (const b of balances) {
      if (!branches.has(b.locationId)) continue;

      const stock = available(b);
      const target = Math.ceil(
        dailyDemand * (leadDays + coverDays) + safety
      );

      const required = Math.max(0,target-stock);

      if (!required) continue;

      const daysCover = stock / dailyDemand;

      const priority =
        daysCover <= leadDays ? 'CRITICAL' :
        daysCover <= leadDays + 2 ? 'HIGH' :
        'NORMAL';

      raw.push({
        branchId:b.locationId,
        branchName:names.get(b.locationId) || b.locationId,
        variantId:b.variantId,
        sku:b.variant?.sku || b.variantId,
        available:stock,
        target,
        required,
        allocated:0,
        unmet:required,
        daysCover,
        priority
      });
    }

    // Prioritize branches with the lowest days of cover.
    raw.sort((a,b) =>
      a.daysCover-b.daysCover ||
      a.branchName.localeCompare(b.branchName) ||
      a.sku.localeCompare(b.sku)
    );

    for (const r of raw) {
      const remaining = warehouse.get(r.variantId) || 0;
      r.allocated = Math.min(r.required,remaining);
      r.unmet = r.required-r.allocated;
      warehouse.set(r.variantId,remaining-r.allocated);
    }

    return raw;
  },[
    warehouseId,valid,balances,locations,
    dailyDemand,leadDays,coverDays,safety
  ]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return plan.filter(r =>
      (branch === 'ALL' || r.branchId === branch) &&
      (!q ||
        r.sku.toLowerCase().includes(q) ||
        r.branchName.toLowerCase().includes(q))
    );
  },[plan,branch,search]);

  const metrics = {
    rows:filtered.length,
    required:filtered.reduce((n,r) => n+r.required,0),
    allocated:filtered.reduce((n,r) => n+r.allocated,0),
    unmet:filtered.reduce((n,r) => n+r.unmet,0),
    critical:filtered.filter(r => r.priority === 'CRITICAL').length
  };

  function exportCSV() {
    const headers = [
      'Branch','SKU','Priority','Available',
      'Estimated Daily Demand','Lead Days','Coverage Days',
      'Safety Units','Days of Cover','Target',
      'Required','Suggested Allocation','Unmet'
    ];

    const rows = filtered.map(r => [
      r.branchName,r.sku,r.priority,r.available,
      dailyDemand,leadDays,coverDays,safety,
      r.daysCover.toFixed(1),r.target,r.required,
      r.allocated,r.unmet
    ]);

    const csv = [headers,...rows]
      .map(row => row.map(csvCell).join(','))
      .join('\r\n');

    const blob = new Blob(['\uFEFF'+csv],{
      type:'text/csv;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'royal-step-demand-replenishment.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card stack">
      <div className="row">
        <div>
          <h2>Demand-based replenishment planning</h2>
          <p className="muted">
            Estimate branch requirements and prioritize
            available warehouse stock.
          </p>
        </div>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? 'Loading...' : 'Refresh stock'}
        </button>
      </div>

      {error && <p role="alert" className="error">{error}</p>}

      <p className="muted">
        Scenario planning only. Daily demand is a manager-entered
        assumption applied to each branch/SKU, not a forecast
        derived from historical POS sales. No transfer is created
        automatically.
      </p>

      <div className="grid">
        <label>
          Source warehouse
          <select
            value={warehouseId}
            onChange={e => setWarehouseId(e.target.value)}
          >
            <option value="">Select warehouse</option>
            {locations.filter(l => l.type === 'WAREHOUSE').map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>

        <label>
          Estimated daily sales per SKU/branch
          <input
            type="number"
            min={0.01}
            max={100000}
            step={0.25}
            value={dailyDemand}
            onChange={e => setDailyDemand(Number(e.target.value))}
          />
        </label>

        <label>
          Replenishment lead time (days)
          <input
            type="number"
            min={0}
            max={365}
            step={1}
            value={leadDays}
            onChange={e => setLeadDays(Number(e.target.value))}
          />
        </label>

        <label>
          Target coverage after lead time (days)
          <input
            type="number"
            min={1}
            max={365}
            step={1}
            value={coverDays}
            onChange={e => setCoverDays(Number(e.target.value))}
          />
        </label>

        <label>
          Safety stock per SKU/branch
          <input
            type="number"
            min={0}
            max={100000}
            step={1}
            value={safety}
            onChange={e => setSafety(Number(e.target.value))}
          />
        </label>

        <label>
          Branch filter
          <select
            value={branch}
            onChange={e => setBranch(e.target.value)}
          >
            <option value="ALL">All branches</option>
            {locations.filter(l => l.type === 'BRANCH').map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>

        <label>
          Search SKU or branch
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search"
          />
        </label>
      </div>

      {!valid && (
        <p role="alert" className="error">
          Enter valid nonnegative planning parameters and
          a daily demand greater than zero.
        </p>
      )}

      <div className="grid">
        {[
          ['SKU/branch needs',metrics.rows],
          ['Critical needs',metrics.critical],
          ['Required units',metrics.required],
          ['Allocatable units',metrics.allocated],
          ['Unmet units',metrics.unmet]
        ].map(([label,value]) => (
          <div className="card" key={String(label)}>
            <span className="muted">{label}</span>
            <div className="metric">{value}</div>
          </div>
        ))}
      </div>

      <div className="row">
        <h3>Prioritized replenishment recommendations</h3>
        <button
          className="secondary right"
          disabled={loading || !valid || !filtered.length}
          onClick={exportCSV}
        >
          Export plan CSV
        </button>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Branch</th>
              <th>SKU</th>
              <th>Available</th>
              <th>Days cover</th>
              <th>Target</th>
              <th>Required</th>
              <th>Allocation</th>
              <th>Unmet</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={`${r.branchId}:${r.variantId}`}>
                <td>{r.priority}</td>
                <td>{r.branchName}</td>
                <td>{r.sku}</td>
                <td>{r.available}</td>
                <td>{r.daysCover.toFixed(1)}</td>
                <td>{r.target}</td>
                <td>{r.required}</td>
                <td>{r.allocated}</td>
                <td>{r.unmet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && !filtered.length && (
        <p className="muted">
          No replenishment requirements match these settings.
        </p>
      )}

      <p className="muted">
        Allocations are calculated across all branches before
        applying display filters. Only existing branch/SKU
        balance records are evaluated. Warehouse stock is
        allocated by lowest days of cover first; this is a
        planning recommendation, not a reservation.
        Use the existing Replenishment planner to create
        actual transfer requests.
      </p>
    </section>
  );
}