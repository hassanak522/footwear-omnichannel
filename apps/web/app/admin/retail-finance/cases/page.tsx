"use client";
import RetailFinanceOperationsNav from '../components/retail-finance-operations-nav';

import {useEffect,useState} from "react";
import Link from "next/link";

type CaseRow={
 id:string;
 locationId:string;
 sourceType:string;
 sourceId:string;
 summary:string;
 status:string;
 assignedToId:string|null;
 updatedAt:string;
 resolutionNote:string|null;
};

type CaseEvent={
 id:string;
 action:string;
 actorId:string;
 note:string;
 createdAt:string;
};

const endpoint="/api/v1/pos/finance/cases";

async function call(path:string,options?:RequestInit){
 const response=await fetch(endpoint+path,{
  ...options,
  credentials:"include",
  cache:"no-store",
  headers:{
   "Content-Type":"application/json",
   ...options?.headers
  }
 });
 const data=await response.json().catch(()=>null);
 if(!response.ok){
  throw new Error(
   Array.isArray(data?.message)
    ?data.message.join(", ")
    :data?.message||`HTTP ${response.status}`
  );
 }
 return data;
}

const inputStyle={
 padding:10,
 border:"1px solid #cbd5e1",
 borderRadius:6,
 minWidth:230
};

export default function RetailCaseworkPage(){
 const [locationId,setLocationId]=useState("");
 const [status,setStatus]=useState("");
 const [rows,setRows]=useState<CaseRow[]>([]);
 const [total,setTotal]=useState(0);
 const [selected,setSelected]=useState<CaseRow|null>(null);
 const [events,setEvents]=useState<CaseEvent[]>([]);
 const [sourceType,setSourceType]=useState("POS_REFUND_SETTLEMENT");
 const [sourceId,setSourceId]=useState("");
 const [summary,setSummary]=useState("");
 const [assigneeId,setAssigneeId]=useState("");
 const [note,setNote]=useState("");
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);

  useEffect(()=>{
  const params=new URLSearchParams(window.location.search);

  const branch=params.get("locationId")||"";
  const source=params.get("sourceId")||"";
  const type=params.get("sourceType")||"";

  const validUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if(validUuid.test(branch)){
   setLocationId(branch);
  }

  if(validUuid.test(source)){
   setSourceId(source);
  }

  if(
   type==="POS_REFUND_SETTLEMENT"||
   type==="POS_SHIFT_CLOSING"
  ){
   setSourceType(type);
  }
 },[]);

 async function load(){
  setBusy(true);setError("");
  try{
   const p=new URLSearchParams();
   if(locationId.trim())p.set("locationId",locationId.trim());
   if(status)p.set("status",status);
   const data=await call("?"+p.toString());
   setRows(data.rows||[]);
   setTotal(data.total||0);
  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }finally{setBusy(false);}
 }

 async function openCase(id:string){
  try{
   const data=await call("/"+encodeURIComponent(id));
   setSelected(data.case);
   setEvents(data.events||[]);
  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }
 }

 async function create(){
  setBusy(true);setError("");setMessage("");
  try{
   await call("",{
    method:"POST",
    body:JSON.stringify({
     locationId,sourceType,sourceId,summary
    })
   });
   setMessage("Investigation case created");
   setSummary("");setSourceId("");
   await load();
  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }finally{setBusy(false);}
 }

 async function change(
  action:"assign"|"note"|"transition",
  next?:string
 ){
  if(!selected)return;
  setBusy(true);setError("");setMessage("");
  try{
   const payload=action==="assign"
    ?{assigneeId,note}
    :action==="transition"
     ?{status:next,note}
     :{note};

   await call(
    "/"+encodeURIComponent(selected.id)+"/"+action,
    {method:"POST",body:JSON.stringify(payload)}
   );

   setMessage("Case updated");
   setNote("");
   await openCase(selected.id);
   await load();
  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }finally{setBusy(false);}
 }

 const panel={
  padding:20,
  border:"1px solid #dbe3ed",
  borderRadius:10,
  marginBottom:20
 };

 return <main style={{
  maxWidth:1300,
  margin:"25px auto",
  padding:20,
  fontFamily:"system-ui"
 }}>
  <RetailFinanceOperationsNav />

  <Link href="/admin/retail-finance/historical">
   Historical retail finance
  </Link>

  <h1>Retail Finance Exception Management</h1>
  <p style={{
   padding:"12px 15px",
   border:"1px solid #dbe3ed",
   borderRadius:8,
   background:"#f8fafc",
   marginBottom:18
  }}>
   Review the prefilled branch and source identifiers
   before opening an investigation.
   Enter a summary to create a case, or use the case
   register to review existing investigations.
  </p>
  <p>
   Investigate retail refund and shift-closing discrepancies.
   Case resolution does not change financial records.
  </p>

  <section style={panel}>
   <h2>Case register</h2>
   <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
    <input
     style={inputStyle}
     placeholder="Branch UUID (blank for HQ)"
     aria-label="Branch UUID"
     value={locationId}
     onChange={e=>setLocationId(e.target.value)}
    />
    <select
     style={inputStyle}
     value={status}
     onChange={e=>setStatus(e.target.value)}
    >
     <option value="">All statuses</option>
     {["OPEN","INVESTIGATING","RESOLVED","DISMISSED"]
      .map(s=><option key={s}>{s}</option>)}
    </select>
    <button disabled={busy} onClick={load}>
     Load cases
    </button>
   </div>

   <p>Showing {rows.length} of {total} cases</p>

   <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",textAlign:"left"}}>
     <thead><tr>
      {["Case","Branch","Source","Status","Summary","Action"]
       .map(x=><th key={x} style={{padding:8}}>{x}</th>)}
     </tr></thead>
     <tbody>
      {rows.map(r=><tr key={r.id}>
       <td style={{padding:8}} title={r.id}>
        {r.id.slice(0,8)}
       </td>
       <td style={{padding:8}}>{r.locationId.slice(0,8)}</td>
       <td style={{padding:8}}>{r.sourceType}</td>
       <td style={{padding:8}}>{r.status}</td>
       <td style={{padding:8}}>{r.summary}</td>
       <td style={{padding:8}}>
        <button onClick={()=>openCase(r.id)}>Open</button>
       </td>
      </tr>)}
     </tbody>
    </table>
   </div>
  </section>

  <section style={panel}>
   <h2>Create investigation</h2>
   <p>Use the branch UUID entered in the register above.</p>
   <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
    <select
     style={inputStyle}
     value={sourceType}
     onChange={e=>setSourceType(e.target.value)}
    >
     <option value="POS_REFUND_SETTLEMENT">
      Refund settlement
     </option>
     <option value="POS_SHIFT_CLOSING">
      Shift closing
     </option>
    </select>
    <input
     style={inputStyle}
     placeholder="Source UUID"
     aria-label="Source UUID"
     value={sourceId}
     onChange={e=>setSourceId(e.target.value)}
    />
    <input
     style={inputStyle}
     placeholder="Case summary"
     aria-label="Case summary"
     maxLength={500}
     value={summary}
     onChange={e=>setSummary(e.target.value)}
    />
    <button disabled={busy} onClick={create}>
     Create case
    </button>
   </div>
  </section>

  {selected&&<section style={panel}>
   <h2>Investigation details</h2>
   <p><strong>Case:</strong> {selected.id}</p>
   <p><strong>Status:</strong> {selected.status}</p>
   <p><strong>Source:</strong> {selected.sourceId}</p>
   <p><strong>Assigned:</strong> {selected.assignedToId||"Unassigned"}</p>
   <p><strong>Summary:</strong> {selected.summary}</p>

   <input
    style={inputStyle}
    placeholder="Assignee manager UUID"
    aria-label="Assignee UUID"
    value={assigneeId}
    onChange={e=>setAssigneeId(e.target.value)}
   />

   <textarea
    style={{
     ...inputStyle,
     display:"block",
     width:"100%",
     margin:"12px 0"
    }}
    rows={3}
    maxLength={1000}
    placeholder="Investigation evidence or resolution reason"
    aria-label="Investigation note"
    value={note}
    onChange={e=>setNote(e.target.value)}
   />

   <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
    <button disabled={busy} onClick={()=>change("assign")}>
     Assign manager
    </button>
    <button disabled={busy} onClick={()=>change("note")}>
     Add evidence note
    </button>
    {selected.status==="OPEN"&&
     <button disabled={busy}
      onClick={()=>change("transition","INVESTIGATING")}>
      Start investigation
     </button>}
    {selected.status==="INVESTIGATING"&&
     <button disabled={busy}
      onClick={()=>change("transition","RESOLVED")}>
      Resolve case
     </button>}
    {["OPEN","INVESTIGATING"].includes(selected.status)&&
     <button disabled={busy}
      onClick={()=>change("transition","DISMISSED")}>
      Dismiss case
     </button>}
   </div>

   <h3>Case history</h3>
   {events.map(e=><div key={e.id}
    style={{borderBottom:"1px solid #eee",padding:10}}>
    <strong>{e.action}</strong>
    {" · "}{new Date(e.createdAt).toLocaleString()}
    <p>{e.note}</p>
   </div>)}
  </section>}

  {error&&<p role="alert" style={{color:"#b91c1c"}}>
   {error}
  </p>}
  {message&&<p role="status" style={{color:"#166534"}}>
   {message}
  </p>}
 </main>;
}