'use client';

import {useCallback,useEffect,useState} from 'react';

type Breach={
 id:string;
 escalationId:string;
 locationId:string;
 priority:string;
 slaHours:number;
 dueAt:string;
 detectedAt:string;
 status:string;
};

const endpoint='/api/v1/pos/finance/hq-closing-sla-breaches';

export default function HqSlaBreachRegister(){
 const [rows,setRows]=useState<Breach[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');

 const refresh=useCallback(async()=>{
  try{
   const response=await fetch(endpoint,{
    credentials:'same-origin',
    cache:'no-store'
   });

   if(!response.ok){
    throw new Error('Unable to load SLA breach register');
   }

   setRows(await response.json() as Breach[]);
  }catch(e){
   setError(e instanceof Error?e.message:'Unable to load breaches');
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

   const result=await response.json();

   if(!response.ok){
    throw new Error(result.message||'SLA scan failed');
   }

   setMessage(
    `Scan completed. ${result.newlyRecorded} new breach(es) recorded.`
   );

   await refresh();
  }catch(e){
   setError(e instanceof Error?e.message:'SLA scan failed');
  }finally{
   setBusy(false);
  }
 }

 return (
  <section className="card" style={{marginBottom:20}}>
   <h2>Persistent SLA Breach Register</h2>

   <p>
    This register records the first detected SLA breach
    for each escalation. Notifications remain pending;
    no external messages are sent.
   </p>

   <button onClick={()=>void scan()} disabled={busy}>
    {busy?'Scanning...':'Scan for SLA breaches'}
   </button>

   {error&&<p role="alert">{error}</p>}
   {message&&<p role="status">{message}</p>}

   <div style={{overflowX:'auto',marginTop:16}}>
    <table style={{width:'100%'}}>
     <thead>
      <tr>
       <th>Escalation</th>
       <th>Priority</th>
       <th>SLA</th>
       <th>Deadline</th>
       <th>Detected</th>
       <th>Notification</th>
      </tr>
     </thead>
     <tbody>
      {rows.map(row=>(
       <tr key={row.id}>
        <td title={row.escalationId}>
         {row.escalationId.slice(0,8)}
        </td>
        <td>{row.priority}</td>
        <td>{row.slaHours}h</td>
        <td>{new Date(row.dueAt).toLocaleString()}</td>
        <td>{new Date(row.detectedAt).toLocaleString()}</td>
        <td>{row.status}</td>
       </tr>
      ))}
      {rows.length===0&&(
       <tr>
        <td colSpan={6}>No recorded SLA breaches.</td>
       </tr>
      )}
     </tbody>
    </table>
   </div>
  </section>
 );
}