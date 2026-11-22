'use client';

import {useCallback,useEffect,useState} from 'react';

type Action={
 id:string;
 locationId:string;
 escalationId:string|null;
 ownerId:string;
 title:string;
 description:string;
 priority:string;
 status:string;
 dueAt:string;
 evidence:string|null;
 updatedAt:string;
 completedAt:string|null;
};

type Owner={
 id:string;
 name:string;
 email:string;
 roles:string[];
 locationIds:string[];
};

type Branch={
 id:string;
 code:string;
 name:string;
};

const base='/api/v1/pos/finance';

async function request<T>(path:string,body?:unknown):Promise<T>{
 const response=await fetch(base+path,{
  method:body===undefined?'GET':'POST',
  credentials:'same-origin',
  cache:'no-store',
  ...(body===undefined?{}:{
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify(body)
  })
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

// R10_3D19_ACTION_UI
export default function HqCorrectiveActions(){
 const [rows,setRows]=useState<Action[]>([]);
 const [owners,setOwners]=useState<Owner[]>([]);
 const [branches,setBranches]=useState<Branch[]>([]);
 const [locationId,setLocationId]=useState('');
 const [ownerId,setOwnerId]=useState('');
 const [title,setTitle]=useState('');
 const [description,setDescription]=useState('');
 const [priority,setPriority]=useState('HIGH');
 const [dueAt,setDueAt]=useState('');
 const [escalationId,setEscalationId]=useState('');
 const [evidence,setEvidence]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');

 const refresh=useCallback(async()=>{
  try{
   const [actions,eligible,locations]=await Promise.all([
    request<Action[]>('/hq-corrective-actions'),
    request<Owner[]>('/hq-closing-escalation-owners'),
    request<Branch[]>('/hq-corrective-action-branches')
   ]);

   setRows(actions);
   setOwners(eligible);
   setBranches(locations);
  }catch(e){
   setError(e instanceof Error?e.message:'Unable to load actions');
  }
 },[]);

 useEffect(()=>{void refresh();},[refresh]);

 const eligibleOwners=owners.filter(o=>
  o.roles.includes('SUPER_ADMIN')||
  o.locationIds.includes(locationId)
 );

 async function create(){
  setBusy(true);
  setError('');
  setMessage('');

  try{
   if(!dueAt)throw new Error('Deadline required');

   await request('/hq-corrective-actions',{
    locationId,
    ownerId,
    title,
    description,
    priority,
    dueAt:new Date(dueAt).toISOString(),
    ...(escalationId.trim()
     ?{escalationId:escalationId.trim()}
     :{})
   });

   setTitle('');
   setDescription('');
   setEscalationId('');
   setDueAt('');
   setMessage('Corrective action created.');
   await refresh();
  }catch(e){
   setError(e instanceof Error?e.message:'Creation failed');
  }finally{
   setBusy(false);
  }
 }

 async function advance(action:Action){
  const next=action.status==='OPEN'
   ?'IN_PROGRESS':'COMPLETED';

  setBusy(true);
  setError('');
  setMessage('');

  try{
   await request(
    `/hq-corrective-actions/${action.id}/status`,
    {
     status:next,
     expectedUpdatedAt:action.updatedAt,
     ...(next==='COMPLETED'
      ?{evidence:evidence[action.id]||''}
      :{})
    }
   );

   setMessage(`Action moved to ${next}.`);
   await refresh();
  }catch(e){
   setError(e instanceof Error?e.message:'Update failed');
  }finally{
   setBusy(false);
  }
 }

 return (
  <section className="card" style={{marginBottom:20}}>
   <h2>HQ Corrective Action Management</h2>
   <p>
    Assign corrective work to branch managers or HQ
    administrators and track completion evidence.
   </p>

   {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
   {message&&<p role="status">{message}</p>}

   <div style={{
    display:'grid',
    gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',
    gap:12,
    marginBottom:16
   }}>
    <label>
     Branch
     <select value={locationId}
      onChange={e=>{
       setLocationId(e.target.value);
       setOwnerId('');
      }}>
      <option value="">Select branch</option>
      {branches.map(b=>(
       <option key={b.id} value={b.id}>
        {b.name} ({b.code})
       </option>
      ))}
     </select>
    </label>

    <label>
     Owner
     <select value={ownerId}
      onChange={e=>setOwnerId(e.target.value)}>
      <option value="">Select owner</option>
      {eligibleOwners.map(o=>(
       <option key={o.id} value={o.id}>
        {o.name} ({o.email})
       </option>
      ))}
     </select>
    </label>

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
     Deadline
     <input type="datetime-local" value={dueAt}
      onChange={e=>setDueAt(e.target.value)}/>
    </label>

    <label>
     Action title
     <input value={title}
      maxLength={200}
      onChange={e=>setTitle(e.target.value)}/>
    </label>

    <label>
     Related escalation UUID (optional)
     <input value={escalationId}
      onChange={e=>setEscalationId(e.target.value)}/>
    </label>
   </div>

   <label>
    Description
    <textarea value={description}
     maxLength={2000}
     rows={3}
     onChange={e=>setDescription(e.target.value)}
     style={{width:'100%'}}/>
   </label>

   <div style={{margin:'12px 0'}}>
    <button type="button" disabled={busy}
     onClick={()=>void create()}>
     Create corrective action
    </button>
    {' '}
    <button type="button" disabled={busy}
     onClick={()=>void refresh()}>
     Refresh
    </button>
   </div>

   <h3>Assigned actions</h3>

   <div style={{overflowX:'auto'}}>
    <table style={{width:'100%'}}>
     <thead>
      <tr>
       <th>Action</th>
       <th>Owner</th>
       <th>Priority</th>
       <th>Deadline</th>
       <th>Status</th>
       <th>Progress / evidence</th>
      </tr>
     </thead>
     <tbody>
      {rows.map(a=>(
       <tr key={a.id}>
        <td>
         <strong>{a.title}</strong>
         <div>{a.description}</div>
        </td>
        <td>
         {owners.find(o=>o.id===a.ownerId)?.name||a.ownerId}
        </td>
        <td>{a.priority}</td>
        <td>
         {new Date(a.dueAt).toLocaleString()}
         {a.status!=='COMPLETED'&&
          new Date(a.dueAt).getTime()<Date.now()
          ?' — OVERDUE':''}
        </td>
        <td>{a.status}</td>
        <td>
         {a.status==='COMPLETED'
          ?a.evidence||'Completed'
          :(
           <>
            {a.status==='IN_PROGRESS'&&(
             <textarea
              placeholder="Completion evidence (30+ characters)"
              value={evidence[a.id]||''}
              onChange={e=>setEvidence(prev=>({
               ...prev,[a.id]:e.target.value
              }))}
              rows={3}
             />
            )}
            <button type="button" disabled={busy}
             onClick={()=>void advance(a)}>
             {a.status==='OPEN'
              ?'Start work':'Complete'}
            </button>
           </>
          )}
        </td>
       </tr>
      ))}
      {rows.length===0&&(
       <tr>
        <td colSpan={6}>No corrective actions recorded.</td>
       </tr>
      )}
     </tbody>
    </table>
   </div>
  </section>
 );
}