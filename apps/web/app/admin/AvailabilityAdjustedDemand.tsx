'use client';

import {useEffect, useState} from 'react';

type ForecastRow = {
  locationId:string;
  branchName:string;
  variantId:string;
  sku:string;
  currentAvailable:number;
  soldUnits:number;
  observedDailySales:number;
  snapshotObservations:number;
  availableObservations:number;
  zeroObservations:number;
  coveragePct:number;
  availableObservationPct:number|null;
  adjustmentMultiplier:number|null;
  adjustedDailyDemand:number|null;
  potentialSuppressedUnits:number|null;
  confidence:string;
};

type ForecastReport = {
  period:{
    from:string;
    to:string;
    days:number;
  };
  summary:{
    skuBranchPairs:number;
    acceptedSales:number;
    snapshotBatches:number;
    observedSkuBranchPairs:number;
    adjustmentEligiblePairs:number;
    insufficientDataPairs:number;
    observedZeroReadings:number;
  };
  rows:ForecastRow[];
  notes:string[];
};

const fmt = (value:number|null|undefined, digits=2) =>
  value===null || value===undefined || !Number.isFinite(value)
    ? 'N/A'
    : value.toLocaleString(undefined,{
        maximumFractionDigits:digits
      });

export default function AvailabilityAdjustedDemand(){
  const [days,setDays]=useState(7);
  const [report,setReport]=useState<ForecastReport|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [filter,setFilter]=useState('ALL');

  useEffect(()=>{
    const controller=new AbortController();

    async function load(){
      setLoading(true);
      setError('');
      setReport(null);

      try{
        const response=await fetch(
          '/api/v1/hq/availability-adjusted-demand?days='+days,
          {
            credentials:'include',
            cache:'no-store',
            signal:controller.signal
          }
        );

        if(!response.ok){
          throw new Error(
            response.status===401
              ? 'Session expired. Please sign in again.'
              : 'Forecast request failed: HTTP '+response.status
          );
        }

        const result=await response.json();

        if(!result.summary ||
           !Array.isArray(result.rows) ||
           !Array.isArray(result.notes)){
          throw new Error('Invalid forecast response');
        }

        setReport(result);
      }catch(e){
        if(controller.signal.aborted)return;
        setError(e instanceof Error?e.message:'Request failed');
      }finally{
        if(!controller.signal.aborted)setLoading(false);
      }
    }

    void load();

    return ()=>controller.abort();
  },[days]);

  const rows=(report?.rows||[]).filter(row=>{
    if(filter==='ELIGIBLE'){
      return row.confidence!=='INSUFFICIENT_DATA';
    }
    if(filter==='INSUFFICIENT'){
      return row.confidence==='INSUFFICIENT_DATA';
    }
    if(filter==='ZERO'){
      return row.zeroObservations>0;
    }
    return true;
  });

  return (
    <section className="card stack">
      <h2>Availability-Adjusted Demand Forecast</h2>

      <p className="muted">
        Compare accepted POS sales with historical stock availability.
        Adjusted figures are exploratory estimates, not confirmed lost sales.
      </p>

      <div className="row">
        <label>
          Analysis period
          <select
            value={days}
            onChange={e=>setDays(Number(e.target.value))}
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </label>

        <label>
          Show records
          <select
            value={filter}
            onChange={e=>setFilter(e.target.value)}
          >
            <option value="ALL">All SKU/branch pairs</option>
            <option value="ELIGIBLE">Adjustment eligible</option>
            <option value="INSUFFICIENT">Insufficient data</option>
            <option value="ZERO">Observed zero availability</option>
          </select>
        </label>
      </div>

      {loading&&<p className="muted">Loading forecast...</p>}

      {error&&<p className="error" role="alert">{error}</p>}

      {report&&<>
        <div className="grid">
          {[
            ['SKU/branch pairs',report.summary.skuBranchPairs],
            ['Accepted POS sales',report.summary.acceptedSales],
            ['Snapshot batches',report.summary.snapshotBatches],
            ['Observed pairs',report.summary.observedSkuBranchPairs],
            ['Adjustment eligible',report.summary.adjustmentEligiblePairs],
            ['Insufficient data',report.summary.insufficientDataPairs],
            ['Zero availability readings',report.summary.observedZeroReadings]
          ].map(([label,value])=>
            <div className="card" key={String(label)}>
              <div className="muted">{label}</div>
              <div className="metric">{value}</div>
            </div>
          )}
        </div>

        <h3>Branch and SKU demand analysis</h3>

        <p className="muted">
          Showing {rows.length} of {report.rows.length} records.
          N/A means the evidence does not support an adjusted estimate.
        </p>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th>SKU</th>
                <th>Current available</th>
                <th>Sold units</th>
                <th>Observed units/day</th>
                <th>Snapshots</th>
                <th>Zero readings</th>
                <th>Coverage</th>
                <th>Available readings</th>
                <th>Multiplier</th>
                <th>Adjusted units/day</th>
                <th>Potential suppressed units</th>
                <th>Evidence status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row=>
                <tr key={row.locationId+':'+row.variantId}>
                  <td>{row.branchName}</td>
                  <td>{row.sku}</td>
                  <td>{fmt(row.currentAvailable,0)}</td>
                  <td>{fmt(row.soldUnits,0)}</td>
                  <td>{fmt(row.observedDailySales)}</td>
                  <td>{fmt(row.snapshotObservations,0)}</td>
                  <td>{fmt(row.zeroObservations,0)}</td>
                  <td>{fmt(row.coveragePct)}%</td>
                  <td>
                    {row.availableObservationPct===null
                      ? 'N/A'
                      : fmt(row.availableObservationPct)+'%'}
                  </td>
                  <td>
                    {row.adjustmentMultiplier===null
                      ? 'N/A'
                      : fmt(row.adjustmentMultiplier)+'x'}
                  </td>
                  <td>{fmt(row.adjustedDailyDemand)}</td>
                  <td>{fmt(row.potentialSuppressedUnits)}</td>
                  <td>{row.confidence.replace(/_/g,' ')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {rows.length===0&&
          <p className="muted">
            No SKU/branch pairs match this filter.
          </p>
        }

        <h3>Interpretation and limitations</h3>
        <ul>
          {report.notes.map((note,index)=>
            <li key={index}>{note}</li>
          )}
        </ul>
      </>}
    </section>
  );
}