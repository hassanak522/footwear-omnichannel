'use client';

import {useCallback,useEffect,useState} from 'react';

type Action={
 id:string;
 title:string;
 ownerId:string;
 locationId:string;
 priority:string;
 status:string;
 dueAt:string;
 updatedAt:string;
 escalationId:string|null;
};

type Owner={
 id:string;
 name:string;
 roles:string[];
 locationIds:string[];
};

type Branch={
 id:string;
 name:string;
 code:string;
};

type Escalation={
 id:string;
 locationId:string;
 closingDate:string;
 status:string;
 priority:string;
 totalActions:number;
 outstandingActions:number;
 completedActions:number;
 overdueActions:number;
 actions:Action[];
};

type Audit={
 id:string;
 actorId:string|null;
 action:string;
 before:unknown;
 after:unknown;
 createdAt:string;
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

// R10_3D20_HQ_INTEGRATION_UI
export default function HqActionIntegration(){
 const [rows,setRows]=useState<Action[]>([]);
 const [escalations,setEscalations]=useState<Escalation[]>([]);
 const [owners,setOwners]=useState<Owner[]>([]);
 const [branches,setBranches]=useState<Branch[]>([]);
 const [selected,setSelected]=useState<Action|null>(null);
 const [ownerId,setOwnerId]=useState('');
 const [priority,setPriority]=useState('HIGH');
 const [dueAt,setDueAt]=useState('');
 const [reason,setReason]=useState('');
 const [history,setHistory]=useState<Audit[]>([]);
 const [historyId,setHistoryId]=useState('');
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);

 const load=useCallback(async()=>{
  try{
   const [actions,summary,staff,locations]=await Promise.all([
    request<Action[]>('/hq-corrective-actions'),
    request<Escalation[]>('/hq-escalation-action-summary'),
    request<Owner[]>('/hq-closing-escalation-owners'),
    request<Branch[]>('/hq-corrective-action-branches')
   ]);

   setRows(actions);
   setEscalations(summary);
   setOwners(staff);
   setBranches(locations);
  }catch(e){
   setError(e instanceof Error?e.message:'Unable to load integration');
  }
 },[]);

 useEffect(()=>{void load();},[load]);

 function edit(action:Action){
  setSelected(action);
  setOwnerId(action.ownerId);
  setPriority(action.priority);
  const date=new Date(action.dueAt);
  const local=new Date(
   date.getTime()-date.getTimezoneOffset()*60000
  );
  setDueAt(local.toISOString().slice(0,16));
  setReason('');
 }

 async function save(){
  if(!selected)return;

  setBusy(true);
  setError('');
  setMessage('');

  try{
   if(!dueAt)throw new Error('Deadline required');

   await request(
    `/hq-corrective-actions/${selected.id}/revise`,
    {
     ownerId,
     priority,
     dueAt:new Date(dueAt).toISOString(),
     reason,
     expectedUpdatedAt:selected.updatedAt
    }
   );

   setSelected(null);
   setMessage('Corrective action revised.');
   await load();
  }catch(e){
   setError(e instanceof Error?e.message:'Revision failed');
  }finally{
   setBusy(false);
  }
 }

 async function showHistory(id:string){
  setError('');

  try{
   setHistory(await request<Audit[]>(
    `/hq-corrective-actions/${id}/history`
   ));
   setHistoryId(id);
  }catch(e){
   setError(e instanceof Error?e.message:'Unable to load history');
  }
 }

 const branchName=(id:string)=>
  branches.find(b=>b.id===id)?.name||id;

 const ownerName=(id:string)=>
  owners.find(o=>o.id===id)?.name||id;

 return (
  <section className="card" style={{marginBottom:20}}>
   <h2>Escalation and Corrective Action Integration</h2>

   {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
   {message&&<p role="status">{message}</p>}

   <button onClick={()=>void load()}>Refresh integration</button>

   <h3>Escalation-linked work</h3>

   <div style={{overflowX:'auto'}}>
    <table style={{width:'100%'}}>
     <thead>
      <tr>
       <th>Branch / date</th>
       <th>Escalation</th>
       <th>Actions</th>
       <th>Outstanding</th>
       <th>Overdue</th>
       <th>Action gate</th>
      </tr>
     </thead>
     <tbody>
      {escalations.map(e=>(
       <tr key={e.id}>
        <td>
         {branchName(e.locationId)}
         <div>{e.closingDate.slice(0,10)}</div>
        </td>
        <td>{e.status} / {e.priority}</td>
        <td>{e.totalActions}</td>
        <td>{e.outstandingActions}</td>
        <td>{e.overdueActions}</td>
        <td>
         {e.outstandingActions>0
          ?'Resolution blocked'
          :'No outstanding actions'}
        </td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>

   <h3>Action management</h3>

   <div style={{overflowX:'auto'}}>
    <table style={{width:'100%'}}>
     <thead>
      <tr>
       <th>Action</th>
       <th>Branch</th>
       <th>Owner</th>
       <th>Deadline</th>
       <th>Status</th>
       <th>Manage</th>
      </tr>
     </thead>
     <tbody>
      {rows.map(a=>(
       <tr key={a.id}>
        <td>
         {a.title}
         <div>
          {a.escalationId?'Linked escalation':'Independent action'}
         </div>
        </td>
        <td>{branchName(a.locationId)}</td>
        <td>{ownerName(a.ownerId)}</td>
        <td>{new Date(a.dueAt).toLocaleString()}</td>
        <td>{a.status}</td>
        <td>
         {a.status!=='COMPLETED'&&(
          <button onClick={()=>edit(a)}>Revise</button>
         )}
         {' '}
         <button onClick={()=>void showHistory(a.id)}>
          History
         </button>
        </td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>

   {selected&&(
    <section style={{
     padding:16,
     border:'1px solid #aaa',
     marginTop:16
    }}>
     <h3>Revise: {selected.title}</h3>

     <div style={{
      display:'grid',
      gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',
      gap:12
     }}>
      <label>
       Owner
       <select value={ownerId}
        onChange={e=>setOwnerId(e.target.value)}>
        {owners.filter(o=>
         o.roles.includes('SUPER_ADMIN')||
         (
          o.roles.includes('BRANCH_MANAGER')&&
          o.locationIds.includes(selected.locationId)
         )
        ).map(o=>(
         <option key={o.id} value={o.id}>{o.name}</option>
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
       Revised deadline
       <input type="datetime-local"
        value={dueAt}
        onChange={e=>setDueAt(e.target.value)}/>
      </label>
     </div>

     <label>
      Reason for revision
      <textarea
       rows={3}
       maxLength={2000}
       style={{display:'block',width:'100%'}}
       value={reason}
       onChange={e=>setReason(e.target.value)}
      />
     </label>

     <button disabled={busy||reason.trim().length<10}
      onClick={()=>void save()}>
      Save revision
     </button>
     {' '}
     <button onClick={()=>setSelected(null)}>Cancel</button>
    </section>
   )}

   {historyId&&(
    <section style={{marginTop:20}}>
     <h3>Corrective action audit history</h3>

     <button onClick={()=>setHistoryId('')}>Close history</button>

     {history.length===0&&<p>No audit entries found.</p>}

     {history.map(entry=>(
      <article key={entry.id}
       style={{padding:'12px 0',borderBottom:'1px solid #ddd'}}>
       <strong>{entry.action}</strong>
       <p>{new Date(entry.createdAt).toLocaleString()}</p>
       <p>Actor: {ownerName(entry.actorId||'System')}</p>
       <details>
        <summary>Change details</summary>
        <pre style={{whiteSpace:'pre-wrap'}}>
         {JSON.stringify({
          before:entry.before,
          after:entry.after
         },null,2)}
        </pre>
       </details>
      </article>
     ))}
    </section>
   )}
  </section>
 );
}