import ExchangeRecovery from './exchange-recovery';
import ExchangePanel from './exchange-panel';
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
  variant?: {
    sku: string;
    barcode: string;
    size: string;
    color: string;
  };
};

type Sale = {
  id: string;
  status: string;
  localSaleId?: string;
  syncedAt?: string;
  soldAt?: string;
  total?: string | number;
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
    refundSettled: string;
    refundOutstanding: string;
    settlementStatus:
      | 'UNSETTLED'
      | 'PARTIALLY_SETTLED'
      | 'SETTLED';
    settlements: {
      id: string;
      method: 'CASH' | 'CARD' | 'OTHER';
      amount: string;
      reference: string | null;
      payoutShiftId: string | null;
      settledById: string;
      settledAt: string;
    }[];
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
  token,
  shiftId,
  deviceId
}: {
  request: RequestFn;
  location: string;
  token: string;
  shiftId: string;
  deviceId: string;
}) {
  // R10_3D23B_DESKTOP_CONTRACT
  // R10_3D23_RETURN_SEARCH
  const [exchangeMode,setExchangeMode]=useState(false);
  const [receiptSearch,setReceiptSearch]=useState('');
  const [catalogLabels,setCatalogLabels]=useState<
   Record<string,string>
  >({});

  useEffect(()=>{
   let cancelled=false;

   void window.pos.listCatalog().then(items=>{
    if(cancelled)return;

    setCatalogLabels(Object.fromEntries(
     items.map(item=>[
      item.id,
      `${item.title} | ${item.sku} | Size ${item.size} | ${item.color}`
     ])
    ));
   }).catch(()=>{});

   return ()=>{cancelled=true;};
  },[location]);

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




  const [payoutReturnId, setPayoutReturnId] = useState('');
  const [payoutMethod, setPayoutMethod] =
    useState<'CASH' | 'CARD' | 'OTHER'>('CASH');
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutReference, setPayoutReference] = useState('');
  const [payoutKey, setPayoutKey] = useState('');
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [payoutMessage, setPayoutMessage] = useState('');
  const [historyRevision, setHistoryRevision] = useState(0);

  const selectedPayoutReturn = summary?.returns.find(
    ret => ret.id === payoutReturnId
  );

  function resetPayout() {
    setPayoutReturnId('');
    setPayoutAmount('');
    setPayoutReference('');
    setPayoutMethod('CASH');
    setPayoutKey('');
    setPayoutMessage('');
  }

  async function recordPayout() {
    if (payoutBusy || !selectedPayoutReturn) return;

    const amount = Number(payoutAmount);
    const outstanding =
      Number(selectedPayoutReturn.refundOutstanding);

    if (
      !Number.isFinite(amount) ||
      !Number.isSafeInteger(Math.round(amount * 100)) ||
      amount <= 0 ||
      Math.round(amount * 100) > Math.round(outstanding * 100) ||
      Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001
    ) {
      setPayoutMessage(
        'Enter a valid amount within the outstanding refund balance.'
      );
      return;
    }

    if (payoutMethod === 'CASH' && !shiftId) {
      setPayoutMessage(
        'Open a cashier shift before recording a cash payout.'
      );
      return;
    }

    if (
      payoutMethod !== 'CASH' &&
      !payoutReference.trim()
    ) {
      setPayoutMessage(
        'Card and other payouts require a payment reference.'
      );
      return;
    }

    if (
      !window.confirm(
        'Confirm the refund was actually paid? ' +
        'This records a financial settlement and cannot be undone here.'
      )
    ) return;

    const identity = payoutKey || crypto.randomUUID();
    setPayoutKey(identity);
    setPayoutBusy(true);
    setPayoutMessage('');

    try {
      const response = await request(
        '/pos/returns/settlements',
        'POST',
        {
          returnId: selectedPayoutReturn.id,
          idempotencyKey: identity,
          method: payoutMethod,
          amount,
          ...(payoutMethod === 'CASH'
            ? { payoutShiftId: shiftId }
            : {}),
          ...(payoutReference.trim()
            ? { reference: payoutReference.trim() }
            : {})
        }
      );

      if (!response?.id) {
        throw new Error('Settlement confirmation was incomplete');
      }

      setPayoutMessage(
        response.duplicate
          ? 'Existing settlement confirmation retrieved.'
          : 'Refund settlement recorded. Refreshing history.'
      );

      setPayoutKey('');
      setPayoutAmount('');
      setPayoutReference('');
      setPayoutReturnId('');
      setHistoryRevision(value => value + 1);

    } catch (error: any) {
      setPayoutMessage(
        (error.message || 'Unable to record settlement') +
        ' Do not repeat the physical payout. Retry using the ' +
        'same settlement details or reconcile with HQ.'
      );
    } finally {
      setPayoutBusy(false);
    }
  }
  const selected = sales.find(s => s.id === selectedId);

  useEffect(() => {
    resetPayout();
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
  }, [selectedId, token, location, historyRevision]);

  function invalidateDraft() {
    setKey('');
    setResult(null);
  }

  async function searchReceipt(){
   if(busy||key||payoutKey)return;

   if(!token||!location){
    setMessage('Sign in and select a branch first.');
    return;
   }

   if(receiptSearch.trim().length<6){
    setMessage('Enter at least six receipt characters.');
    return;
   }

   setBusy(true);
   setMessage('');

   try{
    const data=await request(
     '/pos/returns/receipt-lookup?locationId='+
     encodeURIComponent(location)+
     '&receipt='+
     encodeURIComponent(receiptSearch.trim())
    );

    if(!Array.isArray(data)){
     throw new Error('Invalid receipt lookup response');
    }

    setSales(data);
    setSelectedId('');
    setLines([]);
    setReason('');
    setResult(null);
    resetPayout();

    setMessage(
     data.length
      ?`${data.length} matching accepted sale(s).`
      :'No matching accepted sale in this branch.'
    );
   }catch(error){
    setMessage(
     error instanceof Error
      ?error.message
      :'Receipt search failed'
    );
   }finally{
    setBusy(false);
   }
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
    if (key || busy || payoutBusy || payoutKey) return;
    const sale = sales.find(s => s.id === id);

    resetPayout();
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
    if (key || busy || payoutBusy || payoutKey) return;
    setLines(current => current.map(line =>
      line.variantId === variantId
        ? { ...line, ...changes }
        : line
    ));

    invalidateDraft();
  }

  async function submitReturn() {
    if(exchangeMode)return;
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

    if(!key&&!window.confirm(
     'APPROVE MERCHANDISE RETURN\n\n'+
     'Units: '+selectedLines.reduce(
      (sum,line)=>sum+line.quantity,0
     )+'\n'+
     'Quarantined units: '+selectedLines.filter(
      line=>line.quarantined
     ).reduce((sum,line)=>sum+line.quantity,0)+'\n\n'+
     'This restores inventory and creates a refund obligation. '+
     'It does not record a physical refund payment.\n\n'+
     'Confirm approval?'
    )){
     return;
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

      // R10_3D23_REFUND_SAFETY
    setResult(response);
    setHistoryRevision(value=>value+1);
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

  // R10_3D23_RETURN_DOCUMENT
  function downloadReturnConfirmation(){
   if(!result?.id||!selected)return;

   const rows=Array.isArray(result.lines)
    ?result.lines
    :[];

   const total=rows.reduce(
    (sum:number,line:any)=>
     sum+Math.round(Number(line.refundAmount||0)*100),
    0
   )/100;

   const content=[
    'ROYAL STEP',
    'MERCHANDISE RETURN CONFIRMATION',
    '----------------------------------------',
    'Return ID: '+result.id,
    'Original sale: '+selected.id,
    'Original receipt: '+(selected.localSaleId||selected.id),
    'Branch ID: '+location,
    'Return recorded: '+(
     result.createdAt
      ?new Date(result.createdAt).toLocaleString()
      :'See central transaction record'
    ),
    'Reason: '+reason,
    '----------------------------------------',
    ...rows.map((line:any)=>[
     catalogLabels[line.variantId]||line.variantId,
     'Quantity: '+line.quantity,
     'Condition: '+(
      line.quarantined?'QUARANTINED':'SELLABLE'
     ),
     'Refund due: PKR '+Number(
      line.refundAmount||0
     ).toFixed(2),
     '----------------------------------------'
    ].join('\n')),
    'TOTAL REFUND DUE: PKR '+total.toFixed(2),
    '',
    'This document confirms merchandise return approval.',
    'It is not proof of refund payment.',
    'Actual payments are recorded separately.',
    '',
    'Thank you for shopping at Royal Step.'
   ].join('\r\n');

   const url=URL.createObjectURL(
    new Blob([content],{
     type:'text/plain;charset=utf-8'
    })
   );

   const link=document.createElement('a');

   link.href=url;
   link.download='Royal-Step-Return-'+result.id+'.txt';

   document.body.appendChild(link);
   link.click();
   link.remove();

   window.setTimeout(
    ()=>URL.revokeObjectURL(url),1000
   );
  }

  const refundDue = result?.lines?.reduce(
    (sum: number, line: any) =>
      sum + Number(line.refundAmount || 0),
    0
  );

  return (
    <section className="panel">
      <h2>Sales returns and refund review</h2>

      {/* R10_3D23B_EXCHANGE_PANEL */}
      <div style={{display:'flex',gap:8,margin:'12px 0'}}>
       <button
        className={exchangeMode?'secondary':''}
        disabled={busy||!!key||payoutBusy||!!payoutKey}
        onClick={()=>setExchangeMode(false)}
       >
        Merchandise return
       </button>

       <button
        className={exchangeMode?'':'secondary'}
        disabled={busy||!!key||payoutBusy||!!payoutKey}
        onClick={()=>setExchangeMode(true)}
       >
        Merchandise exchange
       </button>
      </div>


      <div style={{
       display:'flex',
       flexWrap:'wrap',
       gap:8,
       margin:'12px 0'
      }}>
       <input
        value={receiptSearch}
        disabled={busy||!!key||!!payoutKey}
        onChange={e=>setReceiptSearch(e.target.value)}
        placeholder="Original receipt or sale ID"
        onKeyDown={e=>{
         if(e.key==='Enter'){
          e.preventDefault();
          void searchReceipt();
         }
        }}
       />

       <button
        className="secondary"
        disabled={
         busy||!!key||!!payoutKey||
         !token||!location||
         receiptSearch.trim().length<6
        }
        onClick={()=>void searchReceipt()}
       >
        Find original receipt
       </button>
      </div>

      <p className="hint">
       Historical receipt lookup searches accepted
       transactions in the selected branch.
      </p>

      <p>
        Manager authorization is required. Returns must be
        submitted online. Refund payments are handled separately.
      </p>

      <button
        className="secondary"
        disabled={busy || !!key || payoutBusy || !!payoutKey || !token || !location}
        onClick={() => void loadSales()}
      >
        Load branch sales
      </button>

      <label>
        Original accepted sale
        <select
          value={selectedId}
          disabled={busy || !!key || payoutBusy || !!payoutKey}
          onChange={e => selectSale(e.target.value)}
        >
          <option value="">Select sale</option>
          {sales.map(sale => (
            <option key={sale.id} value={sale.id}>
              {sale.localSaleId||sale.id}
              {' — '}
              {sale.soldAt||sale.syncedAt
 ?new Date(sale.soldAt||sale.syncedAt||'').toLocaleString()
 :'Accepted'}
{sale.total!=null
 ?' | Rs. '+Number(sale.total).toFixed(2)
 :''}
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
                    <th>Paid</th>
                    <th>Outstanding</th>
                    <th>Status</th>
                    <th>Payment details</th>
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
                      <td>
                        Rs. {Number(ret.refundSettled).toFixed(2)}
                      </td>
                      <td>
                        Rs. {Number(ret.refundOutstanding).toFixed(2)}
                      </td>
                      <td>
                        {ret.settlementStatus.replace(/_/g, ' ')}
                      </td>
                      <td>
                        {ret.settlements.length === 0 ? (
                          <span>No payment recorded</span>
                        ) : (
                          ret.settlements.map(payment => (
                            <div key={payment.id}>
                              <strong>{payment.method}</strong>
                              {' | Rs. '}
                              {Number(payment.amount).toFixed(2)}
                              {' | '}
                              {new Date(
                                payment.settledAt
                              ).toLocaleString()}
                              {payment.reference
                                ? ' | Ref: ' + payment.reference
                                : ''}
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="hint">
            Refund approval does not confirm payment.
            Recorded settlements show paid amounts and
            outstanding refund balances. Cash payouts
            must be reconciled against drawer movements.
          </p>
        </div>
      )}

            {selected && summary && summary.returns.length > 0 && (
        <div className="panel">
          <h3>Record refund payment</h3>
          <p className="hint">
            Manager-only operation. Record payment only after
            cash has been handed over or the external refund
            has actually been completed.
          </p>

          <label>
            Approved return
            <select
              value={payoutReturnId}
              disabled={payoutBusy || !!payoutKey}
              onChange={e => {
                setPayoutReturnId(e.target.value);
                const ret = summary.returns.find(
                  item => item.id === e.target.value
                );
                setPayoutAmount(
                  ret ? ret.refundOutstanding : ''
                );
                setPayoutKey('');
                setPayoutMessage('');
              }}
            >
              <option value="">Select return to settle</option>
              {summary.returns
                .filter(ret =>
                  Number(ret.refundOutstanding) > 0
                )
                .map(ret => (
                  <option key={ret.id} value={ret.id}>
                    {ret.id.slice(0, 12)}
                    {' | Outstanding Rs. '}
                    {Number(ret.refundOutstanding).toFixed(2)}
                  </option>
                ))}
            </select>
          </label>

          {selectedPayoutReturn && (
            <>
              <p>
                Outstanding refund:
                {' Rs. '}
                {Number(
                  selectedPayoutReturn.refundOutstanding
                ).toFixed(2)}
              </p>

              <label>
                Refund method
                <select
                  value={payoutMethod}
                  disabled={payoutBusy || !!payoutKey}
                  onChange={e => {
                    setPayoutMethod(
                      e.target.value as 'CASH' | 'CARD' | 'OTHER'
                    );
                    setPayoutKey('');
                  }}
                >
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>

              <label>
                Amount paid (PKR)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={selectedPayoutReturn.refundOutstanding}
                  value={payoutAmount}
                  disabled={payoutBusy || !!payoutKey}
                  onChange={e => {
                    setPayoutAmount(e.target.value);
                    setPayoutKey('');
                  }}
                />
              </label>

              <label>
                Payment reference
                <input
                  value={payoutReference}
                  maxLength={200}
                  disabled={payoutBusy || !!payoutKey}
                  onChange={e => {
                    setPayoutReference(e.target.value);
                    setPayoutKey('');
                  }}
                  placeholder={
                    payoutMethod === 'CASH'
                      ? 'Optional cash receipt reference'
                      : 'Required external transaction reference'
                  }
                />
              </label>

              {payoutMethod === 'CASH' && (
                <p className="hint">
                  Current payout shift:
                  {' '}
                  {shiftId || 'No open shift selected'}
                  . An approved cash refund drawer movement
                  will be recorded automatically.
                </p>
              )}

              <button
                disabled={
                  payoutBusy ||
                  !payoutAmount ||
                  (payoutMethod === 'CASH' && !shiftId) ||
                  (payoutMethod !== 'CASH' &&
                    !payoutReference.trim())
                }
                onClick={() => void recordPayout()}
              >
                {payoutBusy
                  ? 'Recording settlement...'
                  : 'Confirm payment already made'}
              </button>
            </>
          )}

          {payoutMessage && (
            <p role="status">{payoutMessage}</p>
          )}
        </div>
      )}
      {selected && !result && (
        <>
          <h3>Items to return</h3>

          {/* R10_3D23_RETURN_SELECTION */}
          <div style={{
           display:'flex',
           flexWrap:'wrap',
           gap:8,
           margin:'12px 0'
          }}>
           <button
            className="secondary"
            disabled={busy||!!key||!summary||summaryLoading}
            onClick={()=>{
             if(!summary||key||busy)return;

             setLines(current=>current.map(line=>({
              ...line,
              quantity:summary.lines.find(
               item=>item.variantId===line.variantId
              )?.remainingQuantity||0
             })));
            }}
           >
            Return all remaining items
           </button>

           <button
            className="secondary"
            disabled={busy||!!key}
            onClick={()=>{
             if(key||busy)return;

             setLines(current=>current.map(line=>({
              ...line,
              quantity:0
             })));
            }}
           >
            Clear quantities
           </button>
          </div>

          <p>
           Selected units:
           {' '}
           <strong>
            {lines.reduce((sum,line)=>sum+line.quantity,0)}
           </strong>
          </p>

          <p className="hint">
           Inspect every item before approval.
           Select quarantine for damaged or otherwise
           non-sellable merchandise.
           Quarantined units must not be sold.
          </p>

          <p className="hint">
           The server calculates the actual refund from
           the original sale and discount allocations.
          </p>

          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Sold</th>
                  <th>Previously returned</th>
                  <th>Remaining</th>
                  <th>Return qty</th>
                  <th>Damaged / quarantine</th>
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
                      <td>{sold.variant
 ?`${sold.variant.sku} | Size ${sold.variant.size} | ${sold.variant.color}`
 :catalogLabels[sold.variantId]||sold.variantId}</td>
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
                          disabled={busy || !!key || payoutBusy || !!payoutKey}
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
                          disabled={busy || !!key || payoutBusy || !!payoutKey}
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
              disabled={busy || !!key || payoutBusy || !!payoutKey}
              onChange={e => {
                if (key || busy || payoutBusy || payoutKey) return;
                setReason(e.target.value);
                invalidateDraft();
              }}
              placeholder="Describe why the items were returned"
            />
          </label>

          <button
            disabled={busy || !summary || summaryLoading || !!summaryError}
            onClick={()=>{if(!exchangeMode)void submitReturn();}}
          >
            {busy ? 'Submitting...' : 'Record return'}
          </button>
        </>
      )}

      {result && (
        <div>
          <h3>Return confirmation</h3>

          <button
           className="secondary"
           onClick={downloadReturnConfirmation}
          >
           Download return confirmation
          </button>
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
              if(payoutBusy||payoutKey){
               setMessage(
                'Reconcile the existing refund payment first.'
               );
               return;
              }

              resetPayout();
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
          {exchangeMode&&selected&&summary&&
       !summaryLoading&&!summaryError&&!result&&
       !key&&!payoutKey&&!payoutBusy&&(
        <ExchangePanel
         key={location+':'+deviceId+':'+shiftId+':'+selectedId}
         request={request}
         location={location}
         deviceId={deviceId}
         shiftId={shiftId}
         token={token}
         originalSaleId={selected.id}
         returnLines={lines}
         reason={reason}
         onCompleted={()=>{
          setHistoryRevision(value=>value+1);
          setLines(current=>current.map(line=>({
           ...line,quantity:0
          })));
          setReason('');
         }}
        />
      )}

      {/* R10_3D23B_RECOVERY_PANEL */}
      <ExchangeRecovery
       request={request}
       token={token}
       location={location}
      />

</section>
  );
}
