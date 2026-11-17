'use client';

import {useEffect,useState} from 'react';

type Batch = {
 batchId:string;
 capturedAt:string;
 rows:number;
};

type Snapshot = {
 batchId:string;
 locationId:string;
 variantId:string;
 branchName:string;
 available:number;
};

type History = {
 batches:Batch[];
 rows:Snapshot[];
 notes:string[];
};

export default function StockAvailabilityHistory(){
 const [history,setHistory]=useState<History|null>(null);
 const [loading,setLoading]=useState(false);
 const [capturing,setCapturing]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');

 async function load(){
  setLoading(true);
  setError('');

  try{
   const response=await fetch(
    '/api/v1/hq/stock-availability-snapshots',
    {credentials:'include',cache:'no-store'}
   );

   if(!response.ok){
    throw new Error('History request failed: '+response.status);
   }

   const result=await response.json();

   if(!Array.isArray(result.batches)||
      !Array.isArray(result.rows)){
    throw new Error('Invalid history response');
   }

   setHistory(result);
  }catch(e){
   setError(e instanceof Error?e.message:'Load failed');
  }finally{
   setLoading(false);
  }
 }

 useEffect(()=>{
  void load();
 },[]);

 async function capture(){
  if(!window.confirm(
   'Capture current stock availability for all active branches?'
  ))return;

  setCapturing(true);
  setError('');
  setMessage('');

  try{
   const response=await fetch(
    '/api/v1/hq/stock-availability-snapshots',
    {method:'POST',credentials:'include'}
   );

   if(!response.ok){
    throw new Error('Capture failed: '+response.status);
   }

   const result=await response.json();

   setMessage(
    'Snapshot captured: '+result.capturedRows+' stock balances.'
   );

   await load();
  }catch(e){
   setError(e instanceof Error?e.message:'Capture failed');
  }finally{
   setCapturing(false);
  }
 }

 const batches=(history?.batches||[]).map(batch=>{
  const rows=(history?.rows||[]).filter(
   r=>r.batchId===batch.batchId
  );

  return {
   ...batch,
   zero:rows.filter(r=>r.available===0).length,
   low:rows.filter(r=>r.available>0&&r.available<=5).length
  };
 });

 return (
  <section className="card stack">
   <h2>Historical stock availability</h2>

   <p className="muted">
    Timestamped stock observations for physical branches.
    Captures do not modify inventory balances.
   </p>

   <div className="row">
    <button onClick={()=>void capture()}
     disabled={capturing||loading}>
     {capturing?'Capturing...':'Capture snapshot'}
    </button>

    <button className="secondary"
     onClick={()=>void load()}
     disabled={loading}>
     {loading?'Loading...':'Refresh'}
    </button>
   </div>

   {error&&<p role="alert" className="error">{error}</p>}
   {message&&<p role="status">{message}</p>}

   <div className="grid">
    <div className="card">
     <div className="muted">Snapshot batches</div>
     <div className="metric">{batches.length}</div>
    </div>

    <div className="card">
     <div className="muted">Latest zero-stock SKUs</div>
     <div className="metric">{batches[0]?.zero??'N/A'}</div>
    </div>

    <div className="card">
     <div className="muted">Latest low-stock SKUs</div>
     <div className="metric">{batches[0]?.low??'N/A'}</div>
    </div>
   </div>

   <h3>Snapshot history</h3>

   <div className="tablewrap">
    <table>
     <thead>
      <tr>
       <th>Captured at</th>
       <th>SKU/branch records</th>
       <th>Zero available</th>
       <th>Low stock (1-5)</th>
      </tr>
     </thead>
     <tbody>
      {batches.map(b=>
       <tr key={b.batchId}>
        <td>{new Date(b.capturedAt).toLocaleString()}</td>
        <td>{b.rows}</td>
        <td>{b.zero}</td>
        <td>{b.low}</td>
       </tr>
      )}
     </tbody>
    </table>
   </div>

   {!loading&&batches.length===0&&
    <p className="muted">No snapshots recorded yet.</p>
   }

   <h3>Data quality limitations</h3>
   <ul>
    {(history?.notes||[]).map((note,i)=>
     <li key={i}>{note}</li>
    )}
   </ul>
  </section>
 );
}