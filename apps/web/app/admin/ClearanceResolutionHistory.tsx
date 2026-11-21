'use client';

import {useEffect,useState} from 'react';

type RecordItem={
  id:string;
  deviceId:string;
  localSaleId:string;
  shiftId:string;
  cashierId:string;
  status:string;
  createdAt:string;
  resolvedAt:string|null;
  resolvedBy:string|null;
  reason:string|null;
  paymentEvidenceReference:string|null;
  externalPaymentReconciled:boolean;
  auditId:string|null;
  auditAvailable:boolean;
};

type HistoryResponse={
  locationId:string;
  limit:number;
  records:RecordItem[];
};

export default function ClearanceResolutionHistory({
  locationId
}:{
  locationId:string
}){
  const [records,setRecords]=useState<RecordItem[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [search,setSearch]=useState('');
  const [refreshKey,setRefreshKey]=useState(0);

  useEffect(()=>{
    if(!locationId){
      setRecords([]);
      return;
    }

    let active=true;

    async function load(){
      setLoading(true);
      setError('');
      setRecords([]);

      try{
        const response=await fetch(
          '/api/v1/pos/checkout/clearance-resolution-history/'+
          encodeURIComponent(locationId),
          {
            credentials:'same-origin',
            cache:'no-store'
          }
        );

        const data=await response.json();

        if(!response.ok){
          throw new Error(
            Array.isArray(data.message)
              ?data.message.join('; ')
              :data.message||'History request failed'
          );
        }

        const result=data as HistoryResponse;

        if(!Array.isArray(result.records)){
          throw new Error('Invalid history response');
        }

        if(active)setRecords(result.records);
      }catch(e){
        if(active){
          setError(
            e instanceof Error?e.message:String(e)
          );
        }
      }finally{
        if(active)setLoading(false);
      }
    }

    void load();

    return ()=>{active=false;};
  },[locationId,refreshKey]);

  const query=search.trim().toLowerCase();

  const filtered=records.filter(r=>
    [
      r.localSaleId,
      r.deviceId,
      r.shiftId,
      r.resolvedBy||'',
      r.reason||'',
      r.paymentEvidenceReference||''
    ].some(v=>v.toLowerCase().includes(query))
  );

  return (
    <section className="card stack">
      <div className="row">
        <h3>Clearance resolution history</h3>
        <button
          className="secondary"
          disabled={loading||!locationId}
          onClick={()=>setRefreshKey(x=>x+1)}
        >
          Refresh history
        </button>
      </div>

      <p className="muted">
        Latest 100 manager-resolved no-sale exceptions
        for the selected branch. Audit evidence is read-only.
      </p>

      <label>
        Search loaded records
        <input
          value={search}
          onChange={e=>setSearch(e.target.value)}
          placeholder="Transaction, device, manager, reason or evidence"
        />
      </label>

      {loading&&<p>Loading resolution history...</p>}
      {error&&<p className="error" role="alert">{error}</p>}

      {!loading&&!error&&(
        <p>
          Showing {filtered.length} of {records.length} loaded records
        </p>
      )}

      {filtered.map(item=>(
        <article className="card stack" key={item.id}>
          <div className="row">
            <strong>{item.status}</strong>
            <span className="muted">
              {item.resolvedAt
                ?new Date(item.resolvedAt).toLocaleString('en-PK')
                :'Resolution time unavailable'}
            </span>
          </div>

          <p>
            Transaction: <code>{item.localSaleId}</code>
          </p>

          <p>
            Device: <code>{item.deviceId}</code>
          </p>

          <p>
            Shift: <code>{item.shiftId}</code>
          </p>

          <p>
            Resolved by: <code>{item.resolvedBy||'Unavailable'}</code>
          </p>

          <p>
            Reason: {item.reason||'Unavailable'}
          </p>

          <p>
            Payment evidence: {
              item.paymentEvidenceReference||'Unavailable'
            }
          </p>

          <p>
            External reconciliation attested: {
              item.externalPaymentReconciled?'Yes':'Not recorded'
            }
          </p>

          <p>
            Audit reference: <code>{item.auditId||'Missing'}</code>
          </p>

          {!item.auditAvailable&&(
            <p className="error">
              Audit record unavailable. Investigate before
              relying on this resolution.
            </p>
          )}
        </article>
      ))}

      {!loading&&!error&&filtered.length===0&&(
        <p>No matching resolution records in the loaded history.</p>
      )}
    </section>
  );
}
