'use client';

import {useEffect,useState} from 'react';
import ClearanceResolutionHistory from './ClearanceResolutionHistory';

type Location={
  id:string;
  name:string;
  type:string;
  active:boolean;
};

type Attempt={
  id:string;
  deviceId:string;
  localSaleId:string;
  shiftId:string;
  locationId:string;
  cashierId:string;
  status:string;
  createdAt:string;
  updatedAt:string;
};

type SaleStatus={
  found:boolean;
  clearanceSale?:boolean;
  status?:string;
  paymentState?:string;
  integrity?:{
    allocationValid?:boolean;
  };
};

async function api(
  path:string,
  method='GET',
  body?:unknown
){
  const response=await fetch('/api/v1'+path,{
    method,
    credentials:'same-origin',
    cache:'no-store',
    headers:{'Content-Type':'application/json'},
    ...(body===undefined?{}:{
      body:JSON.stringify(body)
    })
  });

  const result=await response.json().catch(()=>({}));

  if(!response.ok){
    const message=Array.isArray(result.message)
      ?result.message.join('; ')
      :result.message||'HTTP '+response.status;

    throw new Error(message);
  }

  return result;
}

function date(value:string){
  return new Date(value).toLocaleString('en-PK');
}

export default function ClearanceExceptionDashboard(){
  const [branches,setBranches]=useState<Location[]>([]);
  const [branchId,setBranchId]=useState('');
  const [attempts,setAttempts]=useState<Attempt[]>([]);
  const [selected,setSelected]=useState<Attempt|null>(null);
  const [sale,setSale]=useState<SaleStatus|null>(null);

  const [reason,setReason]=useState('');
  const [evidence,setEvidence]=useState('');
  const [confirmed,setConfirmed]=useState(false);

  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');

  useEffect(()=>{
    let active=true;

    api('/inventory/locations')
      .then((rows:Location[])=>{
        if(!active)return;

        const available=rows.filter(
          x=>x.type==='BRANCH'&&x.active
        );

        setBranches(available);
        setBranchId(current=>current||available[0]?.id||'');
      })
      .catch(e=>{
        if(active)setError(String(e));
      });

    return ()=>{active=false;};
  },[]);

  async function load(id:string){
    if(!id)return;

    setLoading(true);
    setError('');

    try{
      const rows=await api(
        '/pos/checkout/clearance-exceptions/'+
        encodeURIComponent(id)
      );

      if(!Array.isArray(rows)){
        throw new Error('Invalid exception list response');
      }

      setAttempts(rows);
    }catch(e){
      setError(String(e));
      setAttempts([]);
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{
    setSelected(null);
    setSale(null);
    setAttempts([]);

    if(branchId)void load(branchId);
  },[branchId]);

  async function inspect(item:Attempt){
    setSelected(item);
    setSale(null);
    setReason('');
    setEvidence('');
    setConfirmed(false);
    setError('');
    setSuccess('');
    setBusy(true);

    try{
      const result=await api(
        '/pos/checkout/clearance-status/'+
        encodeURIComponent(item.deviceId)+'/'+
        encodeURIComponent(item.localSaleId)
      );

      setSale(result);
    }catch(e){
      setError(
        'Unable to verify the authoritative sale: '+String(e)
      );
    }finally{
      setBusy(false);
    }
  }

  async function resolve(){
    if(!selected||!sale||sale.found!==false){
      setError(
        'No-sale resolution requires a successful server lookup '+
        'confirming no recorded sale.'
      );
      return;
    }

    if(!confirmed||reason.trim().length<20||
       evidence.trim().length<5){
      setError(
        'Complete payment reconciliation, detailed reason, '+
        'and evidence reference before resolving.'
      );
      return;
    }

    if(!window.confirm(
      'Confirm that payment records were checked externally '+
      'and this transaction has no recorded POS sale? '+
      'The original transaction ID will be retired.'
    ))return;

    setBusy(true);
    setError('');
    setSuccess('');

    try{
      await api(
        '/pos/checkout/clearance-attempt/resolve-no-sale',
        'POST',
        {
          deviceId:selected.deviceId,
          localSaleId:selected.localSaleId,
          reason:reason.trim(),
          paymentEvidenceReference:evidence.trim(),
          externalPaymentReconciled:true
        }
      );

      setSuccess(
        'Exception resolved. Original transaction ID retired.'
      );

      setSelected(null);
      setSale(null);
      setReason('');
      setEvidence('');
      setConfirmed(false);

      await load(branchId);
    }catch(e){
      setError(String(e));
    }finally{
      setBusy(false);
    }
  }

  const canResolve=
    !!selected&&
    sale?.found===false&&
    confirmed&&
    reason.trim().length>=20&&
    evidence.trim().length>=5&&
    !busy;

  return (
    <section className="card stack">
      <h2>Clearance exception management</h2>

      <p className="muted">
        Manager-only reconciliation of centrally registered
        clearance attempts. A missing POS sale does not prove
        that an external payment was never collected.
      </p>

      <div className="row">
        <label>
          Branch
          <select
            value={branchId}
            onChange={e=>setBranchId(e.target.value)}
          >
            {branches.map(b=>(
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <button
          className="secondary"
          disabled={loading||busy||!branchId}
          onClick={()=>void load(branchId)}
        >
          Refresh exceptions
        </button>
      </div>

      {error&&<p className="error" role="alert">{error}</p>}
      {success&&<p className="success" role="status">{success}</p>}

      <div className="grid">
        <div className="card">
          <span className="muted">Unresolved attempts</span>
          <div className="metric">{attempts.length}</div>
        </div>

        <div className="card">
          <span className="muted">Registered</span>
          <div className="metric">
            {attempts.filter(x=>x.status==='REGISTERED').length}
          </div>
        </div>

        <div className="card">
          <span className="muted">Review required</span>
          <div className="metric">
            {attempts.filter(x=>x.status==='REVIEW_REQUIRED').length}
          </div>
        </div>
      </div>

      {loading&&<p>Loading exceptions...</p>}

      {!loading&&attempts.length===0&&(
        <p>No unresolved clearance attempts returned for this branch.</p>
      )}

      {attempts.map(item=>(
        <article className="card stack" key={item.id}>
          <div className="row">
            <strong>{item.status}</strong>
            <span className="muted">{date(item.createdAt)}</span>
          </div>

          <p>Transaction: <code>{item.localSaleId}</code></p>
          <p>Device: <code>{item.deviceId}</code></p>
          <p>Shift: <code>{item.shiftId}</code></p>

          <button
            className="secondary"
            disabled={busy}
            onClick={()=>void inspect(item)}
          >
            Review transaction
          </button>
        </article>
      ))}

      {/* R8_01G_4B8E_HISTORY_PANEL */}
      {branchId&&(
        <ClearanceResolutionHistory
          key={branchId}
          locationId={branchId}
        />
      )}

      {selected&&(
        <section className="card stack">
          <h3>Manager review</h3>

          <p>
            Transaction: <code>{selected.localSaleId}</code>
          </p>

          <p>
            Server sale status: {
              sale===null
                ?'Not verified'
                :sale.found
                  ?'Recorded sale found'
                  :'No recorded sale found'
            }
          </p>

          {sale?.found&&(
            <p className="error">
              A POS sale exists. No-sale resolution is prohibited.
              Use the existing sale reconciliation process.
            </p>
          )}

          {sale?.found===false&&(
            <>
              <p className="muted">
                Check the card terminal, bank, and other applicable
                payment records before proceeding. This interface
                cannot verify external payment settlement.
              </p>

              <label>
                Detailed resolution reason
                <textarea
                  rows={4}
                  minLength={20}
                  maxLength={1000}
                  value={reason}
                  onChange={e=>setReason(e.target.value)}
                  placeholder="Describe the investigation and findings"
                />
              </label>

              <label>
                Payment evidence reference
                <input
                  minLength={5}
                  maxLength={200}
                  value={evidence}
                  onChange={e=>setEvidence(e.target.value)}
                  placeholder="Terminal batch, bank reference, or reconciliation case"
                />
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={e=>setConfirmed(e.target.checked)}
                />
                I confirm external payment reconciliation was completed.
              </label>

              <button
                disabled={!canResolve}
                onClick={()=>void resolve()}
              >
                Resolve as no sale
              </button>
            </>
          )}

          <button
            className="secondary"
            disabled={busy}
            onClick={()=>{
              setSelected(null);
              setSale(null);
            }}
          >
            Close review
          </button>
        </section>
      )}
    </section>
  );
}
