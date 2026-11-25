'use client';

import {useCallback,useEffect,useState} from 'react';

type Action={
 id:string;
 title:string;
 description:string;
 locationId:string;
 priority:string;
 status:string;
 dueAt:string;
 updatedAt:string;
 evidence:string|null;
};

const endpoint='/api/v1/pos/finance/hq-corrective-actions';

async function request<T>(path='',body?:unknown):Promise<T>{
 const response=await fetch(endpoint+path,{
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

// R10_3D20_MANAGER_WORKSPACE
export default function CorrectiveActionsPage(){
 const [rows,setRows]=useState<Action[]>([]);
 const [evidence,setEvidence]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [filter,setFilter]=useState('ALL');

 const load=useCallback(async()=>{
  setLoading(true);
  setError('');

  try{
   setRows(await request<Action[]>());
  }catch(e){
   setError(e instanceof Error?e.message:'Unable to load actions');
  }finally{
   setLoading(false);
  }
 },[]);

 useEffect(()=>{void load();},[load]);

 async function advance(row:Action){
  setBusy(true);
  setError('');
  setMessage('');

  try{
   const status=row.status==='OPEN'
    ?'IN_PROGRESS':'COMPLETED';

   await request(`/${row.id}/status`,{
    status,
    expectedUpdatedAt:row.updatedAt,
    evidence:evidence[row.id]||''
   });

   await load();
   setMessage('Action progress saved.');
  }catch(e){
   setError(e instanceof Error?e.message:'Update failed');
  }finally{
   setBusy(false);
  }
 }

 const outstanding=rows.filter(r=>r.status!=='COMPLETED');

 const overdue=outstanding.filter(
  r=>new Date(r.dueAt).getTime()<Date.now()
 );

 const visible=rows.filter(r=>
  filter==='ALL'||
  (filter==='OVERDUE'
   ?r.status!=='COMPLETED'&&
    new Date(r.dueAt).getTime()<Date.now()
   :r.status===filter)
 );

 return (
  <main style={{padding:24}}>
   <h1>Corrective Action Workspace</h1>
   <p>Review assigned corrective work and record completion evidence.</p>

   <div style={{
    display:'grid',
    gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',
    gap:12,
    margin:'20px 0'
   }}>
    {[
     ['Total actions',rows.length],
     ['Outstanding',outstanding.length],
     ['Overdue',overdue.length],
     ['Completed',rows.length-outstanding.length]
    ].map(([label,value])=>(
     <section className="card" key={label}>
      <div>{label}</div>
      <h2>{value}</h2>
     </section>
    ))}
   </div>

   {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
   {message&&<p role="status">{message}</p>}

   <div style={{display:'flex',gap:12,marginBottom:16}}>
    <select value={filter}
     onChange={e=>setFilter(e.target.value)}>
     <option value="ALL">All actions</option>
     <option value="OPEN">Open</option>
     <option value="IN_PROGRESS">In progress</option>
     <option value="OVERDUE">Overdue</option>
     <option value="COMPLETED">Completed</option>
    </select>

    <button disabled={loading||busy}
     onClick={()=>void load()}>
     Refresh
    </button>
   </div>

   {loading&&<p>Loading corrective actions...</p>}

   {!loading&&!error&&visible.length===0&&(
    <p>No actions match the selected filter.</p>
   )}

   {visible.map(row=>(
    <section className="card" key={row.id}
     style={{marginBottom:16}}>
     <h2>{row.title}</h2>
     <p>{row.description}</p>
     <p>Priority: <strong>{row.priority}</strong></p>
     <p>Status: <strong>{row.status}</strong></p>
     <p>
      Deadline: {new Date(row.dueAt).toLocaleString()}
      {row.status!=='COMPLETED'&&
       new Date(row.dueAt).getTime()<Date.now()&&(
        <strong style={{color:'#b91c1c'}}> — OVERDUE</strong>
       )}
     </p>

     {row.status==='IN_PROGRESS'&&(
      <label>
       Completion evidence
       <textarea
        rows={4}
        maxLength={4000}
        style={{display:'block',width:'100%'}}
        value={evidence[row.id]||''}
        placeholder="Describe work performed and supporting references."
        onChange={e=>setEvidence(prev=>({
         ...prev,[row.id]:e.target.value
        }))}
       />
      </label>
     )}

     {row.status==='COMPLETED'
      ?<p>Evidence: {row.evidence}</p>
      :<button
        disabled={busy||
         (row.status==='IN_PROGRESS'&&
          (evidence[row.id]||'').trim().length<30)}
        onClick={()=>void advance(row)}>
        {row.status==='OPEN'?'Start work':'Submit completion'}
       </button>
     }
    </section>
   ))}
  </main>
 );
}