"use client";

import { useState } from "react";

type Overview = {
  locationId:string;
  pendingRequests:{count:number;amount:string};
  approvedRequests:{count:number;amount:string};
  recordedSettlementEvidence:{count:number;amount:string};
  stagedPostingBatches:number;
  registeredPeriodLocks:number;
  warning:string;
};
type ReportRow = {
  invoiceId:string; invoiceNumber:string; invoiceDate:string; invoiceAmount:string;
  verifiedEvidence:string; disputedEvidence:string; unreviewedEvidence:string;
  remainingAgainstVerifiedEvidence:string;
};
const base="/api/v1";
const csvCell=(value:unknown)=>{
  let s=String(value??"");
  if(/^[=+@\-\t\r]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
};

export default function FinanceReconciliationPage(){
  const [locationId,setLocationId]=useState("");
  const [overview,setOverview]=useState<Overview|null>(null);
  const [rows,setRows]=useState<ReportRow[]>([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const [warning,setWarning]=useState("");
  async function load(){
    setError("");setLoading(true);setOverview(null);setRows([]);
    try{
      if(!/^[0-9a-fA-F-]{36}$/.test(locationId))throw new Error("Enter a valid location UUID");
      const q=encodeURIComponent(locationId);
      const [a,b]=await Promise.all([
        fetch(`${base}/finance-reconciliation/hq-overview?locationId=${q}`,{credentials:"include",cache:"no-store"}),
        fetch(`${base}/finance-verification/reconciliation-rows?locationId=${q}`,{credentials:"include",cache:"no-store"})
      ]);
      if(!a.ok||!b.ok)throw new Error(`API request failed (${a.status}/${b.status}). Check session and same-origin /api/v1 proxy.`);
      const o=await a.json();const r=await b.json();
      setOverview(o);setRows(r.rows??[]);
      setWarning(r.truncated?"Report is truncated by server row limits. Do not use as a complete reconciliation.":r.warning??"");
    }catch(e){setError(e instanceof Error?e.message:"Unable to load report");}
    finally{setLoading(false);}
  }
  function exportCsv(){
    const keys:(keyof ReportRow)[]=["invoiceId","invoiceNumber","invoiceDate","invoiceAmount",
      "verifiedEvidence","disputedEvidence","unreviewedEvidence","remainingAgainstVerifiedEvidence"];
    const csv=[keys.map(csvCell).join(","),...rows.map(r=>keys.map(k=>csvCell(r[k])).join(","))].join("\r\n");
    const url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="royal-step-supplier-reconciliation.csv";
    link.click();URL.revokeObjectURL(url);
  }
  return <main style={{maxWidth:1050,margin:"32px auto",padding:24,fontFamily:"system-ui"}}>
    <h1>Supplier Reconciliation</h1>
    <p>Staff-reviewed settlement evidence only. Not bank-verified or audited accounting.</p>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:24}}>
      <input aria-label="Location UUID" value={locationId} onChange={e=>setLocationId(e.target.value)}
        placeholder="Location UUID" style={{minWidth:300,padding:10}}/>
      <button onClick={load} disabled={loading}>{loading?"Loading…":"Load financial summary"}</button>
      <button onClick={exportCsv} disabled={!rows.length}>Export reconciliation CSV</button>
    </div>
    {error&&<p role="alert" style={{color:"crimson"}}>{error}</p>}
    {overview&&<section>
      <h2>Location summary</h2>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
        {[
          ["Pending requests",`${overview.pendingRequests.count} · PKR ${overview.pendingRequests.amount}`],
          ["Approved requests",`${overview.approvedRequests.count} · PKR ${overview.approvedRequests.amount}`],
          ["Recorded evidence",`${overview.recordedSettlementEvidence.count} · PKR ${overview.recordedSettlementEvidence.amount}`],
          ["Staged postings",String(overview.stagedPostingBatches)],
          ["Period locks",String(overview.registeredPeriodLocks)]
        ].map(([name,value])=><div key={name} style={{border:"1px solid #ddd",padding:16,borderRadius:8}}>
          <strong>{name}</strong><p>{value}</p>
        </div>)}
      </div>
    </section>}
    {!!rows.length&&<section style={{overflowX:"auto",marginTop:24}}>
      <h2>Invoice reconciliation</h2>
      <table style={{borderCollapse:"collapse",width:"100%",textAlign:"left"}}>
        <thead><tr>{["Invoice","Amount","Verified","Disputed","Unreviewed","Remaining"].map(x=><th key={x} style={{padding:10,borderBottom:"1px solid #aaa"}}>{x}</th>)}</tr></thead>
        <tbody>{rows.map(r=><tr key={r.invoiceId}>
          {[r.invoiceNumber,r.invoiceAmount,r.verifiedEvidence,r.disputedEvidence,r.unreviewedEvidence,r.remainingAgainstVerifiedEvidence].map((v,i)=><td key={i} style={{padding:10,borderBottom:"1px solid #ddd"}}>{v}</td>)}
        </tr>)}</tbody>
      </table>
    </section>}
    {warning&&<p style={{marginTop:20}}>{warning}</p>}
  </main>;
}
