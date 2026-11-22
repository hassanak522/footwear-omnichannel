'use client';

import {useCallback,useEffect,useState} from 'react';

type Branch={
 locationId:string;
 code:string;
 name:string;
 total:number;
 critical:number;
 high:number;
 medium:number;
 pending:number;
 overdueUnacknowledged:number;
 lateAcknowledgements:number;
 unresolvedEscalations:number;
 riskScore:number;
 latestBreachAt:string|null;
 recurring:boolean;
 attentionLevel:string;
};

type Report={
 generatedAt:string;
 periodStart:string;
 periodEnd:string;
 scoringPolicy:{
  critical:number;
  high:number;
  medium:number;
  overdueUnacknowledgedBonus:number;
  lateAcknowledgementBonus:number;
  acknowledgementTargetHours:number;
  recurringThreshold:number;
 };
 summary:{
  branchesWithBreaches:number;
  totalBreaches:number;
  totalRiskScore:number;
  recurringBranches:number;
  criticalAttentionBranches:number;
  overdueUnacknowledged:number;
 };
 branches:Branch[];
};

const endpoint='/api/v1/pos/finance/hq-notification-intelligence';

function exportCsv(report:Report){
 const rows=[
  [
   'Branch Code','Branch Name','Risk Score',
   'Attention Level','Total Breaches','Critical',
   'High','Medium','Pending','Overdue Unacknowledged',
   'Late Acknowledgements','Unresolved Escalations',
   'Recurring','Latest Breach'
  ],
  ...report.branches.map(b=>[
   b.code,b.name,b.riskScore,b.attentionLevel,
   b.total,b.critical,b.high,b.medium,
   b.pending,b.overdueUnacknowledged,
   b.lateAcknowledgements,b.unresolvedEscalations,
   b.recurring?'YES':'NO',b.latestBreachAt||''
  ])
 ];

 const csv=rows.map(row=>
  row.map(value=>
   '"'+String(value).replace(/"/g,'""')+'"'
  ).join(',')
 ).join('\r\n');

 const blob=new Blob(['\uFEFF'+csv],{
  type:'text/csv;charset=utf-8'
 });

 const url=URL.createObjectURL(blob);
 const link=document.createElement('a');
 link.href=url;
 link.download='royal-step-executive-notification-intelligence.csv';
 document.body.appendChild(link);
 link.click();
 link.remove();
 URL.revokeObjectURL(url);
}

// R10_3D18_INTELLIGENCE_UI
export default function HqNotificationIntelligence(){
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
      :'Unable to load executive intelligence'
    );
   }

   setReport(data as Report);
  }catch(e){
   setError(
    e instanceof Error?e.message:'Executive report unavailable'
   );
  }finally{
   setBusy(false);
  }
 },[]);

 useEffect(()=>{void refresh();},[refresh]);

 const maxScore=Math.max(
  1,...(report?.branches.map(b=>b.riskScore)||[])
 );

 return (
  <section className="card" style={{marginBottom:20}}>
   <h2>HQ Executive Notification Intelligence</h2>

   <p>
    Priority-weighted management attention ranking
    based on SLA breaches detected over the last 90 days.
   </p>

   <div style={{
    display:'flex',gap:12,flexWrap:'wrap',
    marginBottom:16
   }}>
    <button type="button"
     disabled={busy}
     onClick={()=>void refresh()}>
     {busy?'Loading...':'Refresh intelligence'}
    </button>

    <button type="button"
     disabled={!report||busy}
     onClick={()=>report&&exportCsv(report)}>
     Export executive CSV
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
       ['Branches with breaches',
        report.summary.branchesWithBreaches],
       ['Total breaches',
        report.summary.totalBreaches],
       ['Weighted risk points',
        report.summary.totalRiskScore],
       ['Recurring branches',
        report.summary.recurringBranches],
       ['Critical attention branches',
        report.summary.criticalAttentionBranches],
       ['Overdue unacknowledged',
        report.summary.overdueUnacknowledged]
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

     <h3>Branch management attention ranking</h3>

     {report.branches.map((b,index)=>(
      <div key={b.locationId} style={{
       border:'1px solid #ddd',
       borderRadius:8,
       padding:14,
       marginBottom:12
      }}>
       <div style={{
        display:'flex',
        justifyContent:'space-between',
        gap:12,
        flexWrap:'wrap'
       }}>
        <strong>
         #{index+1} {b.name} ({b.code})
        </strong>
        <span>
         {b.attentionLevel} — {b.riskScore} points
        </span>
       </div>

       <div style={{
        height:12,
        background:'#e5e7eb',
        borderRadius:6,
        margin:'10px 0',
        overflow:'hidden'
       }}>
        <div style={{
         width:(b.riskScore/maxScore*100)+'%',
         height:'100%',
         background:b.attentionLevel==='CRITICAL'
          ?'#ef3321':'#104c72'
        }}/>
       </div>

       <p>
        {b.total} breach(es), {b.pending} pending,{' '}
        {b.overdueUnacknowledged} overdue
        unacknowledged, {b.unresolvedEscalations}{' '}
        associated unresolved escalation(s).
       </p>

       {b.recurring&&(
        <p>
         <strong>Recurring issue:</strong> At least{' '}
         {report.scoringPolicy.recurringThreshold}{' '}
         breaches in the reporting period.
        </p>
       )}
      </div>
     ))}

     {report.branches.length===0&&(
      <p>No SLA breach records in this reporting period.</p>
     )}

     <h3>Executive branch comparison</h3>

     <div style={{overflowX:'auto'}}>
      <table style={{width:'100%'}}>
       <thead>
        <tr>
         <th>Branch</th>
         <th>Risk</th>
         <th>Critical</th>
         <th>High</th>
         <th>Medium</th>
         <th>Late ACK</th>
         <th>Recurring</th>
        </tr>
       </thead>
       <tbody>
        {report.branches.map(b=>(
         <tr key={b.locationId}>
          <td>{b.code}</td>
          <td>{b.riskScore}</td>
          <td>{b.critical}</td>
          <td>{b.high}</td>
          <td>{b.medium}</td>
          <td>{b.lateAcknowledgements}</td>
          <td>{b.recurring?'Yes':'No'}</td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>

     <p style={{marginTop:16}}>
      Scores indicate management attention, not
      financial loss, misconduct or fraud.
      Recurrence is based on recorded SLA breaches,
      not independently verified root causes.
      Branches without breaches are excluded.
     </p>
    </>
   )}
  </section>
 );
}