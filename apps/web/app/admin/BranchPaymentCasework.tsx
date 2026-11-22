'use client';

import {useCallback,useEffect,useState} from 'react';

type Case={
 id:string;
 locationId:string;
 deviceId:string;
 localSaleId:string;
 saleId:string|null;
 status:string;
 reason:string;
 expectedAmount:string|null;
 observedAmount:string|null;
 createdAt:string;
 reviewNote:string|null;
};

type Evidence={
 id:string;
 kind:string;
 reference:string;
 note:string;
 createdAt:string;
};

type Detail=Case&{
 evidences:Evidence[];
};

type AuditEvent={
 id:string;
 action:string;
 actorId:string;
 createdAt:string;
};

type AuditHistory={
 truncated:boolean;
 events:AuditEvent[];
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

 const data=await response.json().catch(()=>({}));

 if(!response.ok){
  throw Error(
   Array.isArray(data.message)
    ?data.message.join('; ')
    :data.message||'HTTP '+response.status
  );
 }

 return data as T;
}

const panel:React.CSSProperties={
 background:'#fff',
 border:'1px solid #dbe3ed',
 borderRadius:12,
 padding:18
};

const formatAmount=(value:string|null)=>
 value===null?'—':'PKR '+Number(value).toLocaleString('en-PK',{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 });

const stamp=(value:string)=>
 new Date(value).toLocaleString('en-PK',{
  timeZone:'UTC'
 })+' UTC';

export default function BranchPaymentCasework({
 locationId
}:{locationId:string}){
 const [cases,setCases]=useState<Case[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [detail,setDetail]=useState<Detail|null>(null);
 const [history,setHistory]=useState<AuditHistory|null>(null);
 const [status,setStatus]=useState('UNDER_REVIEW');
 const [note,setNote]=useState('');
 const [loading,setLoading]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [truncated,setTruncated]=useState(false);

 const loadCases=useCallback(async()=>{
  if(!locationId)return;

  setLoading(true);
  setError('');

  try{
   const rows=await request<Case[]>(
    '/payment-exceptions?'+
    new URLSearchParams({locationId}).toString()
   );

   setCases(rows);
   setTruncated(rows.length===100);
  }catch(e){
   setError(String(e));
  }finally{
   setLoading(false);
  }
 },[locationId]);

 useEffect(()=>{
  setCases([]);
  setSelectedId('');
  setDetail(null);
  setHistory(null);
  setTruncated(false);
  void loadCases();
 },[loadCases]);

 async function selectCase(id:string){
  setSelectedId(id);
  setDetail(null);
  setHistory(null);
  setError('');

  if(!id)return;

  try{
   const [item,events]=await Promise.all([
    request<Detail>(
     '/payment-exceptions/'+encodeURIComponent(id)
    ),
    request<AuditHistory>(
     '/payment-exceptions/'+encodeURIComponent(id)+'/events'
    )
   ]);

   setDetail(item);
   setHistory(events);
  }catch(e){
   setError(String(e));
  }
 }

 async function transition(){
  if(!detail||!note.trim()||saving)return;

  setSaving(true);
  setError('');

  try{
   await request(
    '/payment-exceptions/'+
     encodeURIComponent(detail.id)+'/review',
    'PATCH',
    {status,note:note.trim()}
   );

   setNote('');
   await loadCases();
   await selectCase(detail.id);
  }catch(e){
   setError(String(e));
  }finally{
   setSaving(false);
  }
 }

 const active=cases.filter(c=>
  c.status==='OPEN'||c.status==='UNDER_REVIEW'
 );

 return <section style={panel}>
  <div className="row" style={{justifyContent:'space-between'}}>
   <div>
    <h3 style={{marginBottom:6,color:'#104c72'}}>
     Payment exception casework
    </h3>
    <p className="muted">
     Existing POS payment cases, supporting evidence,
     and manager review history.
    </p>
   </div>
   <button className="secondary"
    disabled={loading}
    onClick={()=>void loadCases()}>
    {loading?'Loading...':'Refresh cases'}
   </button>
  </div>

  {error&&<p role="alert" className="error">{error}</p>}

  <div className="grid" style={{margin:'16px 0'}}>
   <div className="card">
    <span className="muted">Cases returned</span>
    <div className="metric">{cases.length}</div>
   </div>
   <div className="card">
    <span className="muted">Open / under review</span>
    <div className="metric">{active.length}</div>
   </div>
  </div>

  {truncated&&
   <p className="muted">
    Only the 100 most recent cases are returned.
    Older cases may exist.
   </p>
  }

  <div className="tablewrap">
   <table>
    <thead>
     <tr>
      <th>Case</th>
      <th>Status</th>
      <th>Reason</th>
      <th>Expected</th>
      <th>Observed</th>
      <th>Action</th>
     </tr>
    </thead>
    <tbody>
     {cases.map(item=>
      <tr key={item.id}>
       <td title={item.id}>{item.id.slice(0,8)}</td>
       <td>{item.status}</td>
       <td>{item.reason}</td>
       <td>{formatAmount(item.expectedAmount)}</td>
       <td>{formatAmount(item.observedAmount)}</td>
       <td>
        <button className="secondary"
         onClick={()=>void selectCase(item.id)}>
         Review
        </button>
       </td>
      </tr>
     )}
    </tbody>
   </table>
  </div>

  {!cases.length&&!loading&&
   <p className="muted">
    No payment exception cases returned for this branch.
   </p>
  }

  {detail&&<>
   <div style={{marginTop:22}}>
    <h3>Case details</h3>
    <p>
     <strong>Status:</strong> {detail.status}
    </p>
    <p>
     <strong>Reason:</strong> {detail.reason}
    </p>
    <p>
     <strong>Sale:</strong> {detail.saleId||'Not linked'}
    </p>
    <p>
     <strong>Existing review note:</strong>
     {' '}{detail.reviewNote||'None'}
    </p>
   </div>

   <div style={{marginTop:20}}>
    <h4>Evidence</h4>
    {detail.evidences.length===0
     ?<p className="muted">No evidence recorded.</p>
     :<div className="tablewrap">
       <table>
        <thead>
         <tr>
          <th>Kind</th>
          <th>Reference</th>
          <th>Note</th>
          <th>Recorded</th>
         </tr>
        </thead>
        <tbody>
         {detail.evidences.map(e=>
          <tr key={e.id}>
           <td>{e.kind}</td>
           <td>{e.reference}</td>
           <td>{e.note}</td>
           <td>{stamp(e.createdAt)}</td>
          </tr>
         )}
        </tbody>
       </table>
      </div>}
   </div>

   <div style={{marginTop:20}}>
    <h4>Audit history</h4>
    {history?.events.map(event=>
     <p key={event.id} className="muted">
      {stamp(event.createdAt)} — {event.action}
      {' '}({event.actorId.slice(0,8)})
     </p>
    )}
    {history?.truncated&&
     <p className="muted">Audit history is truncated.</p>}
   </div>

   {['OPEN','UNDER_REVIEW'].includes(detail.status)&&
    <div className="card stack" style={{marginTop:20}}>
     <h4>Manager review decision</h4>
     <label>
      Decision
      <select value={status}
       onChange={e=>setStatus(e.target.value)}>
       <option value="UNDER_REVIEW">Under review</option>
       <option value="RESOLVED">Resolved</option>
       <option value="VOIDED">Voided</option>
      </select>
     </label>

     <label>
      Required review note
      <textarea
       maxLength={2000}
       rows={3}
       value={note}
       onChange={e=>setNote(e.target.value)}
      />
     </label>

     <button
      disabled={saving||!note.trim()}
      onClick={()=>void transition()}>
      {saving?'Saving...':'Save review decision'}
     </button>

     <p className="muted">
      Resolving or voiding a case is an administrative
      decision. It does not verify bank settlement,
      correct cash variance, or issue a refund.
     </p>
    </div>}
  </>}
 </section>;
}