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
  version: number;
};

type BranchSummary = {
  locationId: string;
  name: string;
  code: string;
  type: string;
  skus: number;
  onHand: number;
  available: number;
  reserved: number;
  quarantined: number;
  safetyBuffer: number;
  lowAvailability: number;
};

const panel: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #dbe3ed',
  borderRadius: 12,
  padding: 18
};

const number = (value: number) =>
  value.toLocaleString('en-PK');

export default function BranchInventoryIntelligence() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [locationId, setLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
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

      setRows(result as StockRow[]);
      setUpdated(new Date().toLocaleString());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unable to load inventory'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const branches = useMemo(() => {
    const grouped = new Map<string, BranchSummary>();

    for (const row of rows) {
      const current = grouped.get(row.locationId) || {
        locationId: row.locationId,
        name: row.location,
        code: row.locationCode,
        type: row.locationType,
        skus: 0,
        onHand: 0,
        available: 0,
        reserved: 0,
        quarantined: 0,
        safetyBuffer: 0,
        lowAvailability: 0
      };

      current.skus += 1;
      current.onHand += row.onHand;
      current.available += row.available;
      current.reserved +=
        row.reservedOnline + row.reservedReplenish;
      current.quarantined += row.quarantined;
      current.safetyBuffer += row.safetyBuffer;

      if (row.available <= row.safetyBuffer) {
        current.lowAvailability += 1;
      }

      grouped.set(row.locationId, current);
    }

    return [...grouped.values()].sort(
      (a, b) => a.name.localeCompare(b.name)
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return rows.filter(row => {
      if (locationId && row.locationId !== locationId) {
        return false;
      }

      if (onlyLow && row.available > row.safetyBuffer) {
        return false;
      }

      if (term && ![
        row.sku,
        row.location,
        row.locationCode
      ].some(value => String(value || '').toLowerCase().includes(term))) {
        return false;
      }

      return true;
    });
  }, [rows, locationId, search, onlyLow]);

  const summary = useMemo(() => {
    return filtered.reduce(
      (total, row) => {
        total.onHand += row.onHand;
        total.available += row.available;
        total.reserved +=
          row.reservedOnline + row.reservedReplenish;
        total.quarantined += row.quarantined;
        total.safetyBuffer += row.safetyBuffer;

        if (row.available <= row.safetyBuffer) {
          total.low += 1;
        }

        return total;
      },
      {
        onHand: 0,
        available: 0,
        reserved: 0,
        quarantined: 0,
        safetyBuffer: 0,
        low: 0
      }
    );
  }, [filtered]);

  function exportCSV() {
    const headers = [
      'Location',
      'Location Code',
      'Location Type',
      'SKU',
      'On Hand',
      'Available',
      'Reserved Online',
      'Reserved Replenishment',
      'Quarantined',
      'Safety Buffer',
      'Low Availability'
    ];

    const values = filtered.map(row => [
      row.location,
      row.locationCode,
      row.locationType,
      row.sku,
      row.onHand,
      row.available,
      row.reservedOnline,
      row.reservedReplenish,
      row.quarantined,
      row.safetyBuffer,
      row.available <= row.safetyBuffer ? 'YES' : 'NO'
    ]);

    const escapeCSV = (value: unknown) => {
      const text = String(value ?? '');
      const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
      return '"' + safe.replace(/"/g, '""') + '"';
    };

    const csv = [headers, ...values]
      .map(row => row.map(escapeCSV).join(','))
      .join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'royal-step-inventory-' +
      new Date().toISOString().slice(0, 10) + '.csv';

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  const tableHead: React.CSSProperties = {
    padding: '10px 12px',
    textAlign: 'left',
    background: '#eaf4fb',
    color: '#104c72',
    whiteSpace: 'nowrap'
  };

  const cell: React.CSSProperties = {
    padding: '10px 12px',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap'
  };

  return (
    <section style={{ margin: '26px 0' }}>
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
            Branch & Warehouse Inventory Intelligence
          </h2>

          <p style={{
            color: '#64748b',
            margin: '6px 0'
          }}>
            Current stock availability across all locations
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? 'Loading...' : 'Refresh inventory'}
          </button>

          <button
            type="button"
            disabled={loading || !!error || !rows.length}
            onClick={exportCSV}
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{
          ...panel,
          borderColor: '#ef3321',
          marginBottom: 16
        }}>
          <strong>Inventory data unavailable</strong>
          <p>{error}</p>
        </div>
      )}

      {loading && !rows.length && (
        <p>Loading branch inventory...</p>
      )}

      <div style={{
        ...panel,
        marginBottom: 18
      }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          alignItems: 'end'
        }}>
          <label>
            Location
            <select
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
            >
              <option value="">All locations</option>

              {branches.map(branch => (
                <option
                  key={branch.locationId}
                  value={branch.locationId}
                >
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </label>

          <label>
            Search SKU or location
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search inventory"
            />
          </label>

          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <input
              type="checkbox"
              checked={onlyLow}
              onChange={e => setOnlyLow(e.target.checked)}
            />
            Low availability only
          </label>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns:
          'repeat(auto-fit,minmax(170px,1fr))',
        gap: 12,
        marginBottom: 20
      }}>
        {[
          ['On-hand units', summary.onHand],
          ['Available units', summary.available],
          ['Reserved units', summary.reserved],
          ['Quarantined units', summary.quarantined],
          ['Safety buffer units', summary.safetyBuffer],
          ['Low-availability SKUs', summary.low]
        ].map(([label, value]) => (
          <div key={String(label)} style={panel}>
            <div style={{
              color: '#64748b',
              fontSize: 12
            }}>
              {label}
            </div>

            <div style={{
              fontSize: 23,
              fontWeight: 700,
              color: '#104c72',
              marginTop: 8
            }}>
              {number(Number(value))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...panel, marginBottom: 20 }}>
        <h3 style={{ color: '#104c72', marginTop: 0 }}>
          Location Comparison
        </h3>

        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse'
          }}>
            <thead>
              <tr>
                {[
                  'Location',
                  'Type',
                  'SKUs',
                  'On Hand',
                  'Available',
                  'Reserved',
                  'Low Availability'
                ].map(label => (
                  <th key={label} style={tableHead}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {branches
                .filter(branch =>
                  !locationId ||
                  branch.locationId === locationId
                )
                .map(branch => (
                  <tr key={branch.locationId}>
                    {[
                      branch.name,
                      branch.type,
                      branch.skus,
                      branch.onHand,
                      branch.available,
                      branch.reserved,
                      branch.lowAvailability
                    ].map((value, index) => (
                      <td key={index} style={cell}>
                        {typeof value === 'number'
                          ? number(value)
                          : value}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={panel}>
        <h3 style={{ color: '#104c72', marginTop: 0 }}>
          SKU Inventory Details
        </h3>

        <p style={{ fontSize: 12, color: '#64748b' }}>
          Showing {number(filtered.length)} stock records.
        </p>

        <div style={{
          overflowX: 'auto',
          maxHeight: 520
        }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse'
          }}>
            <thead>
              <tr>
                {[
                  'Location',
                  'SKU',
                  'On Hand',
                  'Available',
                  'Reserved',
                  'Quarantined',
                  'Safety Buffer',
                  'Status'
                ].map(label => (
                  <th key={label} style={tableHead}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filtered.map(row => {
                const low =
                  row.available <= row.safetyBuffer;

                return (
                  <tr key={row.locationId + ':' + row.variantId}>
                    <td style={cell}>{row.location}</td>
                    <td style={cell}>{row.sku}</td>
                    <td style={cell}>{number(row.onHand)}</td>
                    <td style={cell}>{number(row.available)}</td>
                    <td style={cell}>
                      {number(
                        row.reservedOnline +
                        row.reservedReplenish
                      )}
                    </td>
                    <td style={cell}>
                      {number(row.quarantined)}
                    </td>
                    <td style={cell}>
                      {number(row.safetyBuffer)}
                    </td>
                    <td style={{
                      ...cell,
                      color: low ? '#ef3321' : '#104c72',
                      fontWeight: 700
                    }}>
                      {low ? 'LOW' : 'NORMAL'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{
        color: '#64748b',
        fontSize: 12,
        marginTop: 14
      }}>
        Inventory is a current snapshot. Available units are
        calculated after reservations, quarantine, and safety
        buffers. Low availability is an operational indicator,
        not an automatic replenishment instruction.
        Last refreshed: {updated || 'Not yet loaded'}.
      </p>
    </section>
  );
}