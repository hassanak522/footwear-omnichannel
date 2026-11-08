"use client";
import { useState } from "react";
type Compare = {from:string;to:string;truncated:boolean;rows:Array<{
  locationId:string;snapshotDate:string|null;pendingCount:number;pendingAmount:string;
  approvedCount:number;approvedAmount:string;recordedSettlementAmount:string}>;warning:string};
type Exception = {type:string;id:string;invoiceId:string;amount:string;note:string};
type Statement = {invoice:{invoiceNumber:string;totalAmount:string};
  verifiedEvidenceAmount:string;remainingAgainstVerifiedEvidence:string;
  truncated:boolean;warning:string;requests:unknown[];settlements:unknown[]};
const csv=(v:unknown)=>{let s=String(v??"");if(/^[=+@\-\t\r]/.test(s))s="'"+s;return `"${s.replace(/"/g,'""')}"`;};
function download(filename:string,headers:string[],rows:unknown[][]){
  const contents=[headers.map(csv).join(","),...rows.map(r=>r.map(csv).join(","))].join("\r\n");
  const url=URL.createObjectURL(new Blob(["\uFEFF",contents],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}
export default function FinanceOperations(){
  const [locations,setLocations]=useState("");const [from,setFrom]=useState("");
  const [to,setTo]=useState("");const [invoiceId,setInvoiceId]=useState("");
  const [compare,setCompare]=useState<Compare|null>(null);
  const [exceptions,setExceptions]=useState<Exception[]>([]);
  const [exceptionWarning,setExceptionWarning]=useState("");
  const [statement,setStatement]=useState<Statement|null>(null);
  const [error,setError]=useState("");const [loading,setLoading]=useState(false);
  async function get(url:string){
    const r=await fetch(url,{credentials:"include",cache:"no-store"});
    if(!r.ok)throw new Error(`Request failed (${r.status}). Check login and API proxy.`);
    return r.json();
  }
  async function run(){
    setError("");setLoading(true);setCompare(null);setExceptions([]);setStatement(null);
    try{
      const ids=locations.split(",").map(x=>x.trim()).filter(Boolean);
      if(!ids.length||ids.length>10)throw new Error("Enter 1–10 location UUIDs");
      if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))
        throw new Error("Select both dates");
      const q=new URLSearchParams({locationIds:ids.join(","),from,to});
      const c=await get(`/api/v1/finance-operations/compare?${q.toString()}`);
      setCompare(c);
      if(ids.length===1){
        const e=await get(`/api/v1/finance-operations/exceptions?locationId=${encodeURIComponent(ids[0])}`);
        setExceptions(e.items??[]);setExceptionWarning(e.truncated?"Exception results truncated.":e.warning??"");
      }
      if(invoiceId.trim()){
        setStatement(await get(`/api/v1/finance-operations/invoice-statement?invoiceId=${encodeURIComponent(invoiceId.trim())}`));
      }
    }catch(e){setError(e instanceof Error?e.message:"Unable to load");}
    finally{setLoading(false);}
  }
  return <main style={{maxWidth:1100,margin:"30px auto",padding:24,fontFamily:"system-ui"}}>
    <h1>HQ Finance Operations</h1>
    <p>Management reporting, invoice statements, and reconciliation exceptions. Amounts are not bank-verified.</p>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
      <label>Location UUIDs (comma separated)<input value={locations} onChange={e=>setLocations(e.target.value)} style={{display:"block",minWidth:320,padding:8}}/></label>
      <label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{display:"block",padding:8}}/></label>
      <label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{display:"block",padding:8}}/></label>
      <label>Invoice UUID (optional)<input value={invoiceId} onChange={e=>setInvoiceId(e.target.value)} style={{display:"block",minWidth:260,padding:8}}/></label>
      <button disabled={loading} onClick={run}>{loading?"Loading…":"Load reports"}</button>
    </div>
    {error&&<p role="alert" style={{color:"crimson"}}>{error}</p>}
    {compare&&<section style={{marginTop:24,overflowX:"auto"}}>
      <h2>Branch comparison</h2>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["Location","Snapshot date","Pending","Approved","Recorded evidence"].map(x=><th key={x} style={{padding:8,textAlign:"left",borderBottom:"1px solid #aaa"}}>{x}</th>)}</tr></thead>
        <tbody>{compare.rows.map(r=><tr key={r.locationId}>
          {[r.locationId,r.snapshotDate??"No snapshot",`${r.pendingCount} / ${r.pendingAmount}`,`${r.approvedCount} / ${r.approvedAmount}`,r.recordedSettlementAmount].map((x,i)=><td key={i} style={{padding:8,borderBottom:"1px solid #ddd"}}>{x}</td>)}
        </tr>)}</tbody>
      </table>
      <p>{compare.warning}{compare.truncated?" WARNING: Results truncated.":""}</p>
      <button disabled={compare.truncated} onClick={()=>download("royal-step-branch-comparison.csv",
        ["Location","Snapshot date","Pending count","Pending amount","Approved count","Approved amount","Recorded evidence"],
        compare.rows.map(r=>[r.locationId,r.snapshotDate,r.pendingCount,r.pendingAmount,r.approvedCount,r.approvedAmount,r.recordedSettlementAmount]))}>Export branch comparison CSV</button>
    </section>}
    {statement&&<section style={{marginTop:24}}>
      <h2>Invoice statement: {statement.invoice.invoiceNumber}</h2>
      <p>Invoice: {statement.invoice.totalAmount} · Verified staff evidence: {statement.verifiedEvidenceAmount} · Remaining: {statement.remainingAgainstVerifiedEvidence}</p>
      <p>{statement.warning}{statement.truncated?" WARNING: Statement truncated.":""}</p>
    </section>}
    {!!exceptions.length&&<section style={{marginTop:24}}>
      <h2>Financial exceptions ({exceptions.length})</h2>
      <ul>{exceptions.map(x=><li key={x.type+x.id}><strong>{x.type}</strong> — Invoice {x.invoiceId}, amount {x.amount}. {x.note}</li>)}</ul>
      <button disabled={exceptionWarning.includes("truncated")} onClick={()=>download("royal-step-finance-exceptions.csv",
        ["Type","Record ID","Invoice ID","Amount","Note"],exceptions.map(x=>[x.type,x.id,x.invoiceId,x.amount,x.note]))}>Export exceptions CSV</button>
    </section>}
    {exceptionWarning&&<p>{exceptionWarning}</p>}
  </main>;
}
