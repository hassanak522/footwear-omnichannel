'use client';

import {useEffect,useState} from 'react';
import BranchPaymentCasework from './BranchPaymentCasework';
import BranchClosingRegister from './BranchClosingRegister';
import BranchClosingDriftQueue from './BranchClosingDriftQueue';

type Branch={
 id:string;
 name:string;
 code:string;
 type:string;
 active:boolean;
};

type ShiftRow={
 shiftId:string;
 deviceId:string;
 cashierId:string;
 closedAt:string;
 expectedCash:string;
 countedCash:string;
 variance:string;
 acceptedSales:number;
 conflictedSales:number;
};

type RefundRow={
 returnId:string;
 saleId:string;
 status:string;
 refundDue:string;
 settled:string;
 outstanding:string;
};

type Report={
 location:{id:string;code:string;name:string};
 period:{from:string;to:string;timezone:string};
 generatedAt:string;
 status:string;
 issues:string[];
 sales:{
  accepted:number;
  conflicted:number;
  unresolved:number;
  acceptedTotal:string;
  tenderTotal:string;
  tenderDifference:string;
  lateSynced:number;
  tenders:{cash:string;card:string;other:string};
 };
 shifts:{
  open:number;
  closedInPeriod:number;
  totalVariance:string;
  rows:ShiftRow[];
 };
 drawer:{
  pendingMovements:number;
  movementsInPeriod:number;
 };
 refunds:{
  returnsInPeriod:number;
  outstandingCount:number;
  outstandingAmount:string;
  rows:RefundRow[];
 };
 limitations:string[];
};

async function api<T>(path:string):Promise<T>{
 const response=await fetch('/api/v1'+path,{
  credentials:'same-origin',
  cache:'no-store'
 });

 const data=await response.json().catch(()=>({}));

 if(!response.ok){
  throw Error(
   Array.isArray(data.message)
    ?data.message.join('; ')
    :data.message||'HTTP '+response.status
  );
 }

 return data as T;
}

const dateUTC=(d:Date)=>d.toISOString().slice(0,10);

const money=(value:string|number)=>
 'PKR '+Number(value).toLocaleString('en-PK',{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 });

const timestamp=(value:string)=>
 new Date(value).toLocaleString('en-PK',{
  timeZone:'UTC'
 })+' UTC';

const panel:React.CSSProperties={
 background:'#fff',
 border:'1px solid #dbe3ed',
 borderRadius:12,
 padding:18
};

const tableStyle:React.CSSProperties={
 width:'100%',
 borderCollapse:'collapse'
};

export default function BranchFinanceReconciliation(){
 const [branches,setBranches]=useState<Branch[]>([]);
 const [locationId,setLocationId]=useState('');
 const [from,setFrom]=useState(()=>{
  const d=new Date();
  d.setUTCDate(d.getUTCDate()-6);
  return dateUTC(d);
 });
 const [to,setTo]=useState(()=>dateUTC(new Date()));
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [loadedKey,setLoadedKey]=useState('');

 const key=locationId+'|'+from+'|'+to;
 const current=loadedKey===key?report:null;

 useEffect(()=>{
  let active=true;

  api<Branch[]>('/inventory/locations')
   .then(rows=>{
    if(!active)return;
    const available=rows.filter(b=>
     b.type==='BRANCH'&&b.active
    );
    setBranches(available);
    setLocationId(available[0]?.id||'');
   })
   .catch(e=>{
    if(active)setError(String(e));
   });

  return()=>{active=false};
 },[]);

 async function load(){
  if(!locationId){
   setError('Select a branch.');
   return;
  }

  const start=new Date(from+'T00:00:00.000Z');
  const end=new Date(to+'T00:00:00.000Z');

  if(
   !from||!to||
   Number.isNaN(start.getTime())||
   Number.isNaN(end.getTime())||
   end<start||
   end.getTime()-start.getTime()>=31*86400000
  ){
   setError('Select a valid range of 1 to 31 UTC days.');
   return;
  }

  setLoading(true);
  setError('');
  setReport(null);

  try{
   const query=new URLSearchParams({
    locationId,from,to
   });

   const result=await api<Report>(
    '/pos/finance/branch-reconciliation?'+query.toString()
   );

   setReport(result);
   setLoadedKey(key);
  }catch(e){
   setError(String(e));
  }finally{
   setLoading(false);
  }
 }

 const metrics=current?[
  ['Accepted sales',current.sales.accepted],
  ['Accepted sales value',money(current.sales.acceptedTotal)],
  ['Cash tenders',money(current.sales.tenders.cash)],
  ['Card tenders',money(current.sales.tenders.card)],
  ['Other tenders',money(current.sales.tenders.other)],
  ['Tender difference',money(current.sales.tenderDifference)],
  ['Closed shifts',current.shifts.closedInPeriod],
  ['Open shifts',current.shifts.open],
  ['Cash variance',money(current.shifts.totalVariance)],
  ['Pending drawer movements',current.drawer.pendingMovements],
  ['Outstanding refunds',money(current.refunds.outstandingAmount)],
  ['Late-synced sales',current.sales.lateSynced]
 ]:[];

 return <section className="stack" style={{gap:18}}>
  <div>
   <h2 style={{color:'#104c72',marginBottom:6}}>
    Branch Financial Reconciliation
   </h2>
   <p className="muted">
    Read-only operational exception review.
    Dates are UTC; amounts are PKR.
   </p>
  </div>

  <div className="card">
   <div className="grid">
    <label>
     Branch
     <select value={locationId}
      onChange={e=>setLocationId(e.target.value)}>
      <option value="">Select branch</option>
      {branches.map(b=>
       <option key={b.id} value={b.id}>
        {b.name} ({b.code})
       </option>
      )}
     </select>
    </label>

    <label>
     From (UTC)
     <input type="date" value={from}
      onChange={e=>setFrom(e.target.value)}/>
    </label>

    <label>
     To (UTC)
     <input type="date" value={to}
      onChange={e=>setTo(e.target.value)}/>
    </label>
   </div>

   <div style={{marginTop:16}}>
    <button onClick={load} disabled={loading||!locationId}>
     {loading?'Loading...':'Generate reconciliation'}
    </button>
   </div>
  </div>

  {error&&<p role="alert" className="error">{error}</p>}

  {current&&<>
   <div style={panel}>
    <strong>
     {current.status==='REVIEW_REQUIRED'
      ?'Review required'
      :'No exceptions detected'}
    </strong>
    <p className="muted">
     {current.location.name} |
     {' '}{current.period.from} to {current.period.to}
     {' '}| Generated {timestamp(current.generatedAt)}
    </p>
    <p>
     This is not bank-settlement verification
     or a financial clearance certificate.
    </p>
   </div>

   <div className="grid">
    {metrics.map(([label,value])=>
     <div className="card" key={String(label)}>
      <div className="muted">{label}</div>
      <div style={{
       fontSize:23,
       fontWeight:700,
       marginTop:10,
       color:'#104c72'
      }}>
       {value}
      </div>
     </div>
    )}
   </div>

   <div style={panel}>
    <h3>Exceptions</h3>
    {current.issues.length===0
     ?<p>No exceptions detected by the current checks.</p>
     :<ul>
       {current.issues.map(issue=>
        <li key={issue}>
         {issue.replace(/_/g,' ')}
        </li>
       )}
      </ul>}
    <p className="muted">
     Stock conflicts: {current.sales.conflicted}.
     Unresolved sales: {current.sales.unresolved}.
     Outstanding refunds: {current.refunds.outstandingCount}.
    </p>
   </div>

   <div style={panel}>
    <h3>Closed shift reconciliation</h3>
    <div className="tablewrap">
     <table style={tableStyle}>
      <thead>
       <tr>
        <th>Shift</th>
        <th>Closed (UTC)</th>
        <th>Expected cash</th>
        <th>Counted cash</th>
        <th>Variance</th>
       </tr>
      </thead>
      <tbody>
       {current.shifts.rows.map(s=>
        <tr key={s.shiftId}>
         <td title={s.shiftId}>{s.shiftId.slice(0,8)}</td>
         <td>{timestamp(s.closedAt)}</td>
         <td>{money(s.expectedCash)}</td>
         <td>{money(s.countedCash)}</td>
         <td>{money(s.variance)}</td>
        </tr>
       )}
      </tbody>
     </table>
    </div>
    {!current.shifts.rows.length&&
     <p className="muted">No closing snapshots in this period.</p>}
   </div>

   <div style={panel}>
    <h3>Refund settlement review</h3>
    <div className="tablewrap">
     <table style={tableStyle}>
      <thead>
       <tr>
        <th>Return</th>
        <th>Status</th>
        <th>Due</th>
        <th>Settled</th>
        <th>Outstanding</th>
       </tr>
      </thead>
      <tbody>
       {current.refunds.rows.map(r=>
        <tr key={r.returnId}>
         <td title={r.returnId}>{r.returnId.slice(0,8)}</td>
         <td>{r.status}</td>
         <td>{money(r.refundDue)}</td>
         <td>{money(r.settled)}</td>
         <td>{money(r.outstanding)}</td>
        </tr>
       )}
      </tbody>
     </table>
    </div>
    {!current.refunds.rows.length&&
     <p className="muted">No returns in this period.</p>}
   </div>

   <BranchClosingDriftQueue locationId={current.location.id}/>

   <BranchPaymentCasework locationId={current.location.id}/>

   <BranchClosingRegister
    locationId={current.location.id}
    from={current.period.from}
    to={current.period.to}
    reportStatus={current.status}
    issues={current.issues}
    closedShifts={current.shifts.closedInPeriod}
   />

   <div style={panel}>
    <h3>Reporting limitations</h3>
    <ul>
     {current.limitations.map((item,i)=>
      <li key={i}>{item}</li>
     )}
    </ul>
   </div>
  </>}
 </section>;
}