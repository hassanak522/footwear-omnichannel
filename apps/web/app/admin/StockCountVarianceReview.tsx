'use client';

import { useState } from 'react';

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
  lines?: CountLine[];
};

type Props = {
  counts: Count[];
  busy: boolean;
  onPost: (id: string) => Promise<void>;
};

export default function StockCountVarianceReview({
  counts,
  busy,
  onPost,
}: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');

  const openCounts = counts.filter(c => c.status === 'OPEN');
  const selected = openCounts.find(c => c.id === selectedId);

  const lines = selected?.lines || [];

  const validLines = lines.length > 0 && lines.every(l =>
    Number.isSafeInteger(l.expectedQty) &&
    Number.isSafeInteger(l.countedQty) &&
    l.expectedQty >= 0 &&
    l.countedQty >= 0
  );

  const shortage = lines.reduce(
    (sum,l) => sum + Math.max(0,l.expectedQty-l.countedQty),0
  );

  const surplus = lines.reduce(
    (sum,l) => sum + Math.max(0,l.countedQty-l.expectedQty),0
  );

  const netVariance = surplus-shortage;

  async function submit() {
    if (!selected || !validLines || !confirmed || busy || posting) return;

    setPostError('');
    setPosting(true);

    try {
      await onPost(selected.id);
      setSelectedId('');
      setConfirmed(false);
    } catch (error) {
      setPostError(
        error instanceof Error ? error.message : 'Posting failed'
      );
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="card stack">
      <h3>Physical count variance review</h3>

      <p className="muted">
        Review recorded expected and counted quantities before posting.
        Posting changes inventory and creates audited stock movements.
      </p>

      <label>
        Open stock count
        <select
          value={selectedId}
          disabled={busy || posting}
          onChange={e => {
            setSelectedId(e.target.value);
            setConfirmed(false);
          }}
        >
          <option value="">Select a count to review</option>
          {openCounts.map(c => (
            <option key={c.id} value={c.id}>
              {c.reference} — {c.locationId}
            </option>
          ))}
        </select>
      </label>

      {postError && <p role="alert" className="error">{postError}</p>}
      {selected && (
        <>
          <p>
            <strong>Reference:</strong> {selected.reference}
          </p>

          <p className="muted">
            Location: {selected.locationId}
          </p>

          {!validLines ? (
            <p role="alert" className="error">
              Count lines are missing or invalid. Posting is disabled.
            </p>
          ) : (
            <>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Variant ID</th>
                      <th>Expected</th>
                      <th>Counted</th>
                      <th>Variance</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(line => {
                      const delta = line.countedQty-line.expectedQty;

                      return (
                        <tr key={line.id}>
                          <td>{line.variantId}</td>
                          <td>{line.expectedQty}</td>
                          <td>{line.countedQty}</td>
                          <td>{delta > 0 ? '+' : ''}{delta}</td>
                          <td>
                            {delta < 0 ? 'Shortage' :
                             delta > 0 ? 'Surplus' : 'Matched'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid">
                {[
                  ['Shortage units',shortage],
                  ['Surplus units',surplus],
                  ['Net variance',netVariance],
                  ['Count lines',lines.length],
                ].map(([label,value]) => (
                  <div className="card" key={String(label)}>
                    <span className="muted">{label}</span>
                    <div className="metric">{value}</div>
                  </div>
                ))}
              </div>

              <p className="muted">
                These quantities reflect the saved count. The server
                checks current inventory again when posting. If stock
                has changed since count creation, posting is rejected.
              </p>

              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || posting}
                  onChange={e=>setConfirmed(e.target.checked)}
                />
                {' '}I have reviewed the physical count and understand
                that posting updates stock quantities.
              </label>

              <button
                type="button"
                className="danger"
                disabled={!confirmed || busy || posting}
                onClick={submit}
              >
                {posting ? 'Posting count...' :
                  'Confirm and post physical count'}
              </button>
            </>
          )}
        </>
      )}

      {openCounts.length===0 && (
        <p className="muted">No open stock counts to review.</p>
      )}
    </section>
  );
}