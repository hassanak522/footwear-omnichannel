'use client';

import {useCallback,useEffect,useState} from 'react';

type Branch={
 locationId:string;
 code:string;
 name:string;
 expectedClosings:number;
 acknowledgedClosings:number;
 missingClosings:number;
 missingDates:string[];
 openIncidents:number;
 incidentStatuses:Record<string,number>;
 lastAcknowledgedAt:string|null;
};

type Report={
 generatedAt:string;
 dates:string[];
 summary:{
  branches:number;
  expectedClosings:number;
  acknowledgedClosings:number;
  missingClosings:number;
  openIncidents:number;
 };
 branches:Branch[];
};

export default function ClosingOversight(){
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');

 const refresh=useCallback(async()=>{
  setLoading(true);
  setError('');

  try{
   const response=await fetch(
    '/api/v1/pos/finance/hq-closing-oversight',
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
      :data.message||'Unable to load HQ closing oversight'
    );
   }

   setReport(data as Report);
  }catch(e){
   setError(
    e instanceof Error?e.message:'Unexpected error'
   );
   setReport(null);
  }finally{
   setLoading(false);
  }
 },[]);

 useEffect(()=>{
  void refresh();
 },[refresh]);

 const metrics=report?[
  ['Active branches',report.summary.branches],
  ['Expected acknowledgements',report.summary.expectedClosings],
  ['Recorded acknowledgements',report.summary.acknowledgedClosings],
  ['Missing acknowledgements',report.summary.missingClosings],
  ['Unresolved drift incidents',report.summary.openIncidents]
 ]:[];

 return (
  <main style={{
   maxWidth:1250,
   margin:'0 auto',
   padding:24
  }}>
   <div style={{
    display:'flex',
    justifyContent:'space-between',
    alignItems:'center',
    flexWrap:'wrap',
    gap:12
   }}>
    <div>
     <h1>HQ Closing Oversight</h1>
     <p>
      Royal Step — cross-branch financial closing controls
     </p>
    </div>

    <button onClick={()=>void refresh()} disabled={loading}>
     {loading?'Loading...':'Refresh'}
    </button>
   </div>

   <p>
    <a href="/admin">Back to HQ management</a>
   </p>

   <p>
    Seven completed UTC dates.
    Missing acknowledgement means no signed closing
    review exists for that branch and date.
   </p>

   {error&&(
    <p role="alert" style={{color:'#b91c1c'}}>
     {error}
    </p>
   )}

   {report&&(
    <>
     <div style={{
      display:'grid',
      gridTemplateColumns:
       'repeat(auto-fit,minmax(180px,1fr))',
      gap:12,
      margin:'24px 0'
     }}>
      {metrics.map(([label,value])=>(
       <section key={String(label)} className="card">
        <p>{label}</p>
        <h2>{value}</h2>
       </section>
      ))}
     </div>

     <section className="card">
      <h2>Branch closing register</h2>

      <div style={{overflowX:'auto'}}>
       <table style={{width:'100%'}}>
        <thead>
         <tr>
          <th>Branch</th>
          <th>Acknowledged</th>
          <th>Missing</th>
          <th>Open incidents</th>
          <th>Latest acknowledgement</th>
         </tr>
        </thead>
        <tbody>
         {report.branches.map(branch=>(
          <tr key={branch.locationId}>
           <td>
            <strong>{branch.name}</strong>
            <div>{branch.code}</div>
           </td>
           <td>
            {branch.acknowledgedClosings}
            /{branch.expectedClosings}
           </td>
           <td>{branch.missingClosings}</td>
           <td>{branch.openIncidents}</td>
           <td>
            {branch.lastAcknowledgedAt
             ?new Date(
               branch.lastAcknowledgedAt
              ).toLocaleString()
             :'None in period'}
           </td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     </section>

     <section className="card" style={{marginTop:20}}>
      <h2>Branch exceptions</h2>

      {report.branches.map(branch=>(
       <article key={branch.locationId}
        style={{
         borderBottom:'1px solid #ddd',
         padding:'14px 0'
        }}>
        <h3>{branch.name} ({branch.code})</h3>

        <p>
         Missing closing acknowledgements:
         {' '}{branch.missingClosings}
        </p>

        {branch.missingDates.length>0&&(
         <p>
          Dates: {branch.missingDates.join(', ')}
         </p>
        )}

        <p>
         Unresolved drift incidents:
         {' '}{branch.openIncidents}
        </p>

        {Object.entries(
         branch.incidentStatuses
        ).map(([status,count])=>(
         <p key={status}>{status}: {count}</p>
        ))}
       </article>
      ))}
     </section>

     <p style={{marginTop:20}}>
      Generated: {new Date(
       report.generatedAt
      ).toLocaleString()}
     </p>

     <p>
      This dashboard reports recorded acknowledgements
      and persisted drift incidents. It does not
      automatically scan for new drift or certify that
      every branch completed its operating day.
     </p>
    </>
   )}
  </main>
 );
}