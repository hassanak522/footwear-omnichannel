'use client';

import { useEffect, useMemo, useState } from 'react';

type CountLine = {
  id: string;
  variantId: string;
  expectedQty: number;
  countedQty: number;
};

type Count = {
  id: string;
  reference: string;
  locationId: string;
  status: string;
  createdAt?: string;
  postedAt?: string | null;
  lines?: CountLine[];
};

type Location = {
  id: string;
  name: string;
  code?: string;
};

type HistoryRow = {
  countId: string;
  reference: string;
  location: string;
  status: string;
  variantId: string;
  expectedQty: number;
  countedQty: number;
  variance: number;
  createdAt: string;
  postedAt: string;
};

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const safe = /^[\s]*[=+\-@\t\r]/.test(raw)
    ? "'" + raw
    : raw;

  return '"' + safe.replace(/"/g, '""') + '"';
}

function dateText(value?: string | null): string {
  if (!value) return '—';

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString();
}

export default function StockCountHistory() {
  const [counts, setCounts] = useState<Count[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    try {
      const responses = await Promise.all([
        fetch('/api/v1/stock-counts', {
          credentials: 'same-origin',
          cache: 'no-store'
        }),
        fetch('/api/v1/inventory/locations', {
          credentials: 'same-origin',
          cache: 'no-store'
        })
      ]);

      for (const response of responses) {
        if (!response.ok) {
          throw new Error(
            `Unable to load reconciliation data (HTTP ${response.status})`
          );
        }
      }

      const [countData, locationData] =
        await Promise.all(responses.map(r => r.json()));

      if (!Array.isArray(countData) ||
          !Array.isArray(locationData)) {
        throw new Error('Unexpected reconciliation response');
      }

      setCounts(countData);
      setLocations(locationData);
    } catch (err) {
      setCounts([]);
      setLocations([]);
      setError(
        err instanceof Error ? err.message : 'Unable to load history'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo<HistoryRow[]>(() => {
    const locationNames = new Map(
      locations.map(l => [l.id, l.name || l.code || l.id])
    );

    return counts.flatMap(count =>
      (count.lines || []).map(line => ({
        countId: count.id,
        reference: count.reference,
        location:
          locationNames.get(count.locationId) || count.locationId,
        status: count.status,
        variantId: line.variantId,
        expectedQty: line.expectedQty,
        countedQty: line.countedQty,
        variance: line.countedQty - line.expectedQty,
        createdAt: count.createdAt || '',
        postedAt: count.postedAt || ''
      }))
    );
  }, [counts, locations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    const allowedCounts = new Set(
      counts
        .filter(c => !locationId || c.locationId === locationId)
        .map(c => c.id)
    );

    return rows.filter(row =>
      allowedCounts.has(row.countId) &&
      (status === 'ALL' || row.status === status) &&
      (
        !q ||
        row.reference.toLowerCase().includes(q) ||
        row.variantId.toLowerCase().includes(q) ||
        row.countId.toLowerCase().includes(q)
      )
    );
  }, [rows, counts, locationId, status, search]);

  const summary = useMemo(() => ({
    counts: new Set(filtered.map(r => r.countId)).size,
    lines: filtered.length,
    shortages: filtered.reduce(
      (sum, r) => sum + Math.max(0, -r.variance), 0
    ),
    surpluses: filtered.reduce(
      (sum, r) => sum + Math.max(0, r.variance), 0
    ),
    net: filtered.reduce(
      (sum, r) => sum + r.variance, 0
    )
  }), [filtered]);

  function exportCSV() {
    const headers = [
      'Count ID', 'Reference', 'Location', 'Status',
      'Variant ID', 'Expected Quantity', 'Counted Quantity',
      'Variance', 'Created At', 'Posted At'
    ];

    const data = filtered.map(r => [
      r.countId, r.reference, r.location, r.status,
      r.variantId, r.expectedQty, r.countedQty,
      r.variance, r.createdAt, r.postedAt
    ]);

    const csv = [headers, ...data]
      .map(row => row.map(csvCell).join(','))
      .join('\r\n');

    const blob = new Blob(
      ['\uFEFF' + csv],
      { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'royal-step-stock-reconciliation.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card stack">
      <div className="row">
        <div>
          <h2>Stock reconciliation history</h2>
          <p className="muted">
            Physical stock count history across authorized locations.
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

      {error && <p className="error" role="alert">{error}</p>}

      <div className="grid">
        <label>
          Location
          <select
            value={locationId}
            onChange={e => setLocationId(e.target.value)}
          >
            <option value="">All locations</option>
            {locations.map(l => (
              <option key={l.id} value={l.id}>
                {l.name || l.code || l.id}
              </option>
            ))}
          </select>
        </label>

        <label>
          Status
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="ALL">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="POSTED">Posted</option>
          </select>
        </label>

        <label>
          Search
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Reference, count ID, variant ID"
          />
        </label>
      </div>

      <div className="grid">
        {[
          ['Counts', summary.counts],
          ['Count lines', summary.lines],
          ['Shortage units', summary.shortages],
          ['Surplus units', summary.surpluses],
          ['Net variance', summary.net]
        ].map(([label, value]) => (
          <div className="card" key={String(label)}>
            <span className="muted">{label}</span>
            <div className="metric">{value}</div>
          </div>
        ))}
      </div>

      <div className="row">
        <h3>Reconciliation records</h3>
        <button
          className="secondary right"
          disabled={!filtered.length}
          onClick={exportCSV}
        >
          Export CSV
        </button>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Location</th>
              <th>Status</th>
              <th>Variant ID</th>
              <th>Expected</th>
              <th>Counted</th>
              <th>Variance</th>
              <th>Created</th>
              <th>Posted</th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((row, index) => (
              <tr key={`${row.countId}-${row.variantId}-${index}`}>
                <td title={row.countId}>{row.reference}</td>
                <td>{row.location}</td>
                <td>{row.status}</td>
                <td>{row.variantId}</td>
                <td>{row.expectedQty}</td>
                <td>{row.countedQty}</td>
                <td>
                  {row.variance > 0 ? '+' : ''}
                  {row.variance}
                </td>
                <td>{dateText(row.createdAt)}</td>
                <td>{dateText(row.postedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length === 0 && (
        <p className="muted">No matching reconciliation records.</p>
      )}

      <p className="muted">
        History is based on saved stock-count snapshots.
        Open counts represent proposed adjustments; posted counts
        represent finalized adjustments. The API currently returns
        up to 100 recent counts.
      </p>
    </section>
  );
}