'use client';

// R8_01G_4B15_CLEARANCE_CASEWORK
import {useEffect,useState} from 'react';

type Transaction={
 deviceId:string;
 localSaleId:string;
 saleId?:string;
 category:string;
 reason:string;
 expectedAmount?:number;
 observedAmount?:number;
};

type CaseRecord={
 id:string;
 deviceId:string;
 localSaleId:string;
 saleId:string|null;
 status:string;
 reason:string;
 reviewNote:string|null;
 expectedAmount:string|null;
 observedAmount:string|null;
 evidences?:Evidence[];
 _count?:{evidences:number};
};

type Evidence={
 id:string;
 kind:string;
 reference:string;
 note:string;
 createdAt:string;
};

type Props={
 locationId:string;
 transactions:Transaction[];
};

async function request<T>(
 path:string,
 method='GET',
 body?:unknown
):Promise<T>{
 const response=await fetch('/api/v1'+path,{
  method,
  credentials:'same-origin',
  cache:'no-store',
  headers:{'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });

 const result=await response.json().catch(()=>({}));

 if(!response.ok){
  throw new Error(
   Array.isArray(result.message)
    ?result.message.join('; ')
    :result.message||'HTTP '+response.status
  );
 }

 return result as T;
}

export default function ClearanceFinanceCasework({
 locationId,transactions
}:Props){
 const [cases,setCases]=useState<CaseRecord[]>([]);
 const [selected,setSelected]=useState<CaseRecord|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [reason,setReason]=useState('');
 const [evidenceKind,setEvidenceKind]=useState('OTHER');
 const [evidenceRef,setEvidenceRef]=useState('');
 const [evidenceNote,setEvidenceNote]=useState('');
 const [reviewStatus,setReviewStatus]=useState('UNDER_REVIEW');
 const [reviewNote,setReviewNote]=useState('');

 async function refresh(){
  if(!locationId)return;
  const result=await request<CaseRecord[]>(
   '/payment-exceptions?locationId='+
   encodeURIComponent(locationId)
  );
  setCases(result);
 }

 useEffect(()=>{
  let active=true;
  setCases([]);
  setSelected(null);
  setError('');

  if(locationId){
   request<CaseRecord[]>(
    '/payment-exceptions?locationId='+
    encodeURIComponent(locationId)
   ).then(result=>{
    if(active)setCases(result);
   }).catch(e=>{
    if(active)setError(String(e));
   });
  }

  return()=>{active=false;};
 },[locationId]);

 async function perform(action:()=>Promise<void>){
  setBusy(true);
  setError('');
  setMessage('');

  try{
   await action();
   await refresh();
  }catch(e){
   setError(String(e));
  }finally{
   setBusy(false);
  }
 }

 async function createCase(t:Transaction){
  const explanation=reason.trim()||t.reason;

  await perform(async()=>{
   await request('/payment-exceptions','POST',{
    locationId,
    deviceId:t.deviceId,
    localSaleId:t.localSaleId,
    ...(t.saleId?{saleId:t.saleId}:{}),
    reason:explanation,
    ...(t.expectedAmount===undefined?{}:{
     expectedAmount:t.expectedAmount
    }),
    ...(t.observedAmount===undefined?{}:{
     observedAmount:t.observedAmount
    })
   });

   setReason('');
   setMessage('Investigation case created.');
  });
 }

 async function openCase(id:string){
  await perform(async()=>{
   const detail=await request<CaseRecord>(
    '/payment-exceptions/'+encodeURIComponent(id)
   );
   setSelected(detail);
  });
 }

 async function attachEvidence(){
  if(!selected)return;

  const id=selected.id;

  await perform(async()=>{
   await request(
    '/payment-exceptions/'+encodeURIComponent(id)+'/evidence',
    'POST',{
     kind:evidenceKind,
     reference:evidenceRef,
     note:evidenceNote
    }
   );

   setEvidenceRef('');
   setEvidenceNote('');

   setSelected(await request<CaseRecord>(
    '/payment-exceptions/'+encodeURIComponent(id)
   ));

   setMessage('Evidence attached.');
  });
 }

 async function review(){
  if(!selected)return;

  const id=selected.id;

  await perform(async()=>{
   await request(
    '/payment-exceptions/'+encodeURIComponent(id)+'/review',
    'PATCH',{
     status:reviewStatus,
     note:reviewNote
    }
   );

   setReviewNote('');

   setSelected(await request<CaseRecord>(
    '/payment-exceptions/'+encodeURIComponent(id)
   ));

   setMessage('Manager review updated.');
  });
 }

 const caseFor=(t:Transaction)=>cases.find(c=>
  c.deviceId===t.deviceId&&
  c.localSaleId===t.localSaleId
 );

 const activeTransactions=transactions.filter(t=>
  t.category!=='RESOLVED_NO_SALE'
 );

 const openCount=cases.filter(c=>
  c.status==='OPEN'||c.status==='UNDER_REVIEW'
 ).length;

 return (
  <div className="card stack">
   <h3>Clearance finance investigation casework</h3>

   <p className="muted">
    Cases are linked to the existing payment-exception
    register. Creating or resolving a case does not
    confirm settlement or authorize another charge.
   </p>

   <p>
    <strong>Branch payment cases:</strong> {cases.length}
    {' | '}
    <strong>Open / under review:</strong> {openCount}
   </p>

   {error&&<p role="alert">{error}</p>}
   {message&&<p>{message}</p>}

   <label>
    Optional investigation reason
    <textarea
     value={reason}
     maxLength={1000}
     onChange={e=>setReason(e.target.value)}
     placeholder="Add context before creating a case"
    />
   </label>

   <div style={{overflowX:'auto'}}>
    <table>
     <thead>
      <tr>
       <th>Classification</th>
       <th>Transaction</th>
       <th>Case status</th>
       <th>Action</th>
      </tr>
     </thead>
     <tbody>
      {activeTransactions.map(t=>{
       const existing=caseFor(t);

       return (
        <tr key={t.deviceId+'-'+t.localSaleId}>
         <td>{t.category}</td>
         <td>{t.localSaleId}</td>
         <td>{existing?.status||'NO CASE'}</td>
         <td>
          {existing?(
           <button
            className="secondary"
            disabled={busy}
            onClick={()=>openCase(existing.id)}
           >
            Open case
           </button>
          ):(
           <button
            disabled={busy}
            onClick={()=>createCase(t)}
           >
            Create case
           </button>
          )}
         </td>
        </tr>
       );
      })}
     </tbody>
    </table>
   </div>

   {activeTransactions.length===0&&(
    <p>No active classified transactions require casework.</p>
   )}

   {selected&&(
    <div className="card stack">
     <div className="row">
      <h3>Investigation details</h3>
      <button
       className="secondary"
       onClick={()=>setSelected(null)}
      >
       Close
      </button>
     </div>

     <p><strong>Case:</strong> {selected.id}</p>
     <p><strong>Status:</strong> {selected.status}</p>
     <p><strong>Reason:</strong> {selected.reason}</p>
     <p><strong>Review:</strong> {selected.reviewNote||'Pending'}</p>

     <h4>Supporting evidence</h4>

     {(selected.evidences||[]).map(e=>(
      <div key={e.id}>
       <strong>{e.kind}</strong> — {e.reference}
       <p>{e.note}</p>
      </div>
     ))}

     {selected.status!=='RESOLVED'&&
      selected.status!=='VOIDED'&&(
      <>
       <label>
        Evidence type
        <select
         value={evidenceKind}
         onChange={e=>setEvidenceKind(e.target.value)}
        >
         <option value="OTHER">Other</option>
         <option value="CASH_COUNT">Cash count</option>
         <option value="TERMINAL_RECEIPT">Terminal receipt</option>
         <option value="BANK_REFERENCE">Bank reference</option>
        </select>
       </label>

       <label>
        Evidence reference
        <input
         value={evidenceRef}
         maxLength={200}
         onChange={e=>setEvidenceRef(e.target.value)}
        />
       </label>

       <label>
        Evidence note
        <textarea
         value={evidenceNote}
         maxLength={1000}
         onChange={e=>setEvidenceNote(e.target.value)}
        />
       </label>

       <button
        disabled={busy||!evidenceRef.trim()||!evidenceNote.trim()}
        onClick={attachEvidence}
       >
        Attach evidence
       </button>

       <h4>Manager review</h4>

       <label>
        Review decision
        <select
         value={reviewStatus}
         onChange={e=>setReviewStatus(e.target.value)}
        >
         <option value="UNDER_REVIEW">Under review</option>
         <option value="RESOLVED">Resolved</option>
         <option value="VOIDED">Voided</option>
        </select>
       </label>

       <label>
        Manager review note
        <textarea
         value={reviewNote}
         maxLength={2000}
         onChange={e=>setReviewNote(e.target.value)}
        />
       </label>

       <button
        disabled={busy||!reviewNote.trim()}
        onClick={review}
       >
        Save manager review
       </button>

       <p className="muted">
        Closing a payment-exception case does not resolve
        the underlying central clearance attempt.
        Use the Clearance exceptions workflow separately.
       </p>
      </>
     )}
    </div>
   )}
  </div>
 );
}
