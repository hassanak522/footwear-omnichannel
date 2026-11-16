'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';

type Location = {
 id:string;
 name:string;
 type:string;
 isActive?:boolean;
};

type Demand = {
 locationId:string;
 variantId:string;
 sku:string;
 soldUnits:number;
 averageDailySales:number;
 available:number;
};

type Balance = {
 locationId:string;
 variantId:string;
 onHand:number;
 quarantined:number;
 reservedOnline:number;
 reservedReplenish:number;
 safetyBuffer:number;
};

type Forecast = Demand & {
 branchName:string;
 daysCover:number|null;
 target:number;
 required:number;
 allocated:number;
 unmet:number;
 priority:string;
};

async function get(path:string) {
 const response=await fetch('/api/v1'+path,{
  credentials:'include',
  cache:'no-store'
 });
 if(!response.ok){
  throw new Error(`HTTP ${response.status}: ${path}`);
 }
 return response.json();
}

function available(b:Balance) {
 return Math.max(0,
  b.onHand-b.quarantined-b.reservedOnline-
  b.reservedReplenish-b.safetyBuffer
 );
}

export default function PosDemandForecast() {
 const [locations,setLocations]=useState<Location[]>([]);
 const [demand,setDemand]=useState<Demand[]>([]);
 const [balances,setBalances]=useState<Balance[]>([]);
 const [warehouse,setWarehouse]=useState('');
 const [historyDays,setHistoryDays]=useState(30);
 const [leadDays,setLeadDays]=useState(3);
 const [coverageDays,setCoverageDays]=useState(7);
 const [safetyUnits,setSafetyUnits]=useState(5);
 const [branch,setBranch]=useState('ALL');
 const [search,setSearch]=useState('');
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [notes,setNotes]=useState<string[]>([]);
 const [unmatched,setUnmatched]=useState(0);

 const load=useCallback(async()=>{
  setLoading(true);
  setError('');

  try {
   const now=new Date();
   const to=now.toISOString();
   const from=new Date(
    now.getTime()-historyDays*86400000
   ).toISOString();

   const [forecast,locs]=await Promise.all([
    get('/hq/pos-demand-forecast?from='+
     encodeURIComponent(from)+'&to='+encodeURIComponent(to)),
    get('/inventory/locations')
   ]);

   if(!Array.isArray(forecast.rows) || !Array.isArray(locs)){
    throw new Error('Invalid forecasting API response');
   }

   const relevant=locs.filter((l:Location)=>
    l.isActive!==false &&
    ['BRANCH','WAREHOUSE'].includes(l.type)
   );

   const warehouses=relevant.filter((l:Location)=>
    l.type==='WAREHOUSE'
   );

   const stock=await Promise.all(warehouses.map(
    async(l:Location)=>{
     const rows=await get(
      '/inventory/balances?locationId='+encodeURIComponent(l.id)
     );
     if(!Array.isArray(rows)){
      throw new Error('Invalid warehouse balances response');
     }
     return rows as Balance[];
    }
   ));

   setLocations(relevant);
   setDemand(forecast.rows);
   setBalances(stock.flat());
   setNotes(forecast.notes || []);
   setUnmatched(forecast.soldWithoutBalance?.length || 0);

   setWarehouse(previous=>
    warehouses.some((l:Location)=>l.id===previous)
     ? previous : warehouses[0]?.id || ''
   );
  }catch(e){
   setError(e instanceof Error?e.message:'Forecast failed');
   setDemand([]);
   setBalances([]);
  }finally{
   setLoading(false);
  }
 },[historyDays]);

 useEffect(()=>{
  void load();
 },[load]);

 const valid=
  Number.isInteger(historyDays) && historyDays>=7 &&
  historyDays<=365 &&
  Number.isInteger(leadDays) && leadDays>=0 &&
  leadDays<=365 &&
  Number.isInteger(coverageDays) && coverageDays>=1 &&
  coverageDays<=365 &&
  Number.isInteger(safetyUnits) && safetyUnits>=0 &&
  safetyUnits<=100000;

 const rows=useMemo(()=>{
  if(!warehouse || !valid)return [] as Forecast[];

  const names=new Map(locations.map(l=>[l.id,l.name]));
  const stock=new Map(
   balances.filter(b=>b.locationId===warehouse)
    .map(b=>[b.variantId,available(b)])
  );

  const raw:Forecast[]=demand.map(d=>{
   const daily=d.averageDailySales;
   const target=Math.ceil(
    daily*(leadDays+coverageDays)+safetyUnits
   );
   const required=Math.max(0,target-d.available);
   const daysCover=daily>0?d.available/daily:null;

   const priority=daily===0?'NO SALES HISTORY':
    daysCover!==null && daysCover<=leadDays
     ?'CRITICAL':
    daysCover!==null && daysCover<=leadDays+2
     ?'HIGH':'NORMAL';

   return {
    ...d,
    branchName:names.get(d.locationId)||d.locationId,
    daysCover,target,required,allocated:0,
    unmet:required,priority
   };
  }).filter(r=>r.required>0);

  raw.sort((a,b)=>{
   const aCover=a.daysCover??Infinity;
   const bCover=b.daysCover??Infinity;
   return aCover-bCover ||
    a.branchName.localeCompare(b.branchName) ||
    a.sku.localeCompare(b.sku);
  });

  for(const r of raw){
   const remaining=stock.get(r.variantId)||0;
   r.allocated=Math.min(r.required,remaining);
   r.unmet=r.required-r.allocated;
   stock.set(r.variantId,remaining-r.allocated);
  }

  return raw;
 },[
  warehouse,valid,locations,balances,demand,
  leadDays,coverageDays,safetyUnits
 ]);

 const filtered=rows.filter(r=>
  (branch==='ALL'||r.locationId===branch) &&
  (!search ||
   r.sku.toLowerCase().includes(search.toLowerCase()) ||
   r.branchName.toLowerCase().includes(search.toLowerCase()))
 );

 const sum=(field:'required'|'allocated'|'unmet')=>
  filtered.reduce((n,r)=>n+r[field],0);

 return (
  <section className="card stack">
   <div className="row">
    <div>
     <h2>POS sales-based demand forecasting</h2>
     <p className="muted">
      Historical accepted POS sales drive replenishment
      estimates for physical retail branches.
     </p>
    </div>
    <button className="secondary"
     disabled={loading} onClick={()=>void load()}>
     {loading?'Loading...':'Refresh'}
    </button>
   </div>

   {error&&<p role="alert" className="error">{error}</p>}

   <div className="grid">
    <label>Historical period (days)
     <select value={historyDays}
      onChange={e=>setHistoryDays(Number(e.target.value))}>
      {[7,14,30,60,90,180,365].map(n=>
       <option key={n} value={n}>{n} days</option>
      )}
     </select>
    </label>

    <label>Source warehouse
     <select value={warehouse}
      onChange={e=>setWarehouse(e.target.value)}>
      <option value="">Choose warehouse</option>
      {locations.filter(l=>l.type==='WAREHOUSE').map(l=>
       <option key={l.id} value={l.id}>{l.name}</option>
      )}
     </select>
    </label>

    <label>Lead time (days)
     <input type="number" min={0} max={365} step={1}
      value={leadDays}
      onChange={e=>setLeadDays(Number(e.target.value))}/>
    </label>

    <label>Coverage after lead time (days)
     <input type="number" min={1} max={365} step={1}
      value={coverageDays}
      onChange={e=>setCoverageDays(Number(e.target.value))}/>
    </label>

    <label>Safety stock (units per SKU)
     <input type="number" min={0} max={100000} step={1}
      value={safetyUnits}
      onChange={e=>setSafetyUnits(Number(e.target.value))}/>
    </label>

    <label>Branch
     <select value={branch}
      onChange={e=>setBranch(e.target.value)}>
      <option value="ALL">All branches</option>
      {locations.filter(l=>l.type==='BRANCH').map(l=>
       <option key={l.id} value={l.id}>{l.name}</option>
      )}
     </select>
    </label>

    <label>Search SKU / branch
     <input value={search}
      onChange={e=>setSearch(e.target.value)}
      placeholder="Search"/>
    </label>
   </div>

   {!valid&&<p role="alert" className="error">
    Enter valid forecasting parameters.
   </p>}

   <div className="grid">
    {[
     ['Replenishment needs',filtered.length],
     ['Critical needs',filtered.filter(
      r=>r.priority==='CRITICAL').length],
     ['Required units',sum('required')],
     ['Allocatable units',sum('allocated')],
     ['Unmet units',sum('unmet')]
    ].map(([label,value])=>
     <div className="card" key={String(label)}>
      <span className="muted">{label}</span>
      <div className="metric">{value}</div>
     </div>
    )}
   </div>

   <h3>SKU-level demand and replenishment</h3>

   <div className="tablewrap">
    <table>
     <thead>
      <tr>
       <th>Priority</th><th>Branch</th><th>SKU</th>
       <th>Sold</th><th>Daily avg.</th><th>Available</th>
       <th>Days cover</th><th>Target</th>
       <th>Required</th><th>Allocation</th><th>Unmet</th>
      </tr>
     </thead>
     <tbody>
      {filtered.map(r=>
       <tr key={r.locationId+':'+r.variantId}>
        <td>{r.priority}</td>
        <td>{r.branchName}</td>
        <td>{r.sku}</td>
        <td>{r.soldUnits}</td>
        <td>{r.averageDailySales.toFixed(2)}</td>
        <td>{r.available}</td>
        <td>{r.daysCover===null
         ?'N/A':r.daysCover.toFixed(1)}</td>
        <td>{r.target}</td>
        <td>{r.required}</td>
        <td>{r.allocated}</td>
        <td>{r.unmet}</td>
       </tr>
      )}
     </tbody>
    </table>
   </div>

   {!loading && !filtered.length &&
    <p className="muted">No matching replenishment needs.</p>
   }

   {unmatched>0&&
    <p role="status">
     {unmatched} branch/SKU sales combinations have
     no matching stock balance and are excluded from
     this allocation plan.
    </p>
   }

   <h3>Forecast assumptions and limitations</h3>
   <ul>
    {notes.map((n,i)=><li key={i}>{n}</li>)}
   </ul>

   <p className="muted">
    The model uses a historical average, not seasonal or
    machine-learning forecasting. Warehouse allocations
    are simulated across all branches before display
    filtering. No stock is reserved or transferred.
   </p>
  </section>
 );
}