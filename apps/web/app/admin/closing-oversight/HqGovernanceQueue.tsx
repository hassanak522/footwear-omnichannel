'use client';

import {useCallback,useEffect,useState} from 'react';

type QueueRow={
 id:string;
 title:string;
 description:string;
 priority:string;
 status:string;
 locationId:string;
 ownerId:string;
 escalationId:string|null;
 dueAt:string;
 overdue:boolean;
 dueSoon:boolean;
 remainingHours:number;
 branch:{
  id:string;
  name:string;
  code:string;
 }|null;
 owner:{
  id:string;
  name:string;
  status:string;
 }|null;
};

type QueueReport={
 generatedAt:string;
 summary:{
  outstanding:number;
  overdue:number;
  dueSoon:number;
  critical:number;
  inProgress:number;
  inactiveOwners:number;
 };
 queue:QueueRow[];
};

function exportQueue(rows:QueueRow[]){
 const values=[
  [
   'Action',
   'Branch',
   'Owner',
   'Priority',
   'Status',
   'Deadline',
   'Overdue',
   'Owner Status'
  ],
  ...rows.map(a=>[
   a.title,
   a.branch?.name||a.locationId,
   a.owner?.name||a.ownerId,
   a.priority,
   a.status,
   a.dueAt,
   a.overdue?'YES':'NO',
   a.owner?.status||'UNKNOWN'
  ])
 ];

 const csv=values.map(row=>row.map(value=>{
  const safe=/^[\s]*[=+\-@]/.test(value)
   ?"'"+value:value;

  return '"'+safe.replace(/"/g,'""')+'"';
 }).join(',')).join('\r\n');

 const url=URL.createObjectURL(
  new Blob(['\uFEFF'+csv],{
   type:'text/csv;charset=utf-8'
  })
 );

 const link=document.createElement('a');

 link.href=url;
 link.download='royal-step-governance-queue.csv';

 document.body.appendChild(link);
 link.click();
 link.remove();

 URL.revokeObjectURL(url);
}

// R10_3D21_GOVERNANCE_UI
export default function HqGovernanceQueue(){
 const [report,setReport]=useState<QueueReport|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [filter,setFilter]=useState('ALL');
 const [priority,setPriority]=useState('ALL');
 const [branch,setBranch]=useState('ALL');
 const [search,setSearch]=useState('');

 const refresh=useCallback(async()=>{
  setLoading(true);
  setError('');

  try{
   const response=await fetch(
    '/api/v1/pos/finance/hq-governance-queue',
    {
     credentials:'same-origin',
     cache:'no-store'
    }
   );

   const data=await response.json().catch(()=>({}));

   if(!response.ok){
    throw new Error(
     Array.isArray(data.message)
      ?data.message.join('; ')
      :data.message||`HTTP ${response.status}`
    );
   }

   setReport(data as QueueReport);
  }catch(e){
   setReport(null);
   setError(e instanceof Error?e.message:'Unable to load queue');
  }finally{
   setLoading(false);
  }
 },[]);

 useEffect(()=>{void refresh();},[refresh]);

 const rows=report?.queue||[];

 const branches=Array.from(
  new Map(rows.map(a=>[
   a.locationId,
   a.branch?.name||a.locationId
  ])).entries()
 );

 const visible=rows.filter(a=>{
  const text=[
   a.title,
   a.description,
   a.branch?.name||'',
   a.branch?.code||'',
   a.owner?.name||''
  ].join(' ').toLowerCase();

  const matchesStatus=
   filter==='ALL'||
   (filter==='OVERDUE'&&a.overdue)||
   (filter==='DUE_SOON'&&a.dueSoon)||
   (filter==='INACTIVE_OWNER'&&
    a.owner?.status!=='ACTIVE')||
   a.status===filter;

  return matchesStatus&&
   (priority==='ALL'||a.priority===priority)&&
   (branch==='ALL'||a.locationId===branch)&&
   text.includes(search.trim().toLowerCase());
 });

 const metrics=report?[
  ['Outstanding',report.summary.outstanding],
  ['Overdue',report.summary.overdue],
  ['Due within 24 hours',report.summary.dueSoon],
  ['Critical',report.summary.critical],
  ['In progress',report.summary.inProgress],
  ['Inactive owners',report.summary.inactiveOwners]
 ]:[];

 return (
  <section className="card" style={{margin:'20px 0'}}>
   <h2>HQ Governance Command Center</h2>

   <p>
    Outstanding corrective work across physical retail branches.
    Overdue work appears first, followed by priority and deadline.
   </p>

   {error&&(
    <p role="alert" style={{color:'#b91c1c'}}>{error}</p>
   )}

   <div style={{
    display:'grid',
    gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',
    gap:12,
    margin:'16px 0'
   }}>
    {metrics.map(([label,value])=>(
     <div key={label} style={{
      padding:14,
      border:'1px solid #ddd',
      borderRadius:8
     }}>
      <div>{label}</div>
      <h2>{value}</h2>
     </div>
    ))}
   </div>

   <div style={{
    display:'flex',
    flexWrap:'wrap',
    gap:12,
    alignItems:'end',
    marginBottom:16
   }}>
    <label>
     Status
     <select value={filter}
      onChange={e=>setFilter(e.target.value)}>
      <option value="ALL">All outstanding</option>
      <option value="OPEN">Open</option>
      <option value="IN_PROGRESS">In progress</option>
      <option value="OVERDUE">Overdue</option>
      <option value="DUE_SOON">Due soon</option>
      <option value="INACTIVE_OWNER">Inactive owner</option>
     </select>
    </label>

    <label>
     Priority
     <select value={priority}
      onChange={e=>setPriority(e.target.value)}>
      <option value="ALL">All priorities</option>
      <option value="CRITICAL">Critical</option>
      <option value="HIGH">High</option>
      <option value="MEDIUM">Medium</option>
     </select>
    </label>

    <label>
     Branch
     <select value={branch}
      onChange={e=>setBranch(e.target.value)}>
      <option value="ALL">All branches</option>
      {branches.map(([id,name])=>(
       <option key={id} value={id}>{name}</option>
      ))}
     </select>
    </label>

    <label>
     Search
     <input value={search}
      placeholder="Action, owner or branch"
      onChange={e=>setSearch(e.target.value)}/>
    </label>

    <button disabled={loading}
     onClick={()=>void refresh()}>
     {loading?'Refreshing...':'Refresh queue'}
    </button>

    <button disabled={!report}
     onClick={()=>exportQueue(visible)}>
     Export CSV
    </button>
   </div>

   {loading&&<p>Loading governance queue...</p>}

   {!loading&&report&&(
    <p>
     Showing {visible.length} of {rows.length}
     {' '}outstanding actions.
    </p>
   )}

   <div style={{overflowX:'auto'}}>
    <table style={{width:'100%'}}>
     <thead>
      <tr>
       <th>Action</th>
       <th>Branch</th>
       <th>Responsible owner</th>
       <th>Priority</th>
       <th>Deadline</th>
       <th>Status</th>
       <th>Management</th>
      </tr>
     </thead>
     <tbody>
      {visible.map(a=>(
       <tr key={a.id}>
        <td>
         <strong>{a.title}</strong>
         <div>
          {a.escalationId
           ?'Escalation-linked'
           :'Independent action'}
         </div>
        </td>

        <td>{a.branch?.name||a.locationId}</td>

        <td>
         {a.owner?.name||a.ownerId}
         {a.owner?.status!=='ACTIVE'&&(
          <div style={{color:'#b91c1c'}}>
           Owner requires review
          </div>
         )}
        </td>

        <td>{a.priority}</td>

        <td>
         {new Date(a.dueAt).toLocaleString()}
         {a.overdue&&(
          <div style={{color:'#b91c1c'}}>
           {Math.abs(a.remainingHours)}h overdue
          </div>
         )}
         {a.dueSoon&&(
          <div>{a.remainingHours}h remaining</div>
         )}
        </td>

        <td>{a.status}</td>

        <td>
         <a href="#action-management">Manage actions</a>
        </td>
       </tr>
      ))}

      {!loading&&report&&visible.length===0&&(
       <tr>
        <td colSpan={7}>No matching outstanding actions.</td>
       </tr>
      )}
     </tbody>
    </table>
   </div>

   {report&&(
    <p style={{fontSize:12}}>
     Generated: {new Date(report.generatedAt).toLocaleString()}
    </p>
   )}
  </section>
 );
}