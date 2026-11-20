'use client';

import { useEffect, useState } from 'react';

type Row = {
  locationId: string;
  location: string;
  sku: string;
  product: string;
  size: string;
  color: string;
  onHand: number;
  oldestRecordedAgeDays: number | null;
  daysSinceLastSale: number | null;
  estimatedCostValue: string | null;
  candidate: boolean;
  reason: string;
};

type Result = {
  generatedAt: string;
  thresholdDays: number;
  summary: {
    candidates: number;
    units: number;
    estimatedCostValue: string;
    unknownCostCandidates: number;
  };
  rows: Row[];
  notes: string[];
};

export default function AgingInventory() {
  const [days, setDays] = useState(90);
  const [location, setLocation] = useState('');
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyCandidates, setOnlyCandidates] = useState(true);

  useEffect(() => {
    try {
      const saved = Number(
        localStorage.getItem('royal-step-aging-days')
      );
      if (Number.isInteger(saved) && saved >= 1 &&
          saved <= 3650) {
        setDays(saved);
      }
    } catch {
      // Browser storage is optional.
    }
  }, []);

  async function load() {
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setError('Threshold must be between 1 and 3650 days.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        thresholdDays: String(days)
      });

      const response = await fetch(
        '/api/v1/hq/aging-inventory?' + params,
        {
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      const result = await response.json() as Result;
      setData(result);

      try {
        localStorage.setItem(
          'royal-step-aging-days',
          String(days)
        );
      } catch {
        // Preference remains usable for this session.
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Request failed'
      );
    } finally {
      setLoading(false);
    }
  }

  const locations = Array.from(
    new Map(
      (data?.rows ?? []).map(r => [
        r.locationId,
        r.location
      ])
    )
  );

  const filtered = (data?.rows ?? [])
    .filter(r => !location || r.locationId === location)
    .filter(r => !onlyCandidates || r.candidate)
    .sort((a, b) =>
      (b.oldestRecordedAgeDays ?? -1) -
      (a.oldestRecordedAgeDays ?? -1)
    );

  const candidates = filtered.filter(r => r.candidate);

  const money = (value: string | number) =>
    'PKR ' + Number(value).toLocaleString('en-PK', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  function exportCSV() {
    const rows = [
      [
        'Location', 'SKU', 'Product', 'Size', 'Color',
        'On Hand', 'Oldest Receipt Age (Days)',
        'Days Since Last Sale', 'Estimated Cost Value',
        'Aging Candidate', 'Reason'
      ],
      ...filtered.map(r => [
        r.location,
        r.sku,
        r.product,
        r.size,
        r.color,
        r.onHand,
        r.oldestRecordedAgeDays ?? '',
        r.daysSinceLastSale ?? 'No recorded sale',
        r.estimatedCostValue ?? 'Unknown',
        r.candidate ? 'YES' : 'NO',
        r.reason
      ])
    ];

    const csv = rows.map(row =>
      row.map(v => {
        const raw = String(v ?? '');
        const safe = /^[=+\-@\t\r]/.test(raw)
          ? "'" + raw
          : raw;
        return '"' + safe.replace(/"/g, '""') + '"';
      }).join(',')
    ).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'royal-step-aging-inventory.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const card: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #dbe3ed',
    borderRadius: 12,
    padding: 18
  };

  return (
    <section style={{ margin: '30px 0' }}>
      <h2 style={{ color: '#104c72' }}>
        Aging Inventory & Dead Stock Intelligence
      </h2>

      <p style={{ color: '#64748b' }}>
        Identify older inventory and clearance candidates
        across Royal Step branches and warehouse.
      </p>

      <div style={{
        ...card,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'end',
        gap: 12,
        marginBottom: 18
      }}>
        <label>
          Aging threshold (days)
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            style={{ display: 'block', padding: 9 }}
          />
        </label>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Analyze inventory'}
        </button>

        <label>
          Location
          <select
            value={location}
            onChange={e => setLocation(e.target.value)}
            style={{ display: 'block', padding: 9 }}
          >
            <option value="">All locations</option>
            {locations.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>

        <label>
          <input
            type="checkbox"
            checked={onlyCandidates}
            onChange={e =>
              setOnlyCandidates(e.target.checked)
            }
          />
          {' '}Clearance candidates only
        </label>

        <button
          type="button"
          disabled={!data || !!error}
          onClick={exportCSV}
        >
          Export CSV
        </button>
      </div>

      <p style={{ fontSize: 12, color: '#64748b' }}>
        Threshold preference is saved in this browser.
        Company-wide persistent settings will be added
        separately.
      </p>

      {error && (
        <p role="alert" style={{ color: '#ef3321' }}>
          Aging analysis unavailable: {error}
        </p>
      )}

      {data && !error && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit,minmax(180px,1fr))',
            gap: 12,
            marginBottom: 18
          }}>
            {[
              ['Clearance candidates', candidates.length],
              ['Candidate units', candidates.reduce(
                (sum, r) => sum + r.onHand, 0
              )],
              ['Known cost value', money(
                candidates.reduce(
                  (sum, r) =>
                    sum + Number(r.estimatedCostValue ?? 0),
                  0
                )
              )],
              ['Missing cost', candidates.filter(
                r => r.estimatedCostValue === null
              ).length]
            ].map(([label, value]) => (
              <div key={String(label)} style={card}>
                <div style={{
                  fontSize: 12,
                  color: '#64748b'
                }}>
                  {label}
                </div>
                <div style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: '#104c72',
                  marginTop: 8
                }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...card, overflowX: 'auto' }}>
            <h3 style={{ color: '#104c72' }}>
              Inventory Aging Analysis
            </h3>

            <table style={{
              width: '100%',
              borderCollapse: 'collapse'
            }}>
              <thead>
                <tr>
                  {[
                    'Location', 'SKU', 'Product',
                    'Size / Color', 'Units',
                    'Oldest Receipt', 'Last Sale',
                    'Cost Value', 'Status'
                  ].map(h => (
                    <th key={h} style={{
                      textAlign: 'left',
                      padding: 10,
                      background: '#eaf4fb',
                      whiteSpace: 'nowrap'
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filtered.map(r => (
                  <tr key={r.locationId + ':' + r.sku}>
                    {[
                      r.location,
                      r.sku,
                      r.product,
                      r.size + ' / ' + r.color,
                      String(r.onHand),
                      r.oldestRecordedAgeDays === null
                        ? 'Unknown'
                        : r.oldestRecordedAgeDays + ' days',
                      r.daysSinceLastSale === null
                        ? 'No recorded sale'
                        : r.daysSinceLastSale + ' days',
                      r.estimatedCostValue === null
                        ? 'Unknown'
                        : money(r.estimatedCostValue),
                      r.candidate
                        ? 'CLEARANCE CANDIDATE'
                        : 'Not flagged'
                    ].map((value, index) => (
                      <td key={index} style={{
                        padding: 10,
                        borderBottom: '1px solid #e2e8f0'
                      }}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <p>No matching inventory records.</p>
            )}
          </div>

          <div style={{
            ...card,
            marginTop: 16,
            fontSize: 12,
            color: '#64748b'
          }}>
            <strong>Interpretation:</strong>
            <ul>
              {data.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
            Clearance candidates are recommendations only.
            No prices or inventory balances are changed.
          </div>
        </>
      )}
    </section>
  );
}