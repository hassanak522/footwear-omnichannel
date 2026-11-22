'use client';

import {useCallback,useEffect,useState} from 'react';

type Branch={
 locationId:string;
 code:string;
 name:string;
};

type Escalation={
 id:string;
 locationId:string;
 closingDate:string;
 ownerId:string;
 priority:string;
 status:string;
 note:string;
 updatedAt:string;
 resolvedAt:string|null;
};

// R10_3D10C_STAFF_SELECTOR
type EligibleOwner={
 id:string;
 name:string;
 email:string;
 roles:string[];
 locationIds:string[];
};
// R10_3D11_UI
type AuditEntry={
 id:string;
 actorId:string|null;
 action:string;
 before:unknown;
 after:unknown;
 createdAt:string;
};
type Props={
 branches:Branch[];
 dates:string[];
};

const endpoint='/api/v1/pos/finance/hq-closing-escalations';

async function request<T>(
 method:'GET'|'POST',
 body?:unknown
):Promise<T>{
 const response=await fetch(endpoint,{
  method,
  credentials:'same-origin',
  cache:'no-store',
  headers:{'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });

 const data=await response.json().catch(()=>({}));

 if(!response.ok){
  throw new Error(
   Array.isArray(data.message)
    ?data.message.join('; ')
    :data.message||`HTTP ${response.status}`
  );
 }

 return data as T;
}

export default function HqEscalationAssignments({
 branches,dates
}:Props){
 const [rows,setRows]=useState<Escalation[]>([]);
 const [locationId,setLocationId]=useState('');
 const [date,setDate]=useState('');
 const [ownerId,setOwnerId]=useState('');
 const [owners,setOwners]=useState<EligibleOwner[]>([]);
 const [ownersError,setOwnersError]=useState('');
 const [priority,setPriority]=useState('HIGH');
 const [status,setStatus]=useState('OPEN');
 const [note,setNote]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [editingVersion,setEditingVersion]=useState('');
 const [history,setHistory]=useState<AuditEntry[]>([]);
 const [historyId,setHistoryId]=useState('');

 const loadOwners=useCallback(async()=>{
  try{
   const response=await fetch(
    '/api/v1/pos/finance/hq-closing-escalation-owners',
    {credentials:'same-origin',cache:'no-store'}
   );

   if(!response.ok){
    throw new Error('Unable to load eligible staff');
   }

   const data=await response.json();
   setOwners(data as EligibleOwner[]);
   setOwnersError('');
  }catch(e){
   setOwnersError(
    e instanceof Error?e.message:'Staff directory unavailable'
   );
  }
 },[]);
 const load=useCallback(async()=>{
  setError('');
  try{
   setRows(await request<Escalation[]>('GET'));
  }catch(e){
   setError(e instanceof Error?e.message:'Unable to load records');
  }
 },[]);

 useEffect(()=>{
  void load();
  void loadOwners();
 },[load,loadOwners]);

 async function viewHistory(id:string){
  setError('');
  try{
   const response=await fetch(
    endpoint+'/'+id+'/history',
    {credentials:'same-origin',cache:'no-store'}
   );

   if(!response.ok){
    throw new Error('Unable to load escalation history');
   }

   setHistory(await response.json() as AuditEntry[]);
   setHistoryId(id);
  }catch(e){
   setError(e instanceof Error?e.message:'History unavailable');
  }
 }
 function edit(row:Escalation){
  setLocationId(row.locationId);
  setDate(row.closingDate.slice(0,10));
  setOwnerId(row.ownerId);
  setPriority(row.priority);
  setStatus(row.status);
  setNote(row.note);
  setEditingVersion(row.updatedAt);
  setMessage('');
 }

 async function save(event:React.FormEvent){
  event.preventDefault();
  setBusy(true);
  setError('');
  setMessage('');

  try{
   await request('POST',{
    locationId,
    date,
    ownerId:ownerId.trim(),
    priority,
    status,
    note:note.trim(),
    ...(editingVersion?{expectedUpdatedAt:editingVersion}:{})
   });

   await load();
   setEditingVersion('');
   setMessage('Escalation record saved.');
  }catch(e){
   setError(e instanceof Error?e.message:'Unable to save');
  }finally{
   setBusy(false);
  }
 }

 return (
  <section className="card" style={{marginBottom:20}}>
   <h2>HQ Escalation Assignments</h2>

   <p>
    Assign an active HQ administrator or branch manager
    using their user UUID. Ownership changes are saved
    against a specific branch and closing date.
   </p>

   <form onSubmit={save} className="stack">
    <label>
     Branch
     <select
      required
      value={locationId}
      onChange={e=>setLocationId(e.target.value)}
     >
      <option value="">Select branch</option>
      {branches.map(branch=>(
       <option key={branch.locationId}
        value={branch.locationId}>
        {branch.name} ({branch.code})
       </option>
      ))}
     </select>
    </label>

    <label>
     Closing date (UTC)
     <input
      type="date"
      required
      value={date}
      onChange={e=>setDate(e.target.value)}
     />
    </label>

    <label>
     Assigned owner
     <select
      required
      value={ownerId}
      onChange={e=>setOwnerId(e.target.value)}
     >
      <option value="">Select eligible staff member</option>
      {owners
       .filter(owner=>
        owner.roles.includes('SUPER_ADMIN')||
        (owner.roles.includes('BRANCH_MANAGER')&&
         owner.locationIds.includes(locationId))
       )
       .map(owner=>(
        <option key={owner.id} value={owner.id}>
         {owner.name} ({owner.email})
        </option>
       ))}
     </select>
    </label>

    {ownersError&&(
     <p role="alert">{ownersError}</p>
    )}

    <label>
     Priority
     <select value={priority}
      onChange={e=>setPriority(e.target.value)}>
      <option value="CRITICAL">Critical</option>
      <option value="HIGH">High</option>
      <option value="MEDIUM">Medium</option>
     </select>
    </label>

    <label>
     Status
     <select value={status}
      onChange={e=>setStatus(e.target.value)}>
      <option value="OPEN">Open</option>
      <option value="IN_PROGRESS">In progress</option>
      <option value="RESOLVED">Resolved</option>
     </select>
    </label>

    <label>
     Management note
     <textarea
      required
      minLength={10}
      maxLength={2000}
      rows={4}
      value={note}
      onChange={e=>setNote(e.target.value)}
     />
    </label>

    <button disabled={busy}>
     {busy?'Saving...':'Save escalation'}
    </button>
   </form>

   {error&&<p role="alert" className="error">{error}</p>}
   {message&&<p role="status">{message}</p>}

   <div style={{marginTop:24}}>
    <div className="row">
     <h3>Saved escalations</h3>
     <button type="button"
      onClick={()=>void load()}
      disabled={busy}>
      Refresh records
     </button>
    </div>

    <div style={{overflowX:'auto'}}>
     <table style={{width:'100%'}}>
      <thead>
       <tr>
        <th>Branch</th>
        <th>Date</th>
        <th>Owner</th>
        <th>Priority</th>
        <th>Status</th>
        <th>Updated</th>
        <th>Action</th>
       </tr>
      </thead>
      <tbody>
       {rows.map(row=>{
        const branch=branches.find(
         b=>b.locationId===row.locationId
        );

        return (
         <tr key={row.id}>
          <td>{branch?.name||row.locationId}</td>
          <td>{row.closingDate.slice(0,10)}</td>
          <td title={row.ownerId}>
           {row.ownerId.slice(0,8)}...
          </td>
          <td>{row.priority}</td>
          <td>{row.status}</td>
          <td>
           {new Date(row.updatedAt).toLocaleString()}
          </td>
          <td>
           <button type="button"
            onClick={()=>edit(row)}>
            Edit
           </button>
           {' '}
           <button type="button"
            onClick={()=>void viewHistory(row.id)}>
            History
           </button>
          </td>
         </tr>
        );
       })}
       {rows.length===0&&(
        <tr>
         <td colSpan={7}>No saved escalations.</td>
        </tr>
       )}
      </tbody>
     </table>
    </div>
   </div>

   {historyId&&(
    <section style={{marginTop:24}}>
     <h3>Escalation audit history</h3>
     <p>Record ID: {historyId}</p>

     {history.length===0&&(
      <p>No audit entries recorded.</p>
     )}

     {history.map(entry=>(
      <details key={entry.id}
       style={{marginBottom:12}}>
       <summary>
        {entry.action} — {new Date(
         entry.createdAt
        ).toLocaleString()}
       </summary>
       <p>Actor ID: {entry.actorId||'Unknown'}</p>
       <strong>Previous values</strong>
       <pre style={{whiteSpace:'pre-wrap'}}>
        {JSON.stringify(entry.before,null,2)}
       </pre>
       <strong>New values</strong>
       <pre style={{whiteSpace:'pre-wrap'}}>
        {JSON.stringify(entry.after,null,2)}
       </pre>
      </details>
     ))}
    </section>
   )}
   <p>
    Resolving an HQ escalation does not resolve its
    underlying drift incident. Updates overwrite the
    current escalation record; immutable history is not
    yet available.
   </p>
  </section>
 );
}