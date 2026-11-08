"use client";
import { useState } from "react";

type CaseEvent = {id:string;action:string;note:string;createdAt:string;actorId:string};
type CaseRow = {id:string;summary:string;status:string;sourceId:string;createdAt:string;events:CaseEvent[]};
type InvoiceRow = {invoiceId:string;invoiceNumber:string;invoiceDate:string;invoiceAmount:string;staffVerifiedEvidence:string;remainingAgainstEvidence:string};
type Alerts = {openCaseCount:number;disputedEvidenceCount:number;unreviewedEvidenceCount:number;truncated:boolean;warning:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function csvCell(value:unknown){
  let s=String(value??"");
  if(/^[=+\-@\t\r]/.test(s))s="'"+s;
  return `"${s.replace(/"/g,'""')}"`;
}
function exportCsv(name:string,headers:string[],rows:unknown[][]){
  const content=[headers.map(csvCell).join(","),...rows.map(row=>row.map(csvCell).join(","))].join("\r\n");
  const url=URL.createObjectURL(new Blob(["\uFEFF",content],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function FinanceCaseworkPage(){
  const [locationId,setLocationId]=useState("");
  const [cases,setCases]=useState<CaseRow[]>([]);
  const [invoices,setInvoices]=useState<InvoiceRow[]>([]);
  const [alerts,setAlerts]=useState<Alerts|null>(null);
  const [truncated,setTruncated]=useState({cases:false,invoices:false});
  const [settlementId,setSettlementId]=useState("");
  const [summary,setSummary]=useState("");
  const [note,setNote]=useState("");
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(false);
  async function request(path:string,init?:RequestInit){
    const res=await fetch(`/api/v1/finance-casework/${path}`,{
      credentials:"include",cache:"no-store",...init,
      headers:{"Content-Type":"application/json",...init?.headers}
    });
    const body=await res.json().catch(()=>null);
    if(!res.ok)throw new Error(body?.message instanceof Array?body.message.join("; "):
      body?.message??`HTTP ${res.status}. Check authenticated API proxy.`);
    return body;
  }
  async function refresh(){
    if(!uuid.test(locationId))throw new Error("Enter a valid location UUID");
    const q=`locationId=${encodeURIComponent(locationId)}`;
    const [c,i,a]=await Promise.all([
      request(`cases?${q}`),request(`invoice-register?${q}`),request(`alerts?${q}`)
    ]);
    setCases(c.cases??[]);setInvoices(i.rows??[]);setAlerts(a);
    setTruncated({cases:!!c.truncated,invoices:!!i.truncated});
  }
  async function load(){
    setError("");setMessage("");setLoading(true);
    try{await refresh();}catch(e){setError(e instanceof Error?e.message:"Request failed");}
    finally{setLoading(false);}
  }
  async function createCase(){
    setError("");setMessage("");
    if(!uuid.test(locationId)||!uuid.test(settlementId)||!summary.trim()){
      setError("Valid location and settlement UUIDs plus summary are required");return;
    }
    setLoading(true);
    try{
      await request("cases",{method:"POST",body:JSON.stringify({locationId,settlementId,summary})});
      setMessage("Case opened");setSummary("");setSettlementId("");await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not open case");}
    finally{setLoading(false);}
  }
  async function transition(id:string,status:"INVESTIGATING"|"RESOLVED"|"DISMISSED"){
    setError("");setMessage("");
    if(!note.trim()){setError("Enter a case note before changing status");return;}
    setLoading(true);
    try{
      await request(`cases/${encodeURIComponent(id)}/transition`,{
        method:"POST",body:JSON.stringify({status,note})
      });
      setNote("");setMessage(`Case moved to ${status}`);await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Could not update case");}
    finally{setLoading(false);}
  }
  const th={padding:9,textAlign:"left" as const,borderBottom:"1px solid #ccc"};
  const td={padding:9,borderBottom:"1px solid #e4e4e4",verticalAlign:"top" as const};
  return <main style={{maxWidth:1150,margin:"28px auto",padding:24,fontFamily:"system-ui"}}>
    <h1>HQ Finance Casework & Alerts</h1>
    <p>Operational case management and staff-entered financial evidence. Not bank-confirmed accounting.</p>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"end"}}>
      <label>Location UUID<input aria-label="Location UUID" value={locationId}
        onChange={e=>setLocationId(e.target.value)} placeholder="Location UUID"
        style={{display:"block",minWidth:320,padding:9}}/></label>
      <button disabled={loading} onClick={load}>{loading?"Loading…":"Load HQ data"}</button>
    </div>
    {error&&<p role="alert" style={{color:"crimson"}}>{error}</p>}
    {message&&<p role="status">{message}</p>}
    {alerts&&<section style={{marginTop:25}}>
      <h2>Financial alerts</h2>
      <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
        {([["Open cases",alerts.openCaseCount],["Disputed evidence",alerts.disputedEvidenceCount],
          ["Unreviewed evidence",alerts.unreviewedEvidenceCount]] as const).map(([label,value])=>
          <div key={label} style={{border:"1px solid #ddd",padding:18,borderRadius:8,minWidth:160}}>
            <strong>{label}</strong><p style={{fontSize:26,marginBottom:0}}>{value}</p>
          </div>)}
      </div>
      <p>{alerts.warning}{alerts.truncated?" WARNING: Alerts truncated.":""}</p>
    </section>}
    <section style={{marginTop:25}}>
      <h2>Open a settlement investigation</h2>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <input aria-label="Settlement UUID" placeholder="Settlement UUID" value={settlementId}
          onChange={e=>setSettlementId(e.target.value)} style={{padding:9,minWidth:300}}/>
        <input aria-label="Case summary" placeholder="Case summary" maxLength={500} value={summary}
          onChange={e=>setSummary(e.target.value)} style={{padding:9,minWidth:300}}/>
        <button disabled={loading} onClick={createCase}>Open case</button>
      </div>
    </section>
    <section style={{marginTop:25,overflowX:"auto"}}>
      <h2>Investigation cases</h2>
      <label>Note for status change<textarea value={note} maxLength={1000}
        onChange={e=>setNote(e.target.value)} style={{display:"block",width:"100%",maxWidth:650,minHeight:65}}/></label>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["Case","Status","Settlement","History","Actions"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{cases.map(c=><tr key={c.id}>
          <td style={td}>{c.summary}<div style={{fontSize:12}}>{c.id}</div></td>
          <td style={td}>{c.status}</td><td style={td}>{c.sourceId}</td>
          <td style={td}><details><summary>{c.events.length} events</summary>
            {c.events.map(e=><p key={e.id}>{e.action}: {e.note} ({e.createdAt})</p>)}
          </details></td>
          <td style={td}>{c.status==="OPEN"||c.status==="INVESTIGATING"?
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {c.status==="OPEN"&&<button disabled={loading} onClick={()=>transition(c.id,"INVESTIGATING")}>Investigate</button>}
              <button disabled={loading} onClick={()=>transition(c.id,"RESOLVED")}>Resolve</button>
              <button disabled={loading} onClick={()=>transition(c.id,"DISMISSED")}>Dismiss</button>
            </div>:"Closed"}</td>
        </tr>)}</tbody>
      </table>
      {truncated.cases&&<p role="alert">Case list truncated. Not a complete export.</p>}
    </section>
    <section style={{marginTop:25,overflowX:"auto"}}>
      <h2>Location invoice register</h2>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["Invoice","Date","Invoice amount","Reviewed evidence","Remaining"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{invoices.map(i=><tr key={i.invoiceId}>
          {[i.invoiceNumber,i.invoiceDate,i.invoiceAmount,i.staffVerifiedEvidence,i.remainingAgainstEvidence]
            .map((v,n)=><td key={n} style={td}>{v}</td>)}
        </tr>)}</tbody>
      </table>
      {truncated.invoices&&<p role="alert">Invoice register truncated. Export disabled.</p>}
      <button disabled={!invoices.length||truncated.invoices} onClick={()=>exportCsv(
        "royal-step-invoice-register.csv",
        ["Invoice ID","Invoice number","Invoice date","Invoice amount","Staff reviewed evidence","Remaining"],
        invoices.map(i=>[i.invoiceId,i.invoiceNumber,i.invoiceDate,i.invoiceAmount,
          i.staffVerifiedEvidence,i.remainingAgainstEvidence])
      )}>Export invoice register CSV</button>
    </section>
  </main>;
}
