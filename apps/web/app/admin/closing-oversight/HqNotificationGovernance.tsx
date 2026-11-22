'use client';

import {useCallback,useEffect,useState} from 'react';

type Item={
 id:string;
 escalationId:string;
 branchCode:string;
 branchName:string;
 priority:string;
 status:string;
 detectedAt:string;
 ageHours:number;
 acknowledgementHours:number|null;
 acknowledgedAt:string|null;
 acknowledgementOverdue:boolean;
 acknowledgedLate:boolean;
};

type Branch={
 locationId:string;
 branchCode:string;
 branchName:string;
 total:number;
 pending:number;
 acknowledged:number;
 closed:number;
 overdueUnacknowledged:number;
};

type Report={
 generatedAt:string;
 periodStart:string;
 periodEnd:string;
 acknowledgementTargetHours:number;
 summary:{
  total:number;
  pending:number;
  acknowledged:number;
  closed:number;
  overdueUnacknowledged:number;
  acknowledgedLate:number;
  averageAcknowledgementHours:number|null;
 };
 branches:Branch[];
 items:Item[];
};

const endpoint=
 '/api/v1/pos/finance/hq-sla-notification-governance';

function csvValue(value:unknown){
 const s=String(value??'');
 return '"'+s.replace(/"/g,'""')+'"';
}

function exportCsv(report:Report){
 const header=[
  'Branch','Escalation','Priority','Status',
  'Detected At','Age Hours','Acknowledged At',
  'Acknowledgement Hours','Overdue Unacknowledged',
  'Acknowledged Late'
 ];

 const rows=[
  header,
  ...report.items.map(i=>[
   i.branchCode,
   i.escalationId,
   i.priority,
   i.status,
   i.detectedAt,
   i.ageHours,
   i.acknowledgedAt||'',
   i.acknowledgementHours??'',
   i.acknowledgementOverdue?'YES':'NO',
   i.acknowledgedLate?'YES':'NO'
  ])
 ];

 const content=rows.map(
  row=>row.map(csvValue).join(',')
 ).join('\r\n');

 const blob=new Blob(['\uFEFF'+content],{
  type:'text/csv;charset=utf-8'
 });

 const url=URL.createObjectURL(blob);
 const anchor=document.createElement('a');
 anchor.href=url;
 anchor.download='royal-step-hq-notification-governance.csv';
 document.body.appendChild(anchor);
 anchor.click();
 anchor.remove();
 URL.revokeObjectURL(url);
}

// R10_3D16_GOVERNANCE_UI
export default function HqNotificationGovernance(){
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');

 const refresh=useCallback(async()=>{
  setLoading(true);
  setError('');

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
      :'Unable to load governance report'
    );
   }

   setReport(data as Report);
  }catch(e){
   setError(
    e instanceof Error?e.message:'Report unavailable'
   );
  }finally{
   setLoading(false);
  }
 },[]);

 useEffect(()=>{
  void refresh();
 },[refresh]);

 const overdue=report?.items.filter(
  i=>i.acknowledgementOverdue
 )||[];

 return (
  <section className="card" style={{marginBottom:20}}>
   <h2>HQ Notification Governance</h2>

   <p>
    Rolling 30-day notification management report.
    The acknowledgement target is 4 hours from
    breach detection.
   </p>

   <div style={{
    display:'flex',
    flexWrap:'wrap',
    gap:12,
    marginBottom:16
   }}>
    <button type="button"
     disabled={loading}
     onClick={()=>void refresh()}>
     {loading?'Loading...':'Refresh governance report'}
    </button>

    <button type="button"
     disabled={!report||loading}
     onClick={()=>report&&exportCsv(report)}>
     Export CSV
    </button>
   </div>

   {error&&(
    <p role="alert" style={{color:'#b91c1c'}}>
     {error}
    </p>
   )}

   {report&&(
    <>
     <p>
      Generated: {new Date(report.generatedAt).toLocaleString()}
     </p>

     <div style={{
      display:'grid',
      gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',
      gap:12,
      margin:'16px 0'
     }}>
      {([
       ['Total',report.summary.total],
       ['Pending',report.summary.pending],
       ['Acknowledged',report.summary.acknowledged],
       ['Closed',report.summary.closed],
       ['Overdue unacknowledged',
        report.summary.overdueUnacknowledged],
       ['Acknowledged late',report.summary.acknowledgedLate],
       ['Avg. acknowledgement hours',
        report.summary.averageAcknowledgementHours??'N/A']
      ] as const).map(([label,value])=>(
       <div key={label} style={{
        border:'1px solid #ddd',
        borderRadius:8,
        padding:12
       }}>
        <div>{label}</div>
        <strong style={{fontSize:22}}>{value}</strong>
       </div>
      ))}
     </div>

     <h3>Branch notification performance</h3>

     <div style={{overflowX:'auto'}}>
      <table style={{width:'100%'}}>
       <thead>
        <tr>
         <th>Branch</th>
         <th>Total</th>
         <th>Pending</th>
         <th>Acknowledged</th>
         <th>Closed</th>
         <th>Overdue</th>
        </tr>
       </thead>
       <tbody>
        {report.branches.map(b=>(
         <tr key={b.locationId}>
          <td>{b.branchName} ({b.branchCode})</td>
          <td>{b.total}</td>
          <td>{b.pending}</td>
          <td>{b.acknowledged}</td>
          <td>{b.closed}</td>
          <td>{b.overdueUnacknowledged}</td>
         </tr>
        ))}
        {report.branches.length===0&&(
         <tr>
          <td colSpan={6}>No breaches in the reporting period.</td>
         </tr>
        )}
       </tbody>
      </table>
     </div>

     <h3 style={{marginTop:24}}>
      Overdue unacknowledged notifications
     </h3>

     <div style={{overflowX:'auto'}}>
      <table style={{width:'100%'}}>
       <thead>
        <tr>
         <th>Branch</th>
         <th>Escalation</th>
         <th>Priority</th>
         <th>Detected</th>
         <th>Age (hours)</th>
        </tr>
       </thead>
       <tbody>
        {overdue.map(i=>(
         <tr key={i.id}>
          <td>{i.branchCode}</td>
          <td title={i.escalationId}>
           {i.escalationId.slice(0,8)}
          </td>
          <td>{i.priority}</td>
          <td>{new Date(i.detectedAt).toLocaleString()}</td>
          <td>{i.ageHours}</td>
         </tr>
        ))}
        {overdue.length===0&&(
         <tr>
          <td colSpan={5}>
           No overdue unacknowledged notifications.
          </td>
         </tr>
        )}
       </tbody>
      </table>
     </div>

     <p style={{marginTop:16}}>
      Metrics use breach detection timestamps and
      recorded acknowledgement audit events.
      Notifications outside the rolling 30-day period
      are excluded.
     </p>
    </>
   )}
  </section>
 );
}