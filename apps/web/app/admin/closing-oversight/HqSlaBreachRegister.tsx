'use client';

import {useCallback,useEffect,useState} from 'react';

type Notification={
 id:string;
 escalationId:string;
 locationId:string;
 priority:string;
 slaHours:number;
 dueAt:string;
 detectedAt:string;
 status:string;
};

type AuditEntry={
 id:string;
 actorId:string|null;
 action:string;
 after:unknown;
 createdAt:string;
};

type Filter='ALL'|'PENDING'|'ACKNOWLEDGED'|'CLOSED';

const endpoint='/api/v1/pos/finance/hq-closing-sla-breaches';

// R10_3D15_NOTIFICATION_CENTER
export default function HqSlaBreachRegister(){
 const [rows,setRows]=useState<Notification[]>([]);
 const [filter,setFilter]=useState<Filter>('ALL');
 const [selected,setSelected]=useState<Notification|null>(null);
 const [note,setNote]=useState('');
 const [history,setHistory]=useState<AuditEntry[]>([]);
 const [historyId,setHistoryId]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');

 const refresh=useCallback(async()=>{
  try{
   const response=await fetch(endpoint,{
    credentials:'same-origin',
    cache:'no-store'
   });

   const data=await response.json().catch(()=>({}));

   if(!response.ok){
    throw new Error(
     typeof data.message==='string'
      ?data.message
      :'Unable to load notifications'
    );
   }

   if(!Array.isArray(data)){
    throw new Error('Unexpected notification response');
   }

   setRows(data as Notification[]);
  }catch(e){
   setError(
    e instanceof Error?e.message:'Unable to load notifications'
   );
  }
 },[]);

 useEffect(()=>{
  void refresh();
 },[refresh]);

 async function scan(){
  setBusy(true);
  setError('');
  setMessage('');

  try{
   const response=await fetch(endpoint+'/scan',{
    method:'POST',
    credentials:'same-origin'
   });

   const result=await response.json().catch(()=>({}));

   if(!response.ok){
    throw new Error(
     result.message||'SLA scan failed'
    );
   }

   setMessage(
    `${result.newlyRecorded} new SLA breach notification(s) recorded.`
   );

   await refresh();
  }catch(e){
   setError(e instanceof Error?e.message:'Scan failed');
  }finally{
   setBusy(false);
  }
 }

 async function transition(
  row:Notification,
  next:'ACKNOWLEDGED'|'CLOSED'
 ){
  if(note.trim().length<10){
   setError('Enter a management note of at least 10 characters.');
   return;
  }

  setBusy(true);
  setError('');
  setMessage('');

  try{
   const response=await fetch(
    `${endpoint}/${row.id}/transition`,
    {
     method:'POST',
     credentials:'same-origin',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({
      status:next,
      note:note.trim()
     })
    }
   );

   const data=await response.json().catch(()=>({}));

   if(!response.ok){
    throw new Error(
     Array.isArray(data.message)
      ?data.message.join('; ')
      :data.message||'Notification update failed'
    );
   }

   setSelected(null);
   setNote('');
   setMessage(`Notification ${next.toLowerCase()}.`);

   await refresh();

   if(historyId===row.id){
    await viewHistory(row.id);
   }
  }catch(e){
   setError(
    e instanceof Error?e.message:'Unable to update notification'
   );
  }finally{
   setBusy(false);
  }
 }

 async function viewHistory(id:string){
  setError('');

  try{
   const response=await fetch(
    `${endpoint}/${id}/history`,
    {
     credentials:'same-origin',
     cache:'no-store'
    }
   );

   if(!response.ok){
    throw new Error('Unable to load notification history');
   }

   const data=await response.json();

   setHistory(data as AuditEntry[]);
   setHistoryId(id);
  }catch(e){
   setError(e instanceof Error?e.message:'History unavailable');
  }
 }

 const counts={
  PENDING:rows.filter(r=>r.status==='PENDING').length,
  ACKNOWLEDGED:rows.filter(r=>r.status==='ACKNOWLEDGED').length,
  CLOSED:rows.filter(r=>r.status==='CLOSED').length
 };

 const visible=rows.filter(
  row=>filter==='ALL'||row.status===filter
 );

 return (
  <section className="card" style={{marginBottom:20}}>
   <h2>HQ Internal Notification Center</h2>

   <p>
    Persistent SLA breach notifications for HQ financial
    closing oversight. No email, SMS or WhatsApp messages
    are sent.
   </p>

   <div style={{
    display:'flex',
    flexWrap:'wrap',
    gap:12,
    margin:'16px 0'
   }}>
    {([
     ['PENDING',counts.PENDING],
     ['ACKNOWLEDGED',counts.ACKNOWLEDGED],
     ['CLOSED',counts.CLOSED]
    ] as const).map(([status,count])=>(
     <div key={status} style={{
      border:'1px solid #ddd',
      padding:12,
      borderRadius:8,
      minWidth:140
     }}>
      <strong>{status}</strong>
      <div style={{fontSize:24}}>{count}</div>
     </div>
    ))}
   </div>

   <div style={{
    display:'flex',
    gap:12,
    alignItems:'center',
    flexWrap:'wrap',
    marginBottom:16
   }}>
    <label>
     Status
     <select
      value={filter}
      onChange={e=>setFilter(e.target.value as Filter)}
     >
      <option value="ALL">All</option>
      <option value="PENDING">Pending</option>
      <option value="ACKNOWLEDGED">Acknowledged</option>
      <option value="CLOSED">Closed</option>
     </select>
    </label>

    <button type="button"
     onClick={()=>void refresh()}
     disabled={busy}>
     Refresh
    </button>

    <button type="button"
     onClick={()=>void scan()}
     disabled={busy}>
     {busy?'Working...':'Scan SLA breaches'}
    </button>
   </div>

   {error&&(
    <p role="alert" style={{color:'#b91c1c'}}>
     {error}
    </p>
   )}

   {message&&<p role="status">{message}</p>}

   <div style={{overflowX:'auto'}}>
    <table style={{width:'100%'}}>
     <thead>
      <tr>
       <th>Escalation</th>
       <th>Priority</th>
       <th>SLA</th>
       <th>Deadline</th>
       <th>Detected</th>
       <th>Status</th>
       <th>Actions</th>
      </tr>
     </thead>
     <tbody>
      {visible.map(row=>(
       <tr key={row.id}>
        <td title={row.escalationId}>
         {row.escalationId.slice(0,8)}
        </td>
        <td>{row.priority}</td>
        <td>{row.slaHours}h</td>
        <td>{new Date(row.dueAt).toLocaleString()}</td>
        <td>{new Date(row.detectedAt).toLocaleString()}</td>
        <td><strong>{row.status}</strong></td>
        <td>
         {row.status!=='CLOSED'&&(
          <button type="button"
           onClick={()=>{
            setSelected(row);
            setNote('');
            setError('');
           }}>
           {row.status==='PENDING'
            ?'Acknowledge'
            :'Close'}
          </button>
         )}
         {' '}
         <button type="button"
          onClick={()=>void viewHistory(row.id)}>
          History
         </button>
        </td>
       </tr>
      ))}

      {visible.length===0&&(
       <tr>
        <td colSpan={7}>
         No notifications match this filter.
        </td>
       </tr>
      )}
     </tbody>
    </table>
   </div>

   {selected&&(
    <div style={{
     border:'1px solid #ddd',
     borderRadius:8,
     padding:16,
     marginTop:20
    }}>
     <h3>
      {selected.status==='PENDING'
       ?'Acknowledge notification'
       :'Close notification'}
     </h3>

     <p>
      Escalation: {selected.escalationId}
     </p>

     {selected.status==='ACKNOWLEDGED'&&(
      <p>
       The associated escalation must be resolved
       before this notification can be closed.
      </p>
     )}

     <label>
      Management note
      <textarea
       rows={4}
       maxLength={2000}
       value={note}
       onChange={e=>setNote(e.target.value)}
       placeholder="Record the review or closure reason"
      />
     </label>

     <div style={{
      display:'flex',
      gap:12,
      marginTop:12
     }}>
      <button
       type="button"
       disabled={busy||note.trim().length<10}
       onClick={()=>void transition(
        selected,
        selected.status==='PENDING'
         ?'ACKNOWLEDGED'
         :'CLOSED'
       )}>
       Confirm
      </button>

      <button type="button"
       disabled={busy}
       onClick={()=>setSelected(null)}>
       Cancel
      </button>
     </div>
    </div>
   )}

   {historyId&&(
    <section style={{marginTop:24}}>
     <h3>Notification history</h3>
     <p>Notification ID: {historyId}</p>

     {history.length===0&&(
      <p>No recorded notification transitions.</p>
     )}

     {history.map(entry=>(
      <details key={entry.id}
       style={{marginBottom:12}}>
       <summary>
        {entry.action} —{' '}
        {new Date(entry.createdAt).toLocaleString()}
       </summary>

       <p>Actor: {entry.actorId||'Unknown'}</p>

       <pre style={{whiteSpace:'pre-wrap'}}>
        {JSON.stringify(entry.after,null,2)}
       </pre>
      </details>
     ))}
    </section>
   )}

   <p style={{marginTop:20}}>
    Notification acknowledgement and closure do not
    modify the associated escalation or drift incident.
    This view displays the latest 200 breach records.
   </p>
  </section>
 );
}