'use client';

import {useCallback,useEffect,useState} from 'react';

type ClosingReview={
 id:string;
 locationId:string;
 closingDate:string;
 status:string;
 note:string;
 signedById:string;
 signedAt:string;
 snapshot:unknown;
};

type IntegrityResult={
 reviewId:string;
 date:string;
 changed:boolean;
 status:string;
 changedSections:string[];
 currentIssues:string[];
 pendingPaymentCases:number;
 checkedAt:string;
 note:string;
};
type Props={
 locationId:string;
 from:string;
 to:string;
 reportStatus:string;
 issues:string[];
 closedShifts:number;
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

const utcDate=(value:string)=>
 new Date(value).toISOString().slice(0,10);

const timestamp=(value:string)=>
 new Date(value).toLocaleString('en-PK',{
  timeZone:'UTC'
 })+' UTC';

export default function BranchClosingRegister({
 locationId,from,to,reportStatus,issues,closedShifts
}:Props){
 const [rows,setRows]=useState<ClosingReview[]>([]);
 const [date,setDate]=useState(to);
 const [note,setNote]=useState('');
 const [loading,setLoading]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [selected,setSelected]=useState<ClosingReview|null>(null);
 const [integrity,setIntegrity]=useState<IntegrityResult|null>(null);
 const [checking,setChecking]=useState(false);

 const today=new Date().toISOString().slice(0,10);

 const eligiblePreview=
  from===to&&
  date===to&&
  date<today&&
  reportStatus==='NO_DETECTED_EXCEPTIONS'&&
  issues.length===0&&
  closedShifts>0;

 const load=useCallback(async()=>{
  if(!locationId)return;

  setLoading(true);
  setError('');

  try{
   const result=await request<ClosingReview[]>(
    '/pos/finance/closing-reviews?'+
    new URLSearchParams({locationId}).toString()
   );

   setRows(result);
  }catch(e){
   setError(String(e));
  }finally{
   setLoading(false);
  }
 },[locationId]);

 useEffect(()=>{
  setRows([]);
  setSelected(null);
  setMessage('');
  setDate(to);
  void load();
 },[load,to]);

 const alreadyReviewed=rows.some(r=>
  utcDate(r.closingDate)===date
 );

 async function checkIntegrity(row:ClosingReview){
  setChecking(true);
  setError('');
  setIntegrity(null);
  setSelected(row);

  try{
   const query=new URLSearchParams({
    locationId,
    date:utcDate(row.closingDate)
   });

   const result=await request<IntegrityResult>(
    '/pos/finance/closing-reviews/integrity?'+
    query.toString()
   );

   setIntegrity(result);
  }catch(e){
   setError(String(e));
  }finally{
   setChecking(false);
  }
 }
 async function acknowledge(){
  if(!eligiblePreview||alreadyReviewed||!note.trim()||saving){
   return;
  }

  const confirmed=window.confirm(
   'Record a permanent manager review acknowledgement for '+
   date+'? This is not financial clearance.'
  );

  if(!confirmed)return;

  setSaving(true);
  setError('');
  setMessage('');

  try{
   await request(
    '/pos/finance/closing-reviews/acknowledge',
    'POST',
    {
     locationId,
     date,
     note:note.trim()
    }
   );

   setNote('');
   setMessage('Review acknowledgement recorded.');
   await load();
  }catch(e){
   setError(String(e));
  }finally{
   setSaving(false);
  }
 }

 return <section className="card stack">
  <div className="row" style={{justifyContent:'space-between'}}>
   <div>
    <h3 style={{color:'#104c72',marginBottom:6}}>
     Daily closing register
    </h3>
    <p className="muted">
     Immutable manager review acknowledgements.
     Dates are interpreted in UTC.
    </p>
   </div>
   <button className="secondary"
    disabled={loading}
    onClick={()=>void load()}>
    {loading?'Loading...':'Refresh register'}
   </button>
  </div>

  {error&&<p role="alert" className="error">{error}</p>}
  {message&&<p role="status" className="success">{message}</p>}

  <div className="grid">
   <div>
    <label>
     Closing date
     <input
      type="date"
      value={date}
      max={today}
      onChange={e=>setDate(e.target.value)}
     />
    </label>
    <p className="muted">
     Generate reconciliation for a single past UTC date
     before acknowledging that date.
    </p>
   </div>

   <div className="card">
    <strong>Current report</strong>
    <p>{reportStatus.replace(/_/g,' ')}</p>
    <p className="muted">
     Closed shifts: {closedShifts}
    </p>
    <p className="muted">
     Detected issues: {issues.length}
    </p>
   </div>
  </div>

  {alreadyReviewed&&
   <p className="muted">
    This date already has a recorded acknowledgement.
    Duplicate acknowledgements are not permitted.
   </p>
  }

  <label>
   Manager review note
   <textarea
    rows={3}
    maxLength={2000}
    value={note}
    onChange={e=>setNote(e.target.value)}
    placeholder="Describe the reconciliation records reviewed."
   />
  </label>

  <button
   disabled={
    !eligiblePreview||
    alreadyReviewed||
    !note.trim()||
    saving
   }
   onClick={()=>void acknowledge()}>
   {saving?'Recording...':'Acknowledge closing review'}
  </button>

  <p className="muted">
   This button is enabled only when the displayed
   reconciliation covers one completed UTC date,
   contains at least one closed shift, and has no
   detected exceptions. The backend independently
   checks eligibility and unresolved payment cases.
  </p>

  <h4>Previous acknowledgements</h4>

  <div className="tablewrap">
   <table>
    <thead>
     <tr>
      <th>Closing date</th>
      <th>Status</th>
      <th>Reviewer</th>
      <th>Recorded</th>
      <th>Details</th>
     </tr>
    </thead>
    <tbody>
     {rows.map(row=>
      <tr key={row.id}>
       <td>{utcDate(row.closingDate)}</td>
       <td>{row.status}</td>
       <td title={row.signedById}>
        {row.signedById.slice(0,8)}
       </td>
       <td>{timestamp(row.signedAt)}</td>
       <td>
        <button
         className="secondary"
         onClick={()=>{
          setIntegrity(null);
          setSelected(selected?.id===row.id?null:row);
         }}>
         {selected?.id===row.id?'Hide':'View'}
        </button>
        {' '}
        <button
         className="secondary"
         disabled={checking}
         onClick={()=>void checkIntegrity(row)}>
         Check for changes
        </button>
       </td>
      </tr>
     )}
    </tbody>
   </table>
  </div>

  {!rows.length&&!loading&&
   <p className="muted">
    No closing acknowledgements found for this branch.
   </p>
  }

  {rows.length===90&&
   <p className="muted">
    Only the 90 most recent acknowledgements are shown.
   </p>
  }

  {integrity&&selected?.id===integrity.reviewId&&
   <div className="card stack">
    <h4>Historical integrity check</h4>

    <p>
     <strong>Result:</strong>
     {' '}{integrity.status.replace(/_/g,' ')}
    </p>

    <p>
     <strong>Checked:</strong>
     {' '}{timestamp(integrity.checkedAt)}
    </p>

    {integrity.changedSections.length>0&&<>
     <strong>Changed sections</strong>
     <ul>
      {integrity.changedSections.map(section=>
       <li key={section}>{section}</li>
      )}
     </ul>
    </>}

    {integrity.currentIssues.length>0&&<>
     <strong>Current exceptions</strong>
     <ul>
      {integrity.currentIssues.map(issue=>
       <li key={issue}>{issue.replace(/_/g,' ')}</li>
      )}
     </ul>
    </>}

    <p className="muted">{integrity.note}</p>
   </div>
  }
  {selected&&
   <div className="card stack">
    <h4>Recorded review details</h4>
    <p><strong>Date:</strong> {utcDate(selected.closingDate)}</p>
    <p><strong>Status:</strong> {selected.status}</p>
    <p><strong>Note:</strong> {selected.note}</p>
    <p><strong>Reviewer ID:</strong> {selected.signedById}</p>
    <p><strong>Recorded:</strong> {timestamp(selected.signedAt)}</p>
    <details>
     <summary>Stored reconciliation snapshot</summary>
     <pre style={{
      overflowX:'auto',
      whiteSpace:'pre-wrap',
      fontSize:12
     }}>
      {JSON.stringify(selected.snapshot,null,2)}
     </pre>
    </details>
   </div>
  }

  <p className="muted">
   Review acknowledgement is not proof of external
   settlement or final financial clearance.
  </p>
 </section>;
}