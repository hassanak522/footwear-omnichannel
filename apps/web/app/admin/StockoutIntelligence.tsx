'use client';

import {useEffect, useState} from 'react';

type Branch = {
  locationId:string;
  branchName:string;
  inventoryPairs:number;
  observedPairs:number;
  unobservedPairs:number;
  zeroObservations:number;
  totalObservations:number;
};

type StockRow = {
  locationId:string;
  branchName:string;
  variantId:string;
  sku:string;
  observations:number;
  zeroObservations:number;
  observedStockoutPct:number;
  consecutiveZeroPairs:number;
  latestAvailable:number;
  latestObservedAt:string;
};

type Report = {
  period:{from:string;to:string;days:number};
  summary:{
    activeBranches:number;
    inventoryPairs:number;
    observedPairs:number;
    snapshotBatches:number;
    totalObservations:number;
    zeroObservations:number;
    repeatedZeroPairs:number;
  };
  branches:Branch[];
  rows:StockRow[];
  notes:string[];
};

export default function StockoutIntelligence(){
  const [days,setDays]=useState(7);
  const [report,setReport]=useState<Report|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  async function load(period:number){
    setLoading(true);
    setError('');
    setReport(null);

    try{
      const response=await fetch(
        '/api/v1/hq/stockout-intelligence?days='+period,
        {credentials:'include',cache:'no-store'}
      );

      if(!response.ok){
        throw new Error('Stockout report failed: '+response.status);
      }

      const result=await response.json();

      if(!result.summary || !Array.isArray(result.rows) ||
         !Array.isArray(result.branches)){
        throw new Error('Invalid stockout report response');
      }

      setReport(result);
    }catch(e){
      setError(e instanceof Error?e.message:'Request failed');
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{
    void load(days);
  },[days]);

  const s=report?.summary;

  return (
    <section className="card stack">
      <h2>Stockout Intelligence</h2>

      <p className="muted">
        Historical stockout observations across physical branches.
        Read-only reporting based on scheduled inventory snapshots.
      </p>

      <div className="row">
        <label>
          Analysis period
          <select value={days}
            onChange={e=>setDays(Number(e.target.value))}>
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </label>

        <button className="secondary"
          onClick={()=>void load(days)}
          disabled={loading}>
          {loading?'Loading...':'Refresh'}
        </button>
      </div>

      {error&&<p role="alert" className="error">{error}</p>}

      {s&&<>
        <div className="grid">
          {[
            ['Snapshot batches',s.snapshotBatches],
            ['Stock observations',s.totalObservations],
            ['Zero-stock observations',s.zeroObservations],
            ['Repeated zero pairs',s.repeatedZeroPairs],
            ['Observed SKU/branch pairs',s.observedPairs],
            ['Current inventory pairs',s.inventoryPairs]
          ].map(([label,value])=>
            <div className="card" key={String(label)}>
              <div className="muted">{label}</div>
              <div className="metric">{value}</div>
            </div>
          )}
        </div>

        <h3>Branch coverage</h3>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th>Current inventory pairs</th>
                <th>Observed pairs</th>
                <th>Unobserved pairs</th>
                <th>Zero observations</th>
              </tr>
            </thead>
            <tbody>
              {report!.branches.map(b=>
                <tr key={b.locationId}>
                  <td>{b.branchName}</td>
                  <td>{b.inventoryPairs}</td>
                  <td>{b.observedPairs}</td>
                  <td>{b.unobservedPairs}</td>
                  <td>{b.zeroObservations}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h3>SKU-level stockout observations</h3>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th>SKU</th>
                <th>Observations</th>
                <th>Zero readings</th>
                <th>Zero reading %</th>
                <th>Repeated zero pairs</th>
                <th>Latest available</th>
                <th>Last observed</th>
              </tr>
            </thead>
            <tbody>
              {report!.rows.map(r=>
                <tr key={r.locationId+':'+r.variantId}>
                  <td>{r.branchName}</td>
                  <td>{r.sku}</td>
                  <td>{r.observations}</td>
                  <td>{r.zeroObservations}</td>
                  <td>{r.observedStockoutPct}%</td>
                  <td>{r.consecutiveZeroPairs}</td>
                  <td>{r.latestAvailable}</td>
                  <td>{new Date(r.latestObservedAt).toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {report!.rows.length===0&&
          <p className="muted">
            No stock availability observations in this period.
          </p>
        }

        <h3>Data quality limitations</h3>
        <ul>
          {report!.notes.map((note,i)=><li key={i}>{note}</li>)}
        </ul>
      </>}
    </section>
  );
}