"use client";
import ExecutiveFinanceConsolidated from './components/executive-finance-consolidated';
import RetailFinanceOverview from './components/retail-finance-overview';

import {useState} from "react";
type Alert={type:string;id:string;invoiceId:string|null;createdAt:string;summary:string};
type Statement={rows:Array<{invoiceId:string;invoiceNumber:string;invoiceDate:string;
  invoiceAmount:string;staffReviewedEvidence:string;disputedEvidence:string;
  unreviewedEvidence:string;remainingAgainstReviewedEvidence:string}>;truncated:boolean;warning:string};
type Workflow={openCases:Array<{id:string;summary:string;status:string}>;
  pendingPaymentRequestCount:number;truncated:boolean;warning:string};
function cell(v:unknown){let s=String(v??"");if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export default function FinanceCommandCenter(){
  const [locationId,setLocationId]=useState("");const [days,setDays]=useState("7");
  const [from,setFrom]=useState("");const [to,setTo]=useState("");
  const [alerts,setAlerts]=useState<Alert[]>([]);const [statement,setStatement]=useState<Statement|null>(null);
  const [workflow,setWorkflow]=useState<Workflow|null>(null);
  const [error,setError]=useState("");const [loading,setLoading]=useState(false);
  const [truncated,setTruncated]=useState(false);
  async function fetchJson(path:string){
    const r=await fetch("/api/v1/finance-command-center/"+path,{credentials:"include",cache:"no-store"});
    if(!r.ok)throw new Error("API error "+r.status+"; verify authenticated proxy and permissions");
    return r.json();
  }
  async function load(){
    setLoading(true);setError("");setAlerts([]);setStatement(null);setWorkflow(null);
    try{
      const q="locationId="+encodeURIComponent(locationId);
      const [a,s,w]=await Promise.all([
        fetchJson("alert-feed?"+q+"&olderThanDays="+encodeURIComponent(days)),
        fetchJson("invoice-statement-range?"+q+"&from="+encodeURIComponent(from)+"&to="+encodeURIComponent(to)),
        fetchJson("workflow?"+q)
      ]);
      setAlerts(a.alerts??[]);setStatement(s);setWorkflow(w);
      setTruncated(!!a.truncated||!!s.truncated||!!w.truncated);
    }catch(e){setError(e instanceof Error?e.message:"Could not load data");}
    finally{setLoading(false);}
  }
  function exportCsv(){
    if(!statement||statement.truncated)return;
    const keys=["invoiceId","invoiceNumber","invoiceDate","invoiceAmount","staffReviewedEvidence",
      "disputedEvidence","unreviewedEvidence","remainingAgainstReviewedEvidence"] as const;
    const csv=[keys.map(cell).join(","),...statement.rows.map(r=>keys.map(k=>cell(r[k])).join(","))].join("\r\n");
    const url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a");a.href=url;a.download="royal-step-invoice-date-range.csv";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <main style={{maxWidth:1100,margin:"30px auto",padding:24,fontFamily:"system-ui"}}>


    <header style={{marginBottom:18}}>
  <div style={{
    color:"#ef3321",
    fontSize:12,
    fontWeight:700,
    letterSpacing:1
  }}>
    ROYAL STEP / FINANCIAL MANAGEMENT
  </div>
  <h1 style={{
    color:"#104c72",
    margin:"8px 0 6px",
    fontSize:28
  }}>
    Finance Control Tower
  </h1>
  <p style={{
    color:"#64748b",
    margin:0,
    fontSize:13
  }}>
    Financial oversight for the central warehouse
    and physical retail branches.
  </p>
</header>
<RetailFinanceOverview />
<ExecutiveFinanceConsolidated />




    <details style={{
  marginTop:22,
  border:"1px solid #dbe3ed",
  borderRadius:12,
  padding:18,
  background:"#ffffff"
}}>
  <summary style={{
    cursor:"pointer",
    color:"#104c72",
    fontWeight:700,
    fontSize:15
  }}>
    Supplier invoice evidence, aged alerts and statements
  </summary>
  <p style={{
    color:"#64748b",
    fontSize:13,
    marginTop:14
  }}>
    Specialist supplier finance tools.
    Evidence is not independently bank-confirmed.
  </p>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
      <label>Location UUID<input value={locationId} onChange={e=>setLocationId(e.target.value)}
        style={{display:"block",minWidth:300,padding:8}}/></label>
      <label>Alert age (days)<input type="number" min={1} max={365} value={days}
        onChange={e=>setDays(e.target.value)} style={{display:"block",width:100,padding:8}}/></label>
      <label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{display:"block",padding:8}}/></label>
      <label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{display:"block",padding:8}}/></label>
      <button disabled={loading} onClick={load}>{loading?"Loading…":"Load command center"}</button>
    </div>
    {error&&<p role="alert" style={{color:"crimson"}}>{error}</p>}
    {truncated&&<p role="alert">Some results reached server limits. Do not use as a complete financial report.</p>}
    {workflow&&<section style={{marginTop:24}}>
      <h2>Work queue</h2><p>Pending payment requests: {workflow.pendingPaymentRequestCount}</p>
      <p>Open cases shown: {workflow.openCases.length}</p>
      <nav style={{display:"flex",gap:20,flexWrap:"wrap"}}>
        <a href="/admin/finance-casework">Manage cases</a>
        <a href="/admin/finance-reconciliation">Reconciliation</a>
        <a href="/admin/finance-operations">Financial operations</a>
      </nav>
    </section>}
    <section style={{marginTop:24}}><h2>Aged alerts ({alerts.length})</h2>
      {alerts.length===0?<p>No alerts returned for the selected threshold.</p>:
        <ul>{alerts.map(a=><li key={a.type+a.id}><strong>{a.type}</strong> — {a.summary} ({a.createdAt})</li>)}</ul>}
    </section>
    {statement&&<section style={{marginTop:24,overflowX:"auto"}}>
      <h2>Date-filtered invoice statement ({statement.rows.length})</h2>
      <table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}>
        <thead><tr>{["Invoice","Date","Face value","Reviewed","Disputed","Unreviewed","Remaining"].map(h=>
          <th key={h} style={{padding:8,borderBottom:"1px solid #ccc"}}>{h}</th>)}</tr></thead>
        <tbody>{statement.rows.map(r=><tr key={r.invoiceId}>
          {[r.invoiceNumber,r.invoiceDate,r.invoiceAmount,r.staffReviewedEvidence,
            r.disputedEvidence,r.unreviewedEvidence,r.remainingAgainstReviewedEvidence].map((v,i)=>
            <td key={i} style={{padding:8,borderBottom:"1px solid #eee"}}>{v}</td>)}
        </tr>)}</tbody>
      </table>
      <p>{statement.warning}</p>
      <button disabled={!statement.rows.length||statement.truncated} onClick={exportCsv}>
        Export invoice statement CSV</button>
    </section>}
  </details>
  </main>;
}
