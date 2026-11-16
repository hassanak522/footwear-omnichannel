'use client';

import { useEffect, useMemo, useState } from 'react';

type Location = {
  id: string;
  name: string;
  code?: string;
  type?: string;
  isActive?: boolean;
};

type Balance = {
  locationId: string;
  variantId: string;
  onHand: number;
  quarantined: number;
  reservedOnline: number;
  reservedReplenish: number;
  safetyBuffer: number;
  variant?: {
    sku?: string;
    barcode?: string;
  };
};

type Recommendation = {
  branchId: string;
  branchName: string;
  variantId: string;
  sku: string;
  branchAvailable: number;
  warehouseAvailable: number;
  required: number;
  suggested: number;
  shortage: number;
  status: string;
};

function available(b: Balance): number {
  return Math.max(
    0,
    Number(b.onHand || 0) -
    Number(b.quarantined || 0) -
    Number(b.reservedOnline || 0) -
    Number(b.reservedReplenish || 0) -
    Number(b.safetyBuffer || 0)
  );
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const safe = /^\s*[=+\-@\t\r]/.test(raw)
    ? "'" + raw
    : raw;

  return '"' + safe.replace(/"/g, '""') + '"';
}

export default function ReplenishmentPlanner() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [minimum, setMinimum] = useState(5);
  const [target, setTarget] = useState(15);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [pendingKeys, setPendingKeys] =
    useState<Record<string, string>>({});

  async function getJSON(path: string) {
    const response = await fetch('/api/v1' + path, {
      credentials: 'same-origin',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(
        `Unable to load inventory (${response.status})`
      );
    }

    return response.json();
  }

  async function load() {
    setLoading(true);
    setError('');

    try {
      const locs = await getJSON('/inventory/locations');

      if (!Array.isArray(locs)) {
        throw new Error('Invalid location response');
      }

      const active = locs.filter(
        (l: Location) => l.isActive !== false
      );

      const relevant = active.filter(
        (l: Location) =>
          l.type === 'WAREHOUSE' || l.type === 'BRANCH'
      );

      const responses = await Promise.all(
        relevant.map(async (l: Location) => {
          const data = await getJSON(
            '/inventory/balances?locationId=' +
            encodeURIComponent(l.id)
          );

          if (!Array.isArray(data)) {
            throw new Error('Invalid stock balance response');
          }

          return data as Balance[];
        })
      );

      setLocations(relevant);
      setBalances(responses.flat());

      setWarehouseId(previous =>
        relevant.some(
          (l: Location) =>
            l.id === previous && l.type === 'WAREHOUSE'
        )
          ? previous
          : relevant.find(
              (l: Location) => l.type === 'WAREHOUSE'
            )?.id || ''
      );
    } catch (err) {
      setLocations([]);
      setBalances([]);
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load replenishment data'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const recommendations = useMemo(() => {
    const warehouse = locations.find(
      l => l.id === warehouseId
    );

    if (!warehouse || target < minimum || minimum < 0) {
      return [] as Recommendation[];
    }

    const warehouseBalances = balances.filter(
      b => b.locationId === warehouseId
    );

    const warehouseByVariant = new Map(
      warehouseBalances.map(b => [b.variantId, b])
    );

    const branches = locations.filter(
      l => l.type === 'BRANCH'
    );

    const raw: Recommendation[] = [];

    for (const branch of branches) {
      const branchBalances = balances.filter(
        b => b.locationId === branch.id
      );

      for (const balance of branchBalances) {
        const branchAvailable = available(balance);

        if (branchAvailable > minimum) continue;

        const warehouseBalance =
          warehouseByVariant.get(balance.variantId);

        const warehouseAvailable = warehouseBalance
          ? available(warehouseBalance)
          : 0;

        const required = Math.max(
          0,
          target - branchAvailable
        );

        if (!required) continue;

        raw.push({
          branchId: branch.id,
          branchName: branch.name,
          variantId: balance.variantId,
          sku: balance.variant?.sku || balance.variantId,
          branchAvailable,
          warehouseAvailable,
          required,
          suggested: 0,
          shortage: required,
          status: 'PENDING'
        });
      }
    }

    // Prioritize branches with the lowest availability.
    raw.sort(
      (a,b) =>
        a.branchAvailable - b.branchAvailable ||
        a.branchName.localeCompare(b.branchName) ||
        a.sku.localeCompare(b.sku)
    );

    const remaining = new Map<string,number>();

    for (const b of warehouseBalances) {
      remaining.set(b.variantId, available(b));
    }

    for (const row of raw) {
      const stock = remaining.get(row.variantId) || 0;
      row.suggested = Math.min(row.required, stock);
      row.shortage = row.required - row.suggested;

      remaining.set(
        row.variantId,
        stock - row.suggested
      );

      row.status =
        row.suggested === 0 ? 'NO WAREHOUSE STOCK' :
        row.shortage > 0 ? 'PARTIAL' :
        'READY';
    }

    const q = search.trim().toLowerCase();

    return raw.filter(r =>
      !q ||
      r.sku.toLowerCase().includes(q) ||
      r.branchName.toLowerCase().includes(q)
    );
  }, [
    locations,
    balances,
    warehouseId,
    minimum,
    target,
    search
  ]);

  const summary = useMemo(() => ({
    recommendations: recommendations.length,
    required: recommendations.reduce(
      (sum,r) => sum + r.required,0
    ),
    suggested: recommendations.reduce(
      (sum,r) => sum + r.suggested,0
    ),
    unfulfilled: recommendations.reduce(
      (sum,r) => sum + r.shortage,0
    )
  }), [recommendations]);

  const keyFor = (r: Recommendation) =>
    `${r.branchId}:${r.variantId}`;

  const selectedRows = recommendations.filter(
    r => r.suggested > 0 && selected.includes(keyFor(r))
  );

  function toggleRow(r: Recommendation, checked: boolean) {
    const key = keyFor(r);
    setSelected(old => checked
      ? Array.from(new Set([...old,key]))
      : old.filter(x => x !== key)
    );
    setPendingKeys({});
  }

  async function createRequests() {
    if (creating || loading || !warehouseId ||
        selectedRows.length === 0) return;

    const groups = new Map<string, Recommendation[]>();

    for (const r of selectedRows) {
      const group = groups.get(r.branchId) || [];
      group.push(r);
      groups.set(r.branchId,group);
    }

    const batches = [...groups.entries()].map(
      ([destinationId,rows]) => ({
        destinationId,
        rows,
        items: rows.map(r => ({
          variantId: r.variantId,
          quantity: r.suggested
        }))
      })
    );

    if (!window.confirm(
      `Create ${batches.length} transfer request(s) for manager review? ` +
      'No inventory will be reserved or dispatched.'
    )) return;

    setCreating(true);
    setError('');
    setNotice('');

    const keys = {...pendingKeys};
    const completed: string[] = [];
    const failures: string[] = [];

    for (const batch of batches) {
      const signature = JSON.stringify({
        sourceId: warehouseId,
        destinationId: batch.destinationId,
        items: batch.items
      });

      const idempotencyKey =
        keys[signature] || crypto.randomUUID();

      keys[signature] = idempotencyKey;

      try {
        const response = await fetch('/api/v1/transfers', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            sourceId: warehouseId,
            destinationId: batch.destinationId,
            items: batch.items,
            idempotencyKey
          })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          const message = Array.isArray(result.message)
            ? result.message.join('; ')
            : result.message || `HTTP ${response.status}`;
          throw new Error(message);
        }

        completed.push(batch.destinationId);
        delete keys[signature];
      } catch (e) {
        failures.push(
          `${batch.destinationId}: ` +
          (e instanceof Error ? e.message : 'Request failed')
        );
      }
    }

    setPendingKeys(keys);
    setSelected(old => old.filter(key =>
      !completed.some(branch => key.startsWith(branch + ':'))
    ));

    if (completed.length) {
      setNotice(
        `${completed.length} transfer request(s) created. ` +
        'Review them in Transfers before approval.'
      );
    }

    if (failures.length) {
      setError(failures.join(' | '));
    }

    setCreating(false);
  }

  function exportCSV() {
    const headers = [
      'Branch', 'SKU', 'Variant ID',
      'Branch Available', 'Warehouse Available',
      'Required', 'Suggested', 'Unfulfilled', 'Status'
    ];

    const rows = recommendations.map(r => [
      r.branchName, r.sku, r.variantId,
      r.branchAvailable, r.warehouseAvailable,
      r.required, r.suggested, r.shortage, r.status
    ]);

    const csv = [headers,...rows]
      .map(row => row.map(csvCell).join(','))
      .join('\r\n');

    const blob = new Blob(
      ['\uFEFF' + csv],
      {type:'text/csv;charset=utf-8;'}
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'royal-step-replenishment-plan.csv';

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  return (
    <section className="card stack">
      <div className="row">
        <div>
          <h2>Warehouse replenishment planner</h2>
          <p className="muted">
            Suggested warehouse-to-branch allocations.
            No inventory is changed by this dashboard.
          </p>
        </div>

        <button
          className="secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p role="alert" className="error">{error}</p>
      )}

      <div className="grid">
        <label>
          Source warehouse
          <select
            value={warehouseId}
            onChange={e => setWarehouseId(e.target.value)}
          >
            {locations
              .filter(l => l.type === 'WAREHOUSE')
              .map(l => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </label>

        <label>
          Reorder when available units are at or below
          <input
            type="number"
            min="0"
            value={minimum}
            onChange={e =>
              setMinimum(Math.max(0,Number(e.target.value)))
            }
          />
        </label>

        <label>
          Target available units
          <input
            type="number"
            min="1"
            value={target}
            onChange={e =>
              setTarget(Math.max(1,Number(e.target.value)))
            }
          />
        </label>

        <label>
          Search SKU or branch
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recommendations"
          />
        </label>
      </div>

      {target < minimum && (
        <p className="error">
          Target quantity must be at least the reorder threshold.
        </p>
      )}

      <div className="grid">
        {[
          ['Recommendations',summary.recommendations],
          ['Required units',summary.required],
          ['Suggested allocation',summary.suggested],
          ['Unfulfilled units',summary.unfulfilled]
        ].map(([label,value]) => (
          <div className="card" key={String(label)}>
            <span className="muted">{label}</span>
            <div className="metric">{value}</div>
          </div>
        ))}
      </div>

      <div className="row">
        <h3>Suggested allocations</h3>
        <button
          className="secondary right"
          disabled={!recommendations.length}
          onClick={exportCSV}
        >
          Export CSV
        </button>
      </div>

      {notice && <p role="status">{notice}</p>}

      <div className="row">
        <strong>
          {selectedRows.length} selected allocation(s)
        </strong>

        <button
          disabled={creating || loading || selectedRows.length === 0}
          onClick={() => void createRequests()}
        >
          {creating
            ? 'Creating requests...'
            : 'Create transfer requests for review'}
        </button>
      </div>

        <table>
          <thead>
            <tr>
              <th>Select</th>
              <th>Branch</th>
              <th>SKU</th>
              <th>Available</th>
              <th>Warehouse</th>
              <th>Required</th>
              <th>Suggested</th>
              <th>Unfulfilled</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {recommendations.map(r => (
              <tr key={`${r.branchId}-${r.variantId}`}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.sku} for ${r.branchName}`}
                    checked={selected.includes(keyFor(r))}
                    disabled={r.suggested <= 0 || creating}
                    onChange={e => toggleRow(r,e.target.checked)}
                  />
                </td>
                <td>{r.branchName}</td>
                <td>{r.sku}</td>
                <td>{r.branchAvailable}</td>
                <td>{r.warehouseAvailable}</td>
                <td>{r.required}</td>
                <td>{r.suggested}</td>
                <td>{r.shortage}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && recommendations.length === 0 && (
        <p className="muted">
          No replenishment recommendations for these thresholds.
        </p>
      )}

      <p className="muted">
        Recommendations are calculated from current available
        balances. Review and create actual stock transfers through
        the existing Transfers workflow.
      </p>
    </section>
  );
}