'use client';

import {useEffect,useState} from 'react';

type Incident={
 id:string;
 closingDate:string;
 status:string;
 changedSections:string[];
 currentIssues:string[];
 ownerId:string|null;
 resolutionNote:string|null;
 detectedAt:string;
 lastDetectedAt:string;
 resolvedAt:string|null;
};

async function api<T>(path:string,body?:unknown):Promise<T>{
 const response=await fetch('/api/v1'+path,{
  method:body===undefined?'GET':'POST',
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

export default function BranchClosingIncidents({
 locationId
}:{locationId:string}){
 const [rows,setRows]=useState<Incident[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [notes,setNotes]=useState<Record<string,string>>({});

 async function load(){
  const query=new URLSearchParams({locationId});
  const result=await api<Incident[]>(
   '/pos/finance/closing-incidents?'+query.toString()
  );
  setRows(result);
 }

 useEffect(()=>{
  setRows([]);
  setError('');
  setMessage('');
  if(!locationId)return;

  let active=true;
  const query=new URLSearchParams({locationId});

  void api<Incident[]>(
   '/pos/finance/closing-incidents?'+query.toString()
  ).then(result=>{
   if(active)setRows(result);
  }).catch(e=>{
   if(active)setError(String(e));
  });

  return ()=>{active=false;};
 },[locationId]);

 async function scan(){
  setBusy(true);
  setError('');
  setMessage('');

  try{
   const result=await api<{
    created:number;
    updated:number;
    failed:number;
   }>('/pos/finance/closing-incidents/scan',{locationId});

   setMessage(
    `Created ${result.created}, updated ${result.updated}; `+
    `${result.failed} checks failed.`
   );

   await load();
  }catch(e){
   setError(String(e));
  }finally{
   setBusy(false);
  }
 }

 async function transition(id:string,status:string){
  const note=(notes[id]||'').trim();

  if(!note){
   setError('Enter an investigation or resolution note.');
   return;
  }

  setBusy(true);
  setError('');
  setMessage('');

  try{
   await api(
    '/pos/finance/closing-incidents/'+id+'/transition',
    {status,note}
   );
   setNotes(prev=>({...prev,[id]:''}));
   setMessage('Incident updated and audit entry recorded.');
   await load();
  }catch(e){
   setError(String(e));
  }finally{
   setBusy(false);
  }
 }

 return <section className="card stack">
  <div className="row" style={{
   justifyContent:'space-between',
   alignItems:'center'
  }}>
   <div>
    <h3>Closing drift incident register</h3>
    <p className="muted">
     Persistent investigation and resolution records.
    </p>
   </div>
   <button disabled={busy} onClick={()=>void scan()}>
    {busy?'Working...':'Scan and record incidents'}
   </button>
  </div>

  {error&&<p role="alert" className="error">{error}</p>}
  {message&&<p role="status">{message}</p>}

  <div className="tablewrap">
   <table>
    <thead>
     <tr>
      <th>Date (UTC)</th>
      <th>Status</th>
      <th>Changed sections</th>
      <th>Current issues at detection</th>
      <th>Investigation</th>
     </tr>
    </thead>
    <tbody>
     {rows.map(row=>
      <tr key={row.id}>
       <td>
        {row.closingDate.slice(0,10)}
       </td>
       <td>
        <strong>{row.status}</strong>
        {row.ownerId&&
         <p className="muted">
          Owner: {row.ownerId.slice(0,8)}
         </p>}
       </td>
       <td>{row.changedSections.join(', ')||'—'}</td>
       <td>{row.currentIssues.join(', ')||'None detected'}</td>
       <td>
        <div className="stack">
         {row.resolutionNote&&
          <p className="muted">
           Latest note: {row.resolutionNote}
          </p>}
         <textarea
          rows={2}
          maxLength={2000}
          placeholder="Required review note"
          value={notes[row.id]||''}
          onChange={e=>setNotes(prev=>({
           ...prev,
           [row.id]:e.target.value
          }))}
         />
         {row.status==='OPEN'&&
          <button disabled={busy}
           onClick={()=>void transition(
            row.id,'INVESTIGATING'
           )}>
           Start investigation
          </button>}
         {row.status==='INVESTIGATING'&&
          <button disabled={busy}
           onClick={()=>void transition(
            row.id,'RESOLVED'
           )}>
           Record resolution
          </button>}
         {row.status==='RESOLVED'&&
          <button disabled={busy}
           onClick={()=>void transition(
            row.id,'REOPENED'
           )}>
           Reopen incident
          </button>}
        </div>
       </td>
      </tr>
     )}
    </tbody>
   </table>
  </div>

  {!rows.length&&
   <p className="muted">
    No persistent closing drift incidents recorded.
   </p>
  }

  <p className="muted">
   Resolving an incident records an investigation decision.
   It does not alter the original closing acknowledgement,
   reverse financial entries, or certify reconciliation.
   The register shows up to 100 recent incidents.
  </p>
 </section>;
}