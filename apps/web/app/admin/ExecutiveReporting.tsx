'use client';

import { useEffect, useState } from 'react';

type Any = Record<string, any>;

type Report = {
  overview: Any;
  sales: Any;
  attention: Any;
};

const panel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #dbe3ed',
  borderRadius: 12,
  padding: 18
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: 12,
  background: '#eaf4fb',
  color: '#104c72',
  whiteSpace: 'nowrap'
};

const td: React.CSSProperties = {
  padding: 12,
  borderBottom: '1px solid #e2e8f0'
};

const money = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n)
    ? 'PKR ' + n.toLocaleString('en-PK', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    : 'Unavailable';
};

const count = (value: unknown) =>
  Number(value ?? 0).toLocaleString('en-PK');

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function downloadCSV(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], {
    type: 'text/csv;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExecutiveReporting() {
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return dateInput(d);
  });

  const [to, setTo] = useState(() => dateInput(new Date()));
  const [locationId, setLocationId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState('');
  const [applied, setApplied] = useState({
    from: '',
    to: '',
    locationId: ''
  });

  const locations: Any[] = Array.isArray(report?.overview?.locations)
    ? report!.overview.locations
    : [];

  const locationNames = new Map(
    locations.map(l => [l.id, l.name || l.code || l.id])
  );

  const salesRows: Any[] = Array.isArray(report?.sales?.byLocation)
    ? report!.sales.byLocation
    : [];

  const rows = salesRows
    .map(row => ({
      locationId: String(row.locationId ?? ''),
      name: locationNames.get(row.locationId) || String(row.locationId ?? ''),
      gross: Number(row.gross ?? 0),
      acceptedSales: Number(row.acceptedSales ?? 0),
      cash: Number(row.cash ?? 0),
      card: Number(row.card ?? 0),
      stockConflicts: Number(row.stockConflicts ?? 0)
    }))
    .sort((a, b) => b.gross - a.gross);

  async function generate(
    start = from,
    end = to,
    selectedLocation = locationId
  ) {
    setError('');

    if (!start || !end || start > end) {
      setError('Select a valid reporting date range.');
      return;
    }

    const fromDate = new Date(start + 'T00:00:00.000Z');
    const toDate = new Date(end + 'T00:00:00.000Z');

    // Backend uses an exclusive end timestamp.
    toDate.setUTCDate(toDate.getUTCDate() + 1);

    if (
      !Number.isFinite(fromDate.getTime()) ||
      !Number.isFinite(toDate.getTime()) ||
      toDate.getTime() - fromDate.getTime() > 366 * 86400000
    ) {
      setError('Reporting period must be 366 days or less.');
      return;
    }

    setLoading(true);

    try {
      const params = new URLSearchParams({
        from: fromDate.toISOString(),
        to: toDate.toISOString()
      });

      if (selectedLocation) {
        params.set('locationId', selectedLocation);
      }

      const paths = [
        '/api/v1/hq/overview?' + params,
        '/api/v1/hq/sales-analytics?' + params,
        '/api/v1/hq/attention'
      ];

      const responses = await Promise.all(
        paths.map(path => fetch(path, {
          credentials: 'same-origin',
          cache: 'no-store'
        }))
      );

      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].ok) {
          throw new Error(
            paths[i].split('?')[0] +
            ' returned HTTP ' + responses[i].status
          );
        }
      }

      const results = await Promise.all(
        responses.map(response => response.json())
      );

      setReport({
        overview: results[0],
        sales: results[1],
        attention: results[2]
      });

      setApplied({
        from: start,
        to: end,
        locationId: selectedLocation
      });

      setGenerated(new Date().toLocaleString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void generate(from, to, '');
    // Initial report only; later reports are user initiated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportReport() {
    if (!report || loading || error) return;

    const selectedName = applied.locationId
      ? locationNames.get(applied.locationId) || applied.locationId
      : 'All locations';

    const csv: unknown[][] = [
      ['ROYAL STEP - EXECUTIVE MANAGEMENT REPORT'],
      ['From (UTC)', applied.from],
      ['To (UTC, inclusive date)', applied.to],
      ['Location', selectedName],
      ['Generated', generated],
      [],
      ['EXECUTIVE KPIS'],
      ['Accepted POS sales', report.overview.pos?.acceptedSales],
      ['Gross accepted POS sales (PKR)',
        report.overview.pos?.grossAcceptedSales],
      ['Available stock units (current snapshot)',
        report.overview.stock?.available],
      ['Open POS shifts (current snapshot)',
        report.overview.pos?.openShifts],
      ['POS stock conflicts (period)',
        report.overview.pos?.stockConflicts],
      ['In-transit transfers (current snapshot)',
        report.overview.transfers?.inTransit],
      [],
      ['BRANCH SALES'],
      ['Branch', 'Accepted Sales', 'Gross PKR',
        'Cash PKR', 'Card PKR', 'Stock Conflicts']
    ];

    for (const row of rows) {
      csv.push([
        row.name,
        row.acceptedSales,
        row.gross,
        row.cash,
        row.card,
        row.stockConflicts
      ]);
    }

    csv.push(
      [],
      ['DATA QUALITY'],
      ['Sales analytics truncated',
        report.sales.truncated ? 'YES' : 'NO'],
      ['Gross sales are not net revenue or profit'],
      ['Offline sales not yet synchronized are excluded'],
      ['Cash/card tender figures are not settlement totals'],
      ['Stock and operational status are current snapshots'],
      ['Attention endpoint is global and not date-filtered']
    );

    downloadCSV(
      'royal-step-executive-' +
      applied.from + '-to-' + applied.to + '.csv',
      csv
    );
  }

  const kpis = report ? [
    ['Accepted POS sales',
      count(report.overview.pos?.acceptedSales)],
    ['Gross accepted POS sales',
      money(report.overview.pos?.grossAcceptedSales)],
    ['Available stock units',
      count(report.overview.stock?.available)],
    ['Open POS shifts',
      count(report.overview.pos?.openShifts)],
    ['POS stock conflicts',
      count(report.overview.pos?.stockConflicts)],
    ['In-transit transfers',
      count(report.overview.transfers?.inTransit)]
  ] : [];

  return (
    <section style={{ margin: '30px 0' }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ color: '#104c72', margin: 0 }}>
          Executive Reporting & Management Summaries
        </h2>
        <p style={{ color: '#64748b' }}>
          Historical POS performance and current operational visibility
        </p>
      </div>

      <div style={{ ...panel, marginBottom: 18 }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'end',
          gap: 14
        }}>
          <label>
            From (UTC)
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
            />
          </label>

          <label>
            To (UTC)
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
            />
          </label>

          <label>
            Location
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
            >
              <option value="">All locations</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name || l.code}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={loading}
            onClick={() => void generate()}
          >
            {loading ? 'Generating...' : 'Generate report'}
          </button>

          <button
            type="button"
            className="secondary"
            disabled={!report || loading || !!error ||
              report.sales.truncated}
            onClick={exportReport}
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{
          ...panel,
          borderColor: '#ef3321',
          marginBottom: 18
        }}>
          <strong>Report unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      {report && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit,minmax(190px,1fr))',
            gap: 12,
            marginBottom: 20
          }}>
            {kpis.map(([label, value]) => (
              <div key={label} style={panel}>
                <div style={{
                  color: '#64748b',
                  fontSize: 12
                }}>
                  {label}
                </div>
                <div style={{
                  color: '#104c72',
                  fontSize: 22,
                  fontWeight: 700,
                  marginTop: 8,
                  overflowWrap: 'anywhere'
                }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...panel, marginBottom: 20 }}>
            <h3 style={{ color: '#104c72', marginTop: 0 }}>
              Branch Sales Comparison
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
                      'Accepted Sales',
                      'Gross Sales',
                      'Cash Tenders',
                      'Card Tenders',
                      'Stock Conflicts'
                    ].map(label => (
                      <th key={label} style={th}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.locationId}>
                      <td style={td}>{row.name}</td>
                      <td style={td}>{count(row.acceptedSales)}</td>
                      <td style={td}>{money(row.gross)}</td>
                      <td style={td}>{money(row.cash)}</td>
                      <td style={td}>{money(row.card)}</td>
                      <td style={td}>{count(row.stockConflicts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length === 0 && (
              <p>No POS sales found in this reporting period.</p>
            )}

            {report.sales.truncated && (
              <p role="alert" style={{ color: '#b45309' }}>
                The sales endpoint reached its 5,000-sale limit.
                Branch comparisons may be incomplete.
                Narrow the reporting period before exporting.
              </p>
            )}
          </div>

          <div style={panel}>
            <h3 style={{ color: '#104c72', marginTop: 0 }}>
              Management Summary
            </h3>

            <p>
              <strong>Reporting period:</strong>{' '}
              {applied.from} through {applied.to} (UTC dates)
            </p>

            <p>
              <strong>Selected location:</strong>{' '}
              {applied.locationId
                ? locationNames.get(applied.locationId) ||
                  applied.locationId
                : 'All locations'}
            </p>

            <p>
              <strong>Gross accepted POS sales:</strong>{' '}
              {money(report.overview.pos?.grossAcceptedSales)}
            </p>

            <p>
              <strong>Current available inventory:</strong>{' '}
              {count(report.overview.stock?.available)} units
            </p>

            <p>
              <strong>Generated:</strong> {generated}
            </p>

            <p style={{
              color: '#64748b',
              fontSize: 12
            }}>
              Sales use the selected historical period. Inventory,
              open shifts and in-transit transfers are current
              snapshots. Gross accepted sales are not net revenue,
              profit or settled payments. Unsynchronized offline
              sales are excluded. The global attention endpoint
              is not used for historical or branch-specific totals.
            </p>
          </div>
        </>
      )}
    </section>
  );
}



