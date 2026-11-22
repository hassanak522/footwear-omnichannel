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

// R10_3D8_PRIORITY_QUEUE
type Priority='CRITICAL'|'HIGH'|'MEDIUM'|'CLEAR';

function priorityOf(branch:Branch):Priority{
 if(branch.openIncidents>0)return 'CRITICAL';
 if(branch.missingClosings>=3)return 'HIGH';
 if(branch.missingClosings>0)return 'MEDIUM';
 return 'CLEAR';
}

const priorityRank:Record<Priority,number>={
 CRITICAL:0,
 HIGH:1,
 MEDIUM:2,
 CLEAR:3
};

function downloadCsv(branches:Branch[]){
 const rows=[
  [
   'Branch Code',
   'Branch Name',
   'Priority',
   'Acknowledged',
   'Expected',
   'Missing',
   'Missing Dates',
   'Open Incidents',
   'Latest Acknowledgement'
  ],
  ...branches.map(branch=>[
   branch.code,
   branch.name,
   priorityOf(branch),
   String(branch.acknowledgedClosings),
   String(branch.expectedClosings),
   String(branch.missingClosings),
   branch.missingDates.join('; '),
   String(branch.openIncidents),
   branch.lastAcknowledgedAt||''
  ])
 ];

 const csv=rows.map(row=>
  row.map(value=>'"'+value.replace(/"/g,'""')+'"')
   .join(',')
 ).join('\r\n');

 const blob=new Blob(['\uFEFF'+csv],{
  type:'text/csv;charset=utf-8'
 });

 const url=URL.createObjectURL(blob);
 const anchor=document.createElement('a');
 anchor.href=url;
 anchor.download='royal-step-closing-exceptions.csv';
 document.body.appendChild(anchor);
 anchor.click();
 anchor.remove();
 URL.revokeObjectURL(url);
}
export default function ClosingOversight(){
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [priorityFilter,setPriorityFilter]=
  useState<Priority|'ALL'>('ALL');
 const [search,setSearch]=useState('');

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

 const prioritized=report
  ?[...report.branches]
    .filter(branch=>
     (priorityFilter==='ALL'||
      priorityOf(branch)===priorityFilter)&&
     (branch.name+' '+branch.code)
      .toLowerCase()
      .includes(search.trim().toLowerCase())
    )
    .sort((a,b)=>
     priorityRank[priorityOf(a)]-
      priorityRank[priorityOf(b)]||
     b.openIncidents-a.openIncidents||
     b.missingClosings-a.missingClosings||
     a.code.localeCompare(b.code)
    )
  :[];
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

     <section className="card" style={{marginBottom:20}}>
      <h2>HQ Priority Exception Queue</h2>

      <p>
       Priorities are derived from recorded exceptions.
       They are not a financial-loss determination.
      </p>

      <div style={{
       display:'flex',
       gap:12,
       flexWrap:'wrap',
       alignItems:'center',
       marginBottom:16
      }}>
       <label>
        Priority
        <select
         value={priorityFilter}
         onChange={event=>
          setPriorityFilter(
           event.target.value as Priority|'ALL'
          )
         }
        >
         <option value="ALL">All priorities</option>
         <option value="CRITICAL">Critical</option>
         <option value="HIGH">High</option>
         <option value="MEDIUM">Medium</option>
         <option value="CLEAR">Clear</option>
        </select>
       </label>

       <label>
        Branch search
        <input
         value={search}
         onChange={event=>setSearch(event.target.value)}
         placeholder="Name or code"
        />
       </label>

       <button
        type="button"
        onClick={()=>downloadCsv(prioritized)}
       >
        Export filtered CSV
       </button>
      </div>

      <div style={{overflowX:'auto'}}>
       <table style={{width:'100%'}}>
        <thead>
         <tr>
          <th>Priority</th>
          <th>Branch</th>
          <th>Missing</th>
          <th>Unresolved drift</th>
          <th>Follow-up</th>
         </tr>
        </thead>
        <tbody>
         {prioritized.map(branch=>(
          <tr key={branch.locationId}>
           <td><strong>{priorityOf(branch)}</strong></td>
           <td>
            {branch.name}
            <div>{branch.code}</div>
           </td>
           <td>{branch.missingClosings}</td>
           <td>{branch.openIncidents}</td>
           <td>
            {branch.openIncidents>0
             ?'Review persisted drift incidents'
             :branch.missingClosings>0
              ?'Verify trading dates and acknowledgements'
              :'No recorded exceptions'}
           </td>
          </tr>
         ))}
         {prioritized.length===0&&(
          <tr>
           <td colSpan={5}>
            No branches match the selected filters.
           </td>
          </tr>
         )}
        </tbody>
       </table>
      </div>

      <p>
       Priority order: Critical, High, Medium, Clear.
       CSV exports only the currently filtered branches.
      </p>
     </section>
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