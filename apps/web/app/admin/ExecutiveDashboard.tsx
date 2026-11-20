'use client';

import { useEffect, useState } from 'react';

type Any = Record<string, any>;

type DashboardData = {
  overview: Any;
  sales: Any;
  attention: Any;
};

const money = (value: unknown) => {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) return 'Unavailable';

  return 'PKR ' + amount.toLocaleString('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const number = (value: unknown) =>
  Number(value ?? 0).toLocaleString('en-PK');

const card: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #dbe3ed',
  borderRadius: 12,
  padding: 18
};

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
  gap: 14,
  marginBottom: 20
};

export default function ExecutiveDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');

  async function load() {
    setLoading(true);
    setError('');

    try {
      const paths = [
        '/api/v1/hq/overview',
        '/api/v1/hq/sales-analytics',
        '/api/v1/hq/attention'
      ];

      const responses = await Promise.all(
        paths.map(path =>
          fetch(path, {
            credentials: 'same-origin',
            cache: 'no-store'
          })
        )
      );

      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].ok) {
          throw new Error(
            paths[i] + ' returned HTTP ' + responses[i].status
          );
        }
      }

      const results = await Promise.all(
        responses.map(response => response.json())
      );

      setData({
        overview: results[0],
        sales: results[1],
        attention: results[2]
      });

      setUpdated(new Date().toLocaleString());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unable to load dashboard'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const locations: Any[] = Array.isArray(data?.overview?.locations)
    ? data!.overview.locations
    : [];

  const branchNames = new Map(
    locations.map(location => [
      location.id,
      location.name || location.code || location.id
    ])
  );

  const rows: Any[] = Array.isArray(data?.sales?.byLocation)
    ? data!.sales.byLocation
    : [];

  const branches = rows
    .map(row => ({
      ...row,
      name: branchNames.get(row.locationId) || row.locationId,
      grossNumber: Number(row.gross || 0)
    }))
    .sort((a, b) => b.grossNumber - a.grossNumber);

  const maxSales = Math.max(
    1,
    ...branches.map(branch => branch.grossNumber)
  );

  const alerts = [
    {
      label: 'Low availability',
      count: data?.attention?.lowAvailability?.length ?? 0,
      href: '/admin'
    },
    {
      label: 'Open POS shifts',
      count: data?.attention?.openShifts?.length ?? 0,
      href: '/admin'
    },
    {
      label: 'POS stock conflicts',
      count: data?.attention?.stockConflicts?.length ?? 0,
      href: '/admin'
    },
    {
      label: 'In-transit transfers',
      count: data?.attention?.inTransitTransfers?.length ?? 0,
      href: '/admin'
    }
  ];

  return (
    <section style={{ margin: '24px 0' }}>
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
            Executive Operations Dashboard
          </h2>
          <p style={{ color: '#64748b', margin: '6px 0' }}>
            Consolidated retail performance and operational visibility
          </p>
        </div>

        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? 'Loading...' : 'Refresh executive data'}
        </button>
      </div>

      {error && (
        <div role="alert" style={{
          ...card,
          borderColor: '#ef3321',
          marginBottom: 16
        }}>
          <strong>Dashboard data unavailable</strong>
          <p>{error}</p>
          <p style={{ fontSize: 12, color: '#64748b' }}>
            Existing HQ functions remain available.
          </p>
        </div>
      )}

      {!data && loading && <p>Loading executive dashboard...</p>}

      {data && (
        <>
          <div style={grid}>
            {[
              {
                label: 'Accepted POS sales',
                value: number(data.overview.pos?.acceptedSales)
              },
              {
                label: 'Gross accepted sales',
                value: money(data.overview.pos?.grossAcceptedSales)
              },
              {
                label: 'Available stock units',
                value: number(data.overview.stock?.available)
              },
              {
                label: 'Active locations',
                value: number(
                  locations.filter(location => location.active).length
                )
              }
            ].map(item => (
              <div key={item.label} style={card}>
                <div style={{ color: '#64748b', fontSize: 13 }}>
                  {item.label}
                </div>
                <div style={{
                  color: '#104c72',
                  fontSize: 23,
                  fontWeight: 700,
                  marginTop: 10,
                  overflowWrap: 'anywhere'
                }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
            gap: 18
          }}>
            <div style={card}>
              <h3 style={{ color: '#104c72', marginTop: 0 }}>
                Sales by Location
              </h3>

              {branches.length === 0 && (
                <p style={{ color: '#64748b' }}>
                  No POS sales found for the reporting period.
                </p>
              )}

              {branches.map(branch => (
                <div key={branch.locationId} style={{
                  marginBottom: 18
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    fontSize: 13,
                    marginBottom: 7
                  }}>
                    <strong>{branch.name}</strong>
                    <span>{money(branch.gross)}</span>
                  </div>

                  <div style={{
                    height: 10,
                    background: '#eaf4fb',
                    borderRadius: 8,
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      width: Math.max(
                        0,
                        Math.min(
                          100,
                          (branch.grossNumber / maxSales) * 100
                        )
                      ) + '%',
                      background: '#104c72',
                      borderRadius: 8
                    }} />
                  </div>

                  <div style={{
                    fontSize: 12,
                    color: '#64748b',
                    marginTop: 5
                  }}>
                    {number(branch.acceptedSales)} accepted sales
                  </div>
                </div>
              ))}

              {data.sales.truncated && (
                <p role="alert" style={{ color: '#b45309' }}>
                  Sales analytics reached its 5,000-record limit.
                  Branch comparisons may be incomplete.
                </p>
              )}
            </div>

            <div style={card}>
              <h3 style={{ color: '#104c72', marginTop: 0 }}>
                Operational Attention
              </h3>

              {alerts.map(alert => (
                <div key={alert.label} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 0',
                  borderBottom: '1px solid #e2e8f0',
                  gap: 10
                }}>
                  <span>{alert.label}</span>
                  <strong style={{
                    color: alert.count > 0 ? '#ef3321' : '#104c72',
                    fontSize: 20
                  }}>
                    {number(alert.count)}
                  </strong>
                </div>
              ))}

              <p style={{
                fontSize: 12,
                color: '#64748b',
                marginTop: 14
              }}>
                Alert counts reflect returned records. Some backend
                attention lists are capped at 100 records.
              </p>

              <a href="/admin/finance-command-center" style={{
                display: 'inline-block',
                color: '#104c72',
                fontWeight: 700,
                marginTop: 10
              }}>
                Open Finance Command Center
              </a>
            </div>
          </div>

          <div style={{
            ...card,
            marginTop: 18,
            fontSize: 12,
            color: '#64748b'
          }}>
            <strong>Reporting information</strong>

            <p>
              Period: {String(data.overview.period?.from || 'N/A')}
              {' to '}
              {String(data.overview.period?.to || 'N/A')}
              {' (exclusive, UTC)'}
            </p>

            <p>
              Gross accepted sales exclude unsynchronized offline
              transactions and are not net revenue or profit.
              Inventory figures are current snapshots.
            </p>

            <p>
              Last refreshed: {updated}
            </p>
          </div>
        </>
      )}
    </section>
  );
}