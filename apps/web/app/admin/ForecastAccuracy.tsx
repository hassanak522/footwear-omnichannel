'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';

type Row = {
 locationId:string;
 branchName:string;
 variantId:string;
 sku:string;
 available:number;
 trainingUnits:number;
 testUnits:number;
 predictedTestUnits:number;
 absoluteError:number;
 historicalDaily:number;
 recentDaily:number;
 previousDaily:number;
 velocityChangePct:number|null;
 daysCover:number|null;
 risk:string;
 accuracyEligible:boolean;
};

type Response = {
 saleCount:number;
 rows:Row[];
 accuracy:{
  eligibleSkuBranches:number;
  wapePct:number|null;
  definition:string;
 };
 notes:string[];
};

function csvCell(value:unknown) {
 const raw=String(value??'');
 const safe=/^\s*[=+\-@\t\r]/.test(raw)?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
}

function fixed(n:number|null,digits=1) {
 return n===null?'N/A':n.toFixed(digits);
}

export default function ForecastAccuracy() {
 const [days,setDays]=useState(30);
 const [branch,setBranch]=useState('ALL');
 const [risk,setRisk]=useState('ALL');
 const [search,setSearch]=useState('');
 const [data,setData]=useState<Response|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');

 const load=useCallback(async()=>{
  setLoading(true);
  setError('');

  try {
   const to=new Date();
   const from=new Date(to.getTime()-days*86400000);

   const query=new URLSearchParams({
    from:from.toISOString(),
    to:to.toISOString()
   });

   const response=await fetch(
    '/api/v1/hq/pos-forecast-accuracy?'+query.toString(),
    {credentials:'include',cache:'no-store'}
   );

   if(!response.ok){
    const result=await response.json().catch(()=>null);
    const message=Array.isArray(result?.message)
     ?result.message.join('; ')
     :result?.message;
    throw new Error(message||`HTTP ${response.status}`);
   }

   const result=await response.json();

   if(!Array.isArray(result.rows)){
    throw new Error('Invalid forecast response');
   }

   setData(result);
  }catch(e){
   setData(null);
   setError(e instanceof Error?e.message:'Load failed');
  }finally{
   setLoading(false);
  }
 },[days]);

 useEffect(()=>{
  void load();
 },[load]);

 const branches=useMemo(()=>{
  const map=new Map<string,string>();

  for(const r of data?.rows||[]){
   map.set(r.locationId,r.branchName);
  }

  return [...map.entries()].sort((a,b)=>
   a[1].localeCompare(b[1])
  );
 },[data]);

 const filtered=useMemo(()=>(
  data?.rows||[]
 ).filter(r=>
  (branch==='ALL'||r.locationId===branch) &&
  (risk==='ALL'||r.risk===risk) &&
  (!search.trim()||
   r.sku.toLowerCase().includes(search.trim().toLowerCase())||
   r.branchName.toLowerCase().includes(search.trim().toLowerCase()))
 ),[data,branch,risk,search]);

 const metrics=useMemo(()=>{
  const eligible=filtered.filter(r=>r.accuracyEligible);
  const actual=eligible.reduce((n,r)=>n+r.testUnits,0);
  const error=eligible.reduce((n,r)=>n+r.absoluteError,0);

  return {
   skuCount:filtered.length,
   critical:filtered.filter(r=>
    r.risk==='CRITICAL'||r.risk==='OUT OF STOCK NOW'
   ).length,
   high:filtered.filter(r=>r.risk==='HIGH').length,
   wape:actual>0?100*error/actual:null,
   eligible:eligible.length
  };
 },[filtered]);

 function exportCSV(){
  const headers=[
   'Branch','SKU','Risk','Available','Recent Daily Sales',
   'Previous Daily Sales','Velocity Change %',
   'Days Cover','Training Units','Test Actual Units',
   'Test Predicted Units','Absolute Error','Accuracy Eligible'
  ];

  const rows=filtered.map(r=>[
   r.branchName,r.sku,r.risk,r.available,
   r.recentDaily.toFixed(2),
   r.previousDaily.toFixed(2),
   r.velocityChangePct===null?'':r.velocityChangePct.toFixed(1),
   r.daysCover===null?'':r.daysCover.toFixed(1),
   r.trainingUnits,r.testUnits,
   r.predictedTestUnits.toFixed(2),
   r.absoluteError.toFixed(2),
   r.accuracyEligible?'Yes':'No'
  ]);

  const csv=[headers,...rows]
   .map(row=>row.map(csvCell).join(','))
   .join('\r\n');

  const blob=new Blob(['\uFEFF'+csv],{
   type:'text/csv;charset=utf-8'
  });

  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');

  link.href=url;
  link.download='royal-step-forecast-accuracy.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
 }

 return (
  <section className="card stack">
   <div className="row">
    <div>
     <h2>Forecast accuracy & stockout risk</h2>
     <p className="muted">
      Analyze POS sales velocity, forecast errors,
      and current stock coverage.
     </p>
    </div>
    <button className="secondary"
     disabled={loading}
     onClick={()=>void load()}>
     {loading?'Loading...':'Refresh'}
    </button>
   </div>

   {error&&<p role="alert" className="error">{error}</p>}

   <div className="grid">
    <label>Analysis period
     <select value={days}
      onChange={e=>setDays(Number(e.target.value))}>
      {[14,30,60,90].map(n=>
       <option key={n} value={n}>{n} days</option>
      )}
     </select>
    </label>

    <label>Branch
     <select value={branch}
      onChange={e=>setBranch(e.target.value)}>
      <option value="ALL">All branches</option>
      {branches.map(([id,name])=>
       <option key={id} value={id}>{name}</option>
      )}
     </select>
    </label>

    <label>Risk level
     <select value={risk}
      onChange={e=>setRisk(e.target.value)}>
      <option value="ALL">All</option>
      <option value="OUT OF STOCK NOW">Out of stock now</option>
      <option value="CRITICAL">Critical</option>
      <option value="HIGH">High</option>
      <option value="NORMAL">Normal</option>
      <option value="INSUFFICIENT SIGNAL">
       Insufficient sales signal
      </option>
     </select>
    </label>

    <label>Search SKU or branch
     <input value={search}
      onChange={e=>setSearch(e.target.value)}
      placeholder="Search"
     />
    </label>
   </div>

   <div className="grid">
    {[
     ['SKU/branch combinations',metrics.skuCount],
     ['Critical / out of stock',metrics.critical],
     ['High risk',metrics.high],
     ['Backtest WAPE',metrics.wape===null
      ?'N/A':metrics.wape.toFixed(1)+'%'],
     ['Backtest eligible',metrics.eligible]
    ].map(([label,value])=>
     <div className="card" key={String(label)}>
      <span className="muted">{label}</span>
      <div className="metric">{value}</div>
     </div>
    )}
   </div>

   <p className="muted">
    Lower WAPE means lower historical prediction error.
    WAPE is not a guaranteed future accuracy percentage.
    {data&&` ${data.saleCount} accepted POS transactions analyzed.`}
   </p>

   <div className="row">
    <h3>SKU performance and stockout risk</h3>
    <button className="secondary right"
     disabled={loading||!filtered.length}
     onClick={exportCSV}>
     Export CSV
    </button>
   </div>

   <div className="tablewrap">
    <table>
     <thead>
      <tr>
       <th>Branch</th>
       <th>SKU</th>
       <th>Risk</th>
       <th>Available</th>
       <th>Recent/day</th>
       <th>Velocity change</th>
       <th>Days cover</th>
       <th>Actual test</th>
       <th>Predicted test</th>
      </tr>
     </thead>
     <tbody>
      {filtered.map(r=>
       <tr key={r.locationId+':'+r.variantId}>
        <td>{r.branchName}</td>
        <td>{r.sku}</td>
        <td>{r.risk}</td>
        <td>{r.available}</td>
        <td>{r.recentDaily.toFixed(2)}</td>
        <td>{r.velocityChangePct===null
         ?'N/A':r.velocityChangePct.toFixed(1)+'%'}</td>
        <td>{fixed(r.daysCover)}</td>
        <td>{r.testUnits}</td>
        <td>{r.predictedTestUnits.toFixed(1)}</td>
       </tr>
      )}
     </tbody>
    </table>
   </div>

   {!loading&&!filtered.length&&
    <p className="muted">No matching SKU records.</p>
   }

   <h3>Interpretation and limitations</h3>
   <ul>
    {(data?.notes||[]).map((n,i)=><li key={i}>{n}</li>)}
   </ul>

   <p className="muted">
    This report is advisory and read-only. Historical
    stockout periods, seasonal adjustments, returns-adjusted
    demand, and automated purchase decisions are not included.
   </p>
  </section>
 );
}