'use client';

import {useCallback,useEffect,useState} from 'react';

type Day={
 date:string;
 detected:number;
 acknowledged:number;
 acknowledgedWithin4h:number;
 averageAckHours:number|null;
};

type Branch={
 locationId:string;
 code:string;
 name:string;
 total:number;
 pending:number;
 acknowledged:number;
 closed:number;
 acknowledgedWithin4h:number;
 averageAckHours:number|null;
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
  acknowledgedWithin4h:number;
  acknowledgementRate:number|null;
  averageAckHours:number|null;
 };
 daily:Day[];
 branches:Branch[];
 priorities:{priority:string;count:number}[];
};

const endpoint=
 '/api/v1/pos/finance/hq-sla-notification-analytics';

function exportCsv(report:Report){
 const rows=[
  ['Date','Detected','Acknowledged',
   'Acknowledged Within 4h','Average Ack Hours'],
  ...report.daily.map(d=>[
   d.date,d.detected,d.acknowledged,
   d.acknowledgedWithin4h,d.averageAckHours??''
  ])
 ];

 const csv=rows.map(row=>row.map(value=>
  '"'+String(value).replace(/"/g,'""')+'"'
 ).join(',')).join('\r\n');

 const blob=new Blob(['\uFEFF'+csv],{
  type:'text/csv;charset=utf-8'
 });

 const url=URL.createObjectURL(blob);
 const link=document.createElement('a');
 link.href=url;
 link.download='royal-step-notification-trends-90-days.csv';
 document.body.appendChild(link);
 link.click();
 link.remove();
 URL.revokeObjectURL(url);
}

// R10_3D17_ANALYTICS_UI
export default function HqNotificationAnalytics(){
 const [report,setReport]=useState<Report|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');

 const refresh=useCallback(async()=>{
  setBusy(true);
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
      :'Analytics unavailable'
    );
   }

   setReport(data as Report);
  }catch(e){
   setError(
    e instanceof Error?e.message:'Analytics unavailable'
   );
  }finally{
   setBusy(false);
  }
 },[]);

 useEffect(()=>{void refresh();},[refresh]);

 const maxDetected=Math.max(
  1,...(report?.daily.map(d=>d.detected)||[])
 );

 const totalPriority=Math.max(
  1,report?.summary.total||0
 );

 return (
  <section className="card" style={{marginBottom:20}}>
   <h2>HQ Notification Analytics — 90 Days</h2>

   <p>
    Historical SLA breach detection, acknowledgement
    performance and branch comparison.
   </p>

   <div style={{
    display:'flex',
    gap:12,
    flexWrap:'wrap',
    marginBottom:16
   }}>
    <button disabled={busy}
     onClick={()=>void refresh()}>
     {busy?'Loading...':'Refresh analytics'}
    </button>

    <button disabled={!report||busy}
     onClick={()=>report&&exportCsv(report)}>
     Export daily trends CSV
    </button>
   </div>

   {error&&<p role="alert">{error}</p>}

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
       ['Breaches',report.summary.total],
       ['Pending',report.summary.pending],
       ['Acknowledged',report.summary.acknowledged],
       ['Within 4h',report.summary.acknowledgedWithin4h],
       ['Ack rate',
        report.summary.acknowledgementRate===null
         ?'N/A'
         :report.summary.acknowledgementRate+'%'],
       ['Avg. ack hours',
        report.summary.averageAckHours??'N/A']
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

     <h3>Daily SLA breach detection</h3>
     <p>
      Each bar represents a UTC day. The maximum bar
      width represents the highest daily count.
     </p>

     <div style={{
      display:'grid',
      gridTemplateColumns:'repeat(90,minmax(5px,1fr))',
      gap:2,
      height:110,
      alignItems:'end',
      overflowX:'auto'
     }}>
      {report.daily.map(day=>(
       <div key={day.date}
        title={`${day.date}: ${day.detected} breaches`}
        style={{
         background:'#104c72',
         height:day.detected===0
          ?2
          :Math.max(4,day.detected/maxDetected*100)+'%',
         minWidth:5
        }}
       />
      ))}
     </div>

     <p>
      {report.daily[0]?.date} to{' '}
      {report.daily[report.daily.length-1]?.date}
     </p>

     <h3>Priority distribution</h3>

     {report.priorities.map(p=>(
      <div key={p.priority} style={{marginBottom:12}}>
       <div>{p.priority}: {p.count}</div>
       <div style={{
        height:12,
        background:'#e5e7eb',
        borderRadius:4,
        overflow:'hidden'
       }}>
        <div style={{
         width:(p.count/totalPriority*100)+'%',
         height:'100%',
         background:'#104c72'
        }}/>
       </div>
      </div>
     ))}

     <h3>Branch performance comparison</h3>

     <div style={{overflowX:'auto'}}>
      <table style={{width:'100%'}}>
       <thead>
        <tr>
         <th>Branch</th>
         <th>Breaches</th>
         <th>Pending</th>
         <th>Acknowledged</th>
         <th>Closed</th>
         <th>Within 4h</th>
         <th>Avg. ack hours</th>
        </tr>
       </thead>
       <tbody>
        {report.branches.map(b=>(
         <tr key={b.locationId}>
          <td>{b.name} ({b.code})</td>
          <td>{b.total}</td>
          <td>{b.pending}</td>
          <td>{b.acknowledged}</td>
          <td>{b.closed}</td>
          <td>{b.acknowledgedWithin4h}</td>
          <td>{b.averageAckHours??'N/A'}</td>
         </tr>
        ))}
        {report.branches.length===0&&(
         <tr>
          <td colSpan={7}>
           No breach records in the last 90 days.
          </td>
         </tr>
        )}
       </tbody>
      </table>
     </div>

     <h3>Recent daily acknowledgement trends</h3>

     <div style={{overflowX:'auto'}}>
      <table style={{width:'100%'}}>
       <thead>
        <tr>
         <th>UTC Date</th>
         <th>Detected</th>
         <th>Acknowledged</th>
         <th>Within 4h</th>
         <th>Avg. ack hours</th>
        </tr>
       </thead>
       <tbody>
        {report.daily.slice(-14).reverse().map(d=>(
         <tr key={d.date}>
          <td>{d.date}</td>
          <td>{d.detected}</td>
          <td>{d.acknowledged}</td>
          <td>{d.acknowledgedWithin4h}</td>
          <td>{d.averageAckHours??'N/A'}</td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>

     <p style={{marginTop:16}}>
      Breach counts use detection dates. Acknowledgement
      trends use the actual first acknowledgement date.
      Historical data is derived from persisted records
      and audit events, not saved daily snapshots.
     </p>
    </>
   )}
  </section>
 );
}