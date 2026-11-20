'use client';

import { useEffect, useMemo, useState } from 'react';

type StockRow = {
  locationId: string;
  location: string;
  locationCode: string;
  locationType: string;
  variantId: string;
  sku: string;
  onHand: number;
  reservedOnline: number;
  reservedReplenish: number;
  quarantined: number;
  safetyBuffer: number;
  available: number;
};

type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL';

type Insight = StockRow & {
  priority: Priority;
  suggestedUnits: number;
  warehouseAvailable: number;
  warehouseCount: number;
};

const panel: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #dbe3ed',
  borderRadius: 12,
  padding: 18
};

const th: React.CSSProperties = {
  padding: '11px 12px',
  textAlign: 'left',
  background: '#eaf4fb',
  color: '#104c72',
  whiteSpace: 'nowrap'
};

const td: React.CSSProperties = {
  padding: '11px 12px',
  borderBottom: '1px solid #e2e8f0',
  whiteSpace: 'nowrap'
};

const fmt = (value: number) =>
  value.toLocaleString('en-PK');

const numeric = (value: unknown) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

export default function ReplenishmentIntelligence() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [priority, setPriority] = useState('ALL');
  const [search, setSearch] = useState('');
  const [updated, setUpdated] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        '/api/v1/hq/stock-by-location',
        {
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        throw new Error(
          'Inventory API returned HTTP ' + response.status
        );
      }

      const result: unknown = await response.json();

      if (!Array.isArray(result)) {
        throw new Error('Unexpected inventory response format');
      }

      const parsed: StockRow[] = result.map((row: any) => ({
        locationId: String(row.locationId || ''),
        location: String(row.location || ''),
        locationCode: String(row.locationCode || ''),
        locationType: String(row.locationType || ''),
        variantId: String(row.variantId || ''),
        sku: String(row.sku || ''),
        onHand: numeric(row.onHand),
        reservedOnline: numeric(row.reservedOnline),
        reservedReplenish: numeric(row.reservedReplenish),
        quarantined: numeric(row.quarantined),
        safetyBuffer: numeric(row.safetyBuffer),
        available: numeric(row.available)
      }));

      setRows(parsed);
      setLoaded(true);
      setUpdated(new Date().toLocaleString());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unable to load stock data'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const locations = useMemo(() => {
    const map = new Map<string, string>();

    for (const row of rows) {
      if (row.locationType === 'BRANCH') {
        map.set(
          row.locationId,
          row.location || row.locationCode
        );
      }
    }

    return [...map.entries()].sort(
      (a, b) => a[1].localeCompare(b[1])
    );
  }, [rows]);

  const insights = useMemo(() => {
    const warehouse = new Map<string, {
      available: number;
      locations: Set<string>;
    }>();

    for (const row of rows) {
      if (row.locationType !== 'WAREHOUSE') continue;

      const current = warehouse.get(row.variantId) || {
        available: 0,
        locations: new Set<string>()
      };

      current.available += Math.max(0, row.available);
      current.locations.add(row.locationId);
      warehouse.set(row.variantId, current);
    }

    const result: Insight[] = [];

    for (const row of rows) {
      if (row.locationType !== 'BRANCH') continue;

      const available = row.available;
      const buffer = Math.max(0, row.safetyBuffer);

      const level: Priority =
        available <= 0
          ? 'CRITICAL'
          : available < buffer
            ? 'HIGH'
            : 'NORMAL';

      const source = warehouse.get(row.variantId);

      result.push({
        ...row,
        priority: level,
        suggestedUnits: Math.max(
          0,
          Math.ceil(buffer - Math.max(0, available))
        ),
        warehouseAvailable: source?.available || 0,
        warehouseCount: source?.locations.size || 0
      });
    }

    const order: Record<Priority, number> = {
      CRITICAL: 0,
      HIGH: 1,
      NORMAL: 2
    };

    return result.sort((a, b) =>
      order[a.priority] - order[b.priority] ||
      b.suggestedUnits - a.suggestedUnits ||
      a.sku.localeCompare(b.sku)
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return insights.filter(row => {
      if (locationId && row.locationId !== locationId) {
        return false;
      }

      if (priority !== 'ALL' && row.priority !== priority) {
        return false;
      }

      if (
        term &&
        ![
          row.sku,
          row.location,
          row.locationCode
        ].some(value => value.toLowerCase().includes(term))
      ) {
        return false;
      }

      return true;
    });
  }, [insights, locationId, priority, search]);

  const stats = useMemo(() => ({
    critical: filtered.filter(
      row => row.priority === 'CRITICAL'
    ).length,
    high: filtered.filter(
      row => row.priority === 'HIGH'
    ).length,
    normal: filtered.filter(
      row => row.priority === 'NORMAL'
    ).length,
    suggested: filtered.reduce(
      (sum, row) => sum + row.suggestedUnits, 0
    ),
    warehouseCandidates: filtered.filter(
      row =>
        row.suggestedUnits > 0 &&
        row.warehouseAvailable > 0
    ).length
  }), [filtered]);

  const branchSummary = useMemo(() => {
    const map = new Map<string, {
      id: string;
      name: string;
      critical: number;
      high: number;
      suggested: number;
    }>();

    for (const row of insights) {
      const current = map.get(row.locationId) || {
        id: row.locationId,
        name: row.location,
        critical: 0,
        high: 0,
        suggested: 0
      };

      if (row.priority === 'CRITICAL') current.critical++;
      if (row.priority === 'HIGH') current.high++;

      current.suggested += row.suggestedUnits;
      map.set(row.locationId, current);
    }

    return [...map.values()]
      .filter(row => !locationId || row.id === locationId)
      .sort((a, b) =>
        b.critical - a.critical ||
        b.high - a.high ||
        b.suggested - a.suggested
      );
  }, [insights, locationId]);

  function exportCSV() {
    const headers = [
      'Branch',
      'SKU',
      'Priority',
      'Available',
      'Safety Buffer',
      'Suggested Units',
      'Warehouse Available',
      'Warehouse Locations'
    ];

    const values = filtered.map(row => [
      row.location,
      row.sku,
      row.priority,
      row.available,
      row.safetyBuffer,
      row.suggestedUnits,
      row.warehouseAvailable,
      row.warehouseCount
    ]);

    const escapeCSV = (value: unknown) => {
      const text = String(value ?? '');
      const safe = /^[=+\-@\t\r]/.test(text)
        ? "'" + text
        : text;

      return '"' + safe.replace(/"/g, '""') + '"';
    };

    const csv = [headers, ...values]
      .map(row => row.map(escapeCSV).join(','))
      .join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      'royal-step-replenishment-' +
      new Date().toISOString().slice(0, 10) +
      '.csv';

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  return (
    <section style={{ margin: '28px 0' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 18
      }}>
        <div>
          <h2 style={{ color: '#104c72', margin: 0 }}>
            Intelligent Replenishment Priorities
          </h2>

          <p style={{
            color: '#64748b',
            margin: '6px 0'
          }}>
            Branch shortages and potential warehouse supply
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? 'Loading...' : 'Refresh priorities'}
          </button>

          <button
            type="button"
            disabled={loading || !!error || !loaded}
            onClick={exportCSV}
          >
            Export priorities
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{
          ...panel,
          borderColor: '#ef3321',
          marginBottom: 18
        }}>
          <strong>Replenishment data unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      {loading && !loaded && (
        <p>Loading replenishment intelligence...</p>
      )}

      {loaded && (
        <>
          <div style={{
            ...panel,
            marginBottom: 18,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14
          }}>
            <label>
              Branch
              <select
                value={locationId}
                onChange={e => setLocationId(e.target.value)}
              >
                <option value="">All branches</option>

                {locations.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Priority
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
              >
                <option value="ALL">All priorities</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="NORMAL">Normal</option>
              </select>
            </label>

            <label>
              Search SKU
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="SKU or branch"
              />
            </label>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit,minmax(170px,1fr))',
            gap: 12,
            marginBottom: 20
          }}>
            {[
              ['Critical SKUs', stats.critical],
              ['High-priority SKUs', stats.high],
              ['Normal SKUs', stats.normal],
              ['Suggested units', stats.suggested],
              ['Warehouse candidates', stats.warehouseCandidates]
            ].map(([label, value]) => (
              <div key={String(label)} style={panel}>
                <div style={{
                  color: '#64748b',
                  fontSize: 12
                }}>
                  {label}
                </div>

                <div style={{
                  fontSize: 25,
                  fontWeight: 700,
                  marginTop: 8,
                  color: label === 'Critical SKUs'
                    ? '#ef3321'
                    : '#104c72'
                }}>
                  {fmt(Number(value))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...panel, marginBottom: 20 }}>
            <h3 style={{ color: '#104c72', marginTop: 0 }}>
              Branch Priority Ranking
            </h3>

            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse'
              }}>
                <thead>
                  <tr>
                    {[
                      'Branch',
                      'Critical SKUs',
                      'High SKUs',
                      'Suggested Units'
                    ].map(label => (
                      <th key={label} style={th}>{label}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {branchSummary.map(branch => (
                    <tr key={branch.id}>
                      <td style={td}>{branch.name}</td>
                      <td style={td}>{fmt(branch.critical)}</td>
                      <td style={td}>{fmt(branch.high)}</td>
                      <td style={td}>{fmt(branch.suggested)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={panel}>
            <h3 style={{ color: '#104c72', marginTop: 0 }}>
              SKU Replenishment Queue
            </h3>

            <p style={{ color: '#64748b', fontSize: 12 }}>
              {fmt(filtered.length)} SKU/location records.
              Recommendations are informational only.
            </p>

            <div style={{
              overflowX: 'auto',
              maxHeight: 550
            }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse'
              }}>
                <thead>
                  <tr>
                    {[
                      'Priority',
                      'Branch',
                      'SKU',
                      'Available',
                      'Safety Buffer',
                      'Suggested Units',
                      'Warehouse Available'
                    ].map(label => (
                      <th key={label} style={th}>{label}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {filtered.map(row => (
                    <tr key={
                      row.locationId + ':' + row.variantId
                    }>
                      <td style={{
                        ...td,
                        fontWeight: 700,
                        color: row.priority === 'CRITICAL'
                          ? '#ef3321'
                          : row.priority === 'HIGH'
                            ? '#b45309'
                            : '#104c72'
                      }}>
                        {row.priority}
                      </td>

                      <td style={td}>{row.location}</td>
                      <td style={td}>{row.sku}</td>
                      <td style={td}>{fmt(row.available)}</td>
                      <td style={td}>{fmt(row.safetyBuffer)}</td>
                      <td style={td}>{fmt(row.suggestedUnits)}</td>
                      <td style={td}>
                        {fmt(row.warehouseAvailable)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{
            color: '#64748b',
            fontSize: 12,
            marginTop: 14
          }}>
            Warehouse availability is shared across branches.
            It is not allocated or reserved by this dashboard.
            Suggested units represent minimum safety-buffer
            restoration, not demand-based purchasing requirements.
            Zero-buffer SKUs may be classified as critical
            without generating a positive suggested quantity.
            Current inventory only; no automatic transfers.
            Last refreshed: {updated}.
          </p>
        </>
      )}
    </section>
  );
}