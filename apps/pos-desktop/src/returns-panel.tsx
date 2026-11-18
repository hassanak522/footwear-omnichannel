import { useEffect, useState } from 'react';

type RequestFn = (
  path: string,
  method?: string,
  body?: unknown
) => Promise<any>;

type ReturnLine = {
  variantId: string;
  quantity: number;
  unitPrice?: string | number;
};

type Sale = {
  id: string;
  status: string;
  localSaleId?: string;
  syncedAt?: string;
  lines: ReturnLine[];
};

type ReturnSummary = {
  saleId: string;
  lines: {
    variantId: string;
    soldQuantity: number;
    returnedQuantity: number;
    remainingQuantity: number;
  }[];
  returns: {
    id: string;
    reason: string;
    refundDue: string;
    lines: {
      variantId: string;
      quantity: number;
      quarantined: boolean;
      refundAmount: string;
    }[];
  }[];
};
type DraftLine = {
  variantId: string;
  quantity: number;
  quarantined: boolean;
};

export default function ReturnsPanel({
  request,
  location,
  token
}: {
  request: RequestFn;
  location: string;
  token: string;
}) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [reason, setReason] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<any>(null);
  const [summary, setSummary] = useState<ReturnSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  const selected = sales.find(s => s.id === selectedId);

  useEffect(() => {
    setSales([]);
    setSelectedId('');
    setLines([]);
    setKey('');
    setResult(null);
    setMessage('');
  }, [location, token]);

  useEffect(() => {
    let cancelled = false;

    setSummary(null);
    setSummaryError('');

    if (!selectedId || !token || !location) {
      setSummaryLoading(false);
      return;
    }

    setSummaryLoading(true);

    void request(
      '/pos/returns/sale/' + encodeURIComponent(selectedId)
    ).then((data: ReturnSummary) => {
      if (cancelled) return;

      if (!data ||
          data.saleId !== selectedId ||
          !Array.isArray(data.lines) ||
          !Array.isArray(data.returns)) {
        throw new Error('Invalid return history response');
      }

      setSummary(data);
    }).catch((error: any) => {
      if (!cancelled) {
        setSummaryError(
          error.message || 'Unable to retrieve return history'
        );
      }
    }).finally(() => {
      if (!cancelled) setSummaryLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedId, token, location]);
  function invalidateDraft() {
    setKey('');
    setResult(null);
  }

  async function loadSales() {
    if (!token || !location) {
      setMessage('Sign in and select a branch first.');
      return;
    }

    setBusy(true);
    setMessage('');

    try {
      const data = await request(
        '/pos/sales/' + encodeURIComponent(location)
      );

      if (!Array.isArray(data)) {
        throw new Error('Invalid sales response');
      }

      setSales(data.filter(
        (s: Sale) => s.status === 'ACCEPTED'
      ));

      setSelectedId('');
      setLines([]);
      invalidateDraft();
    } catch (error: any) {
      setMessage(error.message || 'Unable to load sales');
    } finally {
      setBusy(false);
    }
  }

  function selectSale(id: string) {
    if (key || busy) return;
    const sale = sales.find(s => s.id === id);

    setSelectedId(id);
    setReason('');
    setLines((sale?.lines || []).map(line => ({
      variantId: line.variantId,
      quantity: 0,
      quarantined: false
    })));

    invalidateDraft();
    setMessage('');
  }

  function updateLine(
    variantId: string,
    changes: Partial<DraftLine>
  ) {
    if (key || busy) return;
    setLines(current => current.map(line =>
      line.variantId === variantId
        ? { ...line, ...changes }
        : line
    ));

    invalidateDraft();
  }

  async function submitReturn() {
        if (busy) return;

    if (!summary || summaryLoading || summaryError) {
      setMessage('Verified return history is required.');
      return;
    }

    if (!selected || !token || !location || summary.saleId !== selected.id) {
      setMessage('Select an accepted sale first.');
      return;
    }

    const selectedLines = lines.filter(
      line => line.quantity > 0
    );

    if (!selectedLines.length) {
      setMessage('Select at least one item to return.');
      return;
    }

    if (reason.trim().length < 3 ||
        reason.trim().length > 500) {
      setMessage('Enter a return reason of 3–500 characters.');
      return;
    }

    for (const line of selectedLines) {
      const sold = selected.lines.find(
        item => item.variantId === line.variantId
      );

            const balance = summary.lines.find(
        item => item.variantId === line.variantId
      );

      if (!sold ||
          !balance ||
          !Number.isInteger(line.quantity) ||
          line.quantity > balance.remainingQuantity) {
        setMessage('Invalid return quantity.');
        return;
      }
    }

    const returnKey = key || crypto.randomUUID();
    setKey(returnKey);
    setBusy(true);
    setMessage('');

    try {
      const response = await request(
        '/pos/returns',
        'POST',
        {
          saleId: selected.id,
          idempotencyKey: returnKey,
          reason: reason.trim(),
          lines: selectedLines
        }
      );

      if (!response?.id) {
        throw new Error('Return confirmation was incomplete');
      }

      setResult(response);
      setMessage(
        'Return recorded successfully. ' +
        'Arrange the refund payment according to branch policy.'
      );
    } catch (error: any) {
      setMessage(
        (error.message || 'Return failed') +
        ' The request identity is preserved. Retry the same request or ask a manager to reconcile it before starting another return.'
      );
    } finally {
      setBusy(false);
    }
  }

  const refundDue = result?.lines?.reduce(
    (sum: number, line: any) =>
      sum + Number(line.refundAmount || 0),
    0
  );

  return (
    <section className="panel">
      <h2>Sales returns and refund review</h2>

      <p>
        Manager authorization is required. Returns must be
        submitted online. Refund payments are handled separately.
      </p>

      <button
        className="secondary"
        disabled={busy || !!key || !token || !location}
        onClick={() => void loadSales()}
      >
        Load branch sales
      </button>

      <label>
        Original accepted sale
        <select
          value={selectedId}
          disabled={busy || !!key}
          onChange={e => selectSale(e.target.value)}
        >
          <option value="">Select sale</option>
          {sales.map(sale => (
            <option key={sale.id} value={sale.id}>
              {sale.id.slice(0, 12)}
              {' — '}
              {sale.syncedAt || 'Accepted'}
            </option>
          ))}
        </select>
      </label>

            {selected && summaryLoading && (
        <p role="status">Loading verified return quantities...</p>
      )}

      {selected && summaryError && (
        <p role="alert">
          Return history unavailable: {summaryError}
        </p>
      )}

      {selected && summary && (
        <div>
          <h3>Previous returns</h3>

          {summary.returns.length === 0 ? (
            <p className="hint">
              No previous returns recorded.
            </p>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Return ID</th>
                    <th>Reason</th>
                    <th>Refund due</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.returns.map(ret => (
                    <tr key={ret.id}>
                      <td>{ret.id.slice(0,12)}</td>
                      <td>{ret.reason}</td>
                      <td>
                        Rs. {Number(ret.refundDue).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="hint">
            Refund due does not confirm refund payment.
          </p>
        </div>
      )}

      {selected && !result && (
        <>
          <h3>Items to return</h3>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Sold</th>
                  <th>Previously returned</th>
                  <th>Remaining</th>
                  <th>Return qty</th>
                  <th>Quarantine</th>
                </tr>
              </thead>
              <tbody>
                {selected.lines.map(sold => {
                  const balance = summary?.lines.find(
                    item => item.variantId === sold.variantId
                  );

                  const remaining = balance?.remainingQuantity ?? 0;

                  const draft = lines.find(
                    item => item.variantId === sold.variantId
                  );

                  return (
                    <tr key={sold.variantId}>
                      <td>{sold.variantId.slice(0, 12)}</td>
                      <td>{sold.quantity}</td>
                      <td>{balance?.returnedQuantity ?? '—'}</td>
                      <td>{summary ? remaining : '—'}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={remaining}
                          step={1}
                          value={draft?.quantity || 0}
                          disabled={busy || !!key}
                          onChange={e => {
                            const value = Number(e.target.value);

                            updateLine(sold.variantId, {
                              quantity: Number.isFinite(value)
                                ? Math.max(
                                    0,
                                    Math.min(
                                      remaining, Math.trunc(value)
                                    )
                                  )
                                : 0
                            });
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={draft?.quarantined || false}
                          disabled={busy || !!key}
                          onChange={e =>
                            updateLine(sold.variantId, {
                              quarantined: e.target.checked
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <label>
            Return reason
            <textarea
              value={reason}
              maxLength={500}
              disabled={busy || !!key}
              onChange={e => {
                if (key || busy) return;
                setReason(e.target.value);
                invalidateDraft();
              }}
              placeholder="Describe why the items were returned"
            />
          </label>

          <button
            disabled={busy || !summary || summaryLoading || !!summaryError}
            onClick={() => void submitReturn()}
          >
            {busy ? 'Submitting...' : 'Record return'}
          </button>
        </>
      )}

      {result && (
        <div>
          <h3>Return confirmation</h3>
          <p>Return ID: {result.id}</p>
          {Number.isFinite(refundDue) && (
            <p>
              Refund due: Rs. {refundDue.toFixed(2)}
            </p>
          )}
          <p>
            This confirmation does not prove that a cash
            or card refund has been paid.
          </p>
          <button
            className="secondary"
            onClick={() => {
              setSelectedId('');
              setLines([]);
              setReason('');
              setKey('');
              setResult(null);
              setMessage('');
            }}
          >
            Start another return
          </button>
        </div>
      )}

      {message && <p role="status">{message}</p>}
    </section>
  );
}