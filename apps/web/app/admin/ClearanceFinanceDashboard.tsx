'use client';

import {useEffect,useState} from 'react';

type Branch={
 id:string;
 name:string;
 type:string;
 active:boolean;
};

type Sale={
 saleId:string;
 deviceId:string;
 localSaleId:string;
 soldAt:string;
 saleTotal:string;
 allocatedGross:string;
 allocatedDiscount:string;
 allocatedNet:string;
 cashTender:string;
 cardTender:string;
 otherTender:string;
 allocationMatchesSale:boolean;
 tenderMatchesSale:boolean;
};

type Attempt={
 id:string;
 deviceId:string;
 localSaleId:string;
 shiftId:string;
 status:string;
 createdAt:string;
 updatedAt:string;
};

type Summary={
 acceptedClearanceSales:number;
 grossAllocationValue:string;
 clearanceDiscount:string;
 allocationNet:string;
 acceptedSaleTotal:string;
 recordedCashTender:string;
 recordedCardTender:string;
 recordedOtherTender:string;
 recordedTenderTotal:string;
 allocationDifference:string;
 tenderDifference:string;
 allocationMismatchCount:number;
 tenderMismatchCount:number;
 unresolvedAttemptCount:number;
 resolvedNoSaleCount:number;
 attemptStatusCounts:Record<string,number>;
};

type Report={
 locationId:string;
 from:string;
 to:string;
 timezone:string;
 readOnly:boolean;
 truncated:boolean;
 summary:Summary;
 sales:Sale[];
 unresolvedAttempts:Attempt[];
 resolvedNoSaleAttempts:Attempt[];
 note:string;
};

async function get<T>(path:string):Promise<T>{
 const response=await fetch('/api/v1'+path,{
  credentials:'same-origin',
  cache:'no-store'
 });

 const result=await response.json().catch(()=>({}));

 if(!response.ok){
  throw new Error(
   Array.isArray(result.message)
    ?result.message.join('; ')
    :result.message||'HTTP '+response.status
  );
 }

 return result as T;
}

const today=()=>new Date().toISOString().slice(0,10);

const firstDay=()=>{
 const date=new Date();
 return new Date(Date.UTC(
  date.getUTCFullYear(),
  date.getUTCMonth(),
  1
 )).toISOString().slice(0,10);
};

const currency=(value:string|number)=>
 'PKR '+Number(value).toLocaleString('en-PK',{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 });

const dateTime=(value:string)=>
 new Date(value).toLocaleString('en-PK',{
  timeZone:'UTC',
  year:'numeric',
  month:'short',
  day:'2-digit',
  hour:'2-digit',
  minute:'2-digit',
  hour12:false
 })+' UTC';

export default function ClearanceFinanceDashboard(){
 const [branches,setBranches]=useState<Branch[]>([]);
 const [locationId,setLocationId]=useState('');
 const [from,setFrom]=useState(firstDay);
 const [to,setTo]=useState(today);
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [loadedKey,setLoadedKey]=useState('');
 const [selected,setSelected]=useState<Sale|null>(null);

 useEffect(()=>{
  let active=true;

  get<Branch[]>('/inventory/locations')
   .then(rows=>{
    if(!active)return;

    const available=rows.filter(
     b=>b.type==='BRANCH'&&b.active
    );

    setBranches(available);
    setLocationId(available[0]?.id||'');
   })
   .catch(e=>{
    if(active)setError(String(e));
   });

  return()=>{active=false;};
 },[]);

 const key=locationId+'|'+from+'|'+to;

 useEffect(()=>{
  setReport(null);
  setLoadedKey('');
  setSelected(null);
 },[locationId,from,to]);

 async function load(){
  if(!locationId){
   setError('Select a branch.');
   return;
  }

  if(!from||!to||from>to){
   setError('Select a valid UTC date range.');
   return;
  }

  setLoading(true);
  setError('');
  setReport(null);
  setSelected(null);

  try{
   const query=new URLSearchParams({
    locationId,from,to
   });

   const result=await get<Report>(
    '/payment-reports/clearance?'+query.toString()
   );

   setReport(result);
   setLoadedKey(key);
  }catch(e){
   setError(String(e));
  }finally{
   setLoading(false);
  }
 }

 const current=loadedKey===key?report:null;
 const summary=current?.summary;

 // R8_01G_4B14_EXCEPTION_INTELLIGENCE
 const intelligence=current?[
  ...current.sales
   .filter(s=>!s.allocationMatchesSale||!s.tenderMatchesSale)
   .map(s=>({
    id:'sale-'+s.saleId,
    priority:'CRITICAL',
    category:
     !s.allocationMatchesSale&&!s.tenderMatchesSale
      ?'Allocation and tender mismatch'
      :!s.allocationMatchesSale
       ?'Clearance allocation mismatch'
       :'Recorded tender mismatch',
    reference:s.saleId,
    createdAt:s.soldAt,
    action:'Investigate sale, allocation and tender records.'
   })),
  ...current.unresolvedAttempts.map(a=>({
   id:'attempt-'+a.id,
   priority:a.status==='REVIEW_REQUIRED'?'HIGH':'MEDIUM',
   category:a.status==='REVIEW_REQUIRED'
    ?'Manager review required'
    :'Unresolved registered attempt',
   reference:a.localSaleId,
   createdAt:a.createdAt,
   action:'Reconcile centrally. Do not collect payment again.'
  })),
  ...current.resolvedNoSaleAttempts.map(a=>({
   id:'resolved-'+a.id,
   priority:'INFO',
   category:'Manager resolved no sale',
   reference:a.localSaleId,
   createdAt:a.updatedAt,
   action:'Review manager attestation and audit evidence if required.'
  }))
 ].sort((a,b)=>{
  const rank:Record<string,number>={
   CRITICAL:0,HIGH:1,MEDIUM:2,INFO:3
  };
  return rank[a.priority]-rank[b.priority]||
   b.createdAt.localeCompare(a.createdAt);
 }):[];

 const intelligenceCounts={
  critical:intelligence.filter(x=>x.priority==='CRITICAL').length,
  high:intelligence.filter(x=>x.priority==='HIGH').length,
  medium:intelligence.filter(x=>x.priority==='MEDIUM').length,
  info:intelligence.filter(x=>x.priority==='INFO').length
 };
 const metric=(label:string,value:string|number)=>(
  <div className="card" key={label}>
   <div className="muted">{label}</div>
   <h3>{value}</h3>
  </div>
 );

 return (
  <section className="stack">
   <div className="card stack">
    <h2>Clearance finance reconciliation</h2>
    <p className="muted">
     Read-only POS financial reporting. Dates use UTC.
     Recorded tenders are not verified bank settlements.
    </p>

    <div className="row">
     <label>
      Branch
      <select
       value={locationId}
       onChange={e=>setLocationId(e.target.value)}
      >
       <option value="">Select branch</option>
       {branches.map(b=>(
        <option key={b.id} value={b.id}>
         {b.name}
        </option>
       ))}
      </select>
     </label>

     <label>
      From (UTC)
      <input
       type="date"
       value={from}
       onChange={e=>setFrom(e.target.value)}
      />
     </label>

     <label>
      To (UTC)
      <input
       type="date"
       value={to}
       onChange={e=>setTo(e.target.value)}
      />
     </label>

     <button
      disabled={loading||!locationId}
      onClick={load}
     >
      {loading?'Loading...':'Load finance report'}
     </button>
    </div>

    {error&&<p role="alert">{error}</p>}
   </div>

   {current&&summary&&(
    <>
     {current.truncated&&(
      <div className="card">
       <strong>Incomplete report</strong>
       <p>
        The API reached its 1,000-record limit.
        Totals must not be treated as complete.
        Narrow the date range.
       </p>
      </div>
     )}

     <div className="grid">
      {metric(
       'Accepted clearance sales',
       summary.acceptedClearanceSales
      )}
      {metric(
       'Clearance gross allocation',
       currency(summary.grossAllocationValue)
      )}
      {metric(
       'Clearance discount',
       currency(summary.clearanceDiscount)
      )}
      {metric(
       'Accepted sale total',
       currency(summary.acceptedSaleTotal)
      )}
      {metric(
       'Recorded cash',
       currency(summary.recordedCashTender)
      )}
      {metric(
       'Recorded card',
       currency(summary.recordedCardTender)
      )}
      {metric(
       'Recorded other tenders',
       currency(summary.recordedOtherTender)
      )}
      {metric(
       'Recorded tender total',
       currency(summary.recordedTenderTotal)
      )}
      {metric(
       'Unresolved attempts',
       summary.unresolvedAttemptCount
      )}
      {metric(
       'Resolved no-sale attempts',
       summary.resolvedNoSaleCount
      )}
     </div>

     <div className="card stack">
      <h3>Reconciliation controls</h3>

      <table>
       <thead>
        <tr>
         <th>Control</th>
         <th>Difference</th>
         <th>Mismatches</th>
        </tr>
       </thead>
       <tbody>
        <tr>
         <td>Clearance allocation vs sale total</td>
         <td>{currency(summary.allocationDifference)}</td>
         <td>{summary.allocationMismatchCount}</td>
        </tr>
        <tr>
         <td>Recorded tenders vs sale total</td>
         <td>{currency(summary.tenderDifference)}</td>
         <td>{summary.tenderMismatchCount}</td>
        </tr>
       </tbody>
      </table>

      <p className="muted">
       A zero difference does not independently verify
       receipt of funds.
      </p>
     </div>

     <div className="card stack">
      <h3>Finance exception intelligence</h3>

      <p className="muted">
       Read-only investigation priorities derived from
       clearance finance records. These are not independently
       verified settlement exceptions or newly created cases.
      </p>

      <div className="grid">
       {metric('Critical discrepancies',intelligenceCounts.critical)}
       {metric('High priority',intelligenceCounts.high)}
       {metric('Medium priority',intelligenceCounts.medium)}
       {metric('Informational',intelligenceCounts.info)}
      </div>

      <div style={{overflowX:'auto'}}>
       <table>
        <thead>
         <tr>
          <th>Priority</th>
          <th>Classification</th>
          <th>Reference</th>
          <th>Date (UTC)</th>
          <th>Recommended action</th>
         </tr>
        </thead>
        <tbody>
         {intelligence.map(item=>(
          <tr key={item.id}>
           <td><strong>{item.priority}</strong></td>
           <td>{item.category}</td>
           <td>{item.reference}</td>
           <td>{dateTime(item.createdAt)}</td>
           <td>{item.action}</td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>

      {intelligence.length===0&&(
       <p>No classified discrepancies or outstanding attempts
        in the selected reporting period.</p>
      )}

      {current.truncated&&(
       <p role="alert">
        Report is truncated. Classification counts are incomplete.
       </p>
      )}
     </div>
     <div className="card stack">
      <h3>Accepted clearance transactions</h3>

      <div style={{overflowX:'auto'}}>
       <table>
        <thead>
         <tr>
          <th>Date (UTC)</th>
          <th>Sale ID</th>
          <th>Total</th>
          <th>Discount</th>
          <th>Allocation</th>
          <th>Tenders</th>
          <th>Details</th>
         </tr>
        </thead>
        <tbody>
         {current.sales.map(s=>(
          <tr key={s.saleId}>
           <td>{dateTime(s.soldAt)}</td>
           <td>{s.saleId.slice(0,8)}</td>
           <td>{currency(s.saleTotal)}</td>
           <td>{currency(s.allocatedDiscount)}</td>
           <td>
            {s.allocationMatchesSale?'MATCH':'MISMATCH'}
           </td>
           <td>
            {s.tenderMatchesSale?'MATCH':'MISMATCH'}
           </td>
           <td>
            <button
             className="secondary"
             onClick={()=>setSelected(s)}
            >
             View
            </button>
           </td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>

      {current.sales.length===0&&(
       <p>No accepted clearance sales in this period.</p>
      )}
     </div>

     {selected&&(
      <div className="card stack">
       <div className="row">
        <h3>Transaction details</h3>
        <button
         className="secondary"
         onClick={()=>setSelected(null)}
        >
         Close
        </button>
       </div>

       <p><strong>Sale:</strong> {selected.saleId}</p>
       <p><strong>Local sale:</strong> {selected.localSaleId}</p>
       <p><strong>Device:</strong> {selected.deviceId}</p>
       <p><strong>Gross:</strong> {currency(selected.allocatedGross)}</p>
       <p><strong>Discount:</strong> {currency(selected.allocatedDiscount)}</p>
       <p><strong>Net:</strong> {currency(selected.allocatedNet)}</p>
       <p><strong>Cash:</strong> {currency(selected.cashTender)}</p>
       <p><strong>Card:</strong> {currency(selected.cardTender)}</p>
       <p><strong>Other:</strong> {currency(selected.otherTender)}</p>
      </div>
     )}

     <div className="card stack">
      <h3>Unresolved clearance attempts</h3>

      <div style={{overflowX:'auto'}}>
       <table>
        <thead>
         <tr>
          <th>Created (UTC)</th>
          <th>Local sale ID</th>
          <th>Status</th>
          <th>Device</th>
         </tr>
        </thead>
        <tbody>
         {current.unresolvedAttempts.map(a=>(
          <tr key={a.id}>
           <td>{dateTime(a.createdAt)}</td>
           <td>{a.localSaleId}</td>
           <td>{a.status}</td>
           <td>{a.deviceId.slice(0,8)}</td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>

      {current.unresolvedAttempts.length===0&&(
       <p>No unresolved clearance attempts in this period.</p>
      )}
     </div>

     <div className="card stack">
      <h3>Manager no-sale resolutions</h3>

      <div style={{overflowX:'auto'}}>
       <table>
        <thead>
         <tr>
          <th>Created (UTC)</th>
          <th>Local sale ID</th>
          <th>Status</th>
          <th>Last updated (UTC)</th>
         </tr>
        </thead>
        <tbody>
         {current.resolvedNoSaleAttempts.map(a=>(
          <tr key={a.id}>
           <td>{dateTime(a.createdAt)}</td>
           <td>{a.localSaleId}</td>
           <td>{a.status}</td>
           <td>{dateTime(a.updatedAt)}</td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>

      <p className="muted">
       For manager identity, reconciliation evidence and
       audit references, use the Clearance exceptions tab.
      </p>
     </div>

     <p className="muted">{current.note}</p>
    </>
   )}
  </section>
 );
}
