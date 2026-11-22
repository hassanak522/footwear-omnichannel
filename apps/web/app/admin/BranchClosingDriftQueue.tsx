'use client';

import {useEffect,useState} from 'react';

type DriftRow={
 reviewId:string;
 date:string;
 signedAt:string;
 signedById:string;
 acknowledgementStatus:string;
 integrityStatus:string;
 changed:boolean;
 changedSections:string[];
 currentIssues:string[];
 pendingPaymentCases:number;
 error:string|null;
};

type DriftReport={
 locationId:string;
 generatedAt:string;
 scanned:number;
 limit:number;
 truncated:boolean;
 changed:number;
 unchanged:number;
 failed:number;
 rows:DriftRow[];
 note:string;
};

const stamp=(value:string)=>
 new Date(value).toLocaleString('en-PK',{
  timeZone:'UTC'
 })+' UTC';

export default function BranchClosingDriftQueue({
 locationId
}:{locationId:string}){
 const [report,setReport]=useState<DriftReport|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');

 useEffect(()=>{
  setReport(null);
  setError('');
 },[locationId]);

 async function scan(){
  if(!locationId||loading)return;

  setLoading(true);
  setError('');
  setReport(null);

  try{
   const query=new URLSearchParams({locationId});

   const response=await fetch(
    '/api/v1/pos/finance/closing-reviews/drift-queue?'+
    query.toString(),
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
      :data.message||'HTTP '+response.status
    );
   }

   setReport(data as DriftReport);
  }catch(e){
   setError(String(e));
  }finally{
   setLoading(false);
  }
 }

 const priority=report
  ?[...report.rows].sort((a,b)=>{
    const rank=(s:string)=>
     s==='CHANGES_DETECTED'?0:
     s==='CHECK_FAILED'?1:2;

    return rank(a.integrityStatus)-
     rank(b.integrityStatus);
   })
  :[];

 return <section className="card stack">
  <div className="row"
   style={{justifyContent:'space-between',alignItems:'center'}}>
   <div>
    <h3 style={{color:'#104c72',marginBottom:6}}>
     Closing drift and management exceptions
    </h3>
    <p className="muted">
     Scan the 20 most recent acknowledged branch closings.
    </p>
   </div>

   <button
    disabled={loading||!locationId}
    onClick={()=>void scan()}>
    {loading?'Scanning...':'Scan recent closings'}
   </button>
  </div>

  {error&&<p role="alert" className="error">{error}</p>}

  {report&&<>
   <div className="grid">
    {[
     ['Scanned',report.scanned],
     ['Changed',report.changed],
     ['Unchanged',report.unchanged],
     ['Check failed',report.failed]
    ].map(([label,value])=>
     <div className="card" key={String(label)}>
      <div className="muted">{label}</div>
      <div style={{
       fontSize:24,
       fontWeight:700,
       color:'#104c72',
       marginTop:8
      }}>
       {value}
      </div>
     </div>
    )}
   </div>

   <p className="muted">
    Scan completed: {stamp(report.generatedAt)}
   </p>

   {report.truncated&&
    <p className="muted">
     The scan is limited to 20 recent acknowledgements.
     Older records have not been checked.
    </p>
   }

   <div className="tablewrap">
    <table>
     <thead>
      <tr>
       <th>Closing date</th>
       <th>Integrity</th>
       <th>Changed sections</th>
       <th>Current exceptions</th>
       <th>Reviewer</th>
      </tr>
     </thead>
     <tbody>
      {priority.map(row=>
       <tr key={row.reviewId}>
        <td>{row.date}</td>
        <td>
         <strong>
          {row.integrityStatus.replace(/_/g,' ')}
         </strong>
        </td>
        <td>
         {row.changedSections.length
          ?row.changedSections.join(', ')
          :'—'}
        </td>
        <td>
         {row.error||
          (row.currentIssues.length
           ?row.currentIssues.join(', ')
           :'None detected')}
        </td>
        <td title={row.signedById}>
         {row.signedById.slice(0,8)}
        </td>
       </tr>
      )}
     </tbody>
    </table>
   </div>

   {!report.rows.length&&
    <p className="muted">
     No acknowledged closings found.
    </p>
   }

   <p className="muted">{report.note}</p>
  </>}
 </section>;
}