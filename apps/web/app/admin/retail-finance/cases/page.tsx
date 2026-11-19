"use client";


import {useEffect,useState} from "react";
import Link from "next/link";

type BranchLocation={
 id:string;
 code:string;
 name:string;
 type?:string;
};

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
 const [branches,setBranches]=useState<BranchLocation[]>([]);
 const [branchesLoading,setBranchesLoading]=useState(true);
 const [branchesError,setBranchesError]=useState("");
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

 useEffect(()=>{
  let active=true;

  async function loadBranches(){
   try{
    const response=await fetch(
     "/api/v1/inventory/locations",
     {
      credentials:"include",
      cache:"no-store"
     }
    );

    const data=await response.json().catch(()=>null);

    if(!response.ok){
     throw new Error(
      Array.isArray(data?.message)
       ?data.message.join(", ")
       :data?.message||
        "Unable to load branches (HTTP "+
        response.status+")."
     );
    }

    const items=Array.isArray(data)
     ?data
     :Array.isArray(data?.locations)
      ?data.locations
      :Array.isArray(data?.data)
       ?data.data
       :[];

    const result=items
     .filter((item:any)=>
      item &&
      typeof item.id==="string" &&
      item.type==="BRANCH" &&
      item.active!==false
     )
     .map((item:any)=>({
      id:item.id,
      code:String(item.code||""),
      name:String(item.name||item.code||"Branch"),
      type:item.type
     })) as BranchLocation[];

    if(active){
     setBranches(result);
    }
   }catch(e){
    if(active){
     setBranchesError(
      e instanceof Error?e.message:String(e)
     );
    }
   }finally{
    if(active){
     setBranchesLoading(false);
    }
   }
  }

  void loadBranches();

  return ()=>{active=false;};
 },[]);

 function branchName(id:string){
  const branch=branches.find(b=>b.id===id);

  return branch
   ?branch.code+" — "+branch.name
   :id.slice(0,8)+"…";
 }

 function statusName(value:string){
  const labels:Record<string,string>={
   OPEN:"Open",
   INVESTIGATING:"Under Investigation",
   RESOLVED:"Resolved",
   DISMISSED:"Dismissed"
  };

  return labels[value]||value;
 }
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
  if(branchesLoading||branchesError){
   setError("Authorized branches are not available.");
   return;
  }

  if(!locationId||!branches.some(b=>b.id===locationId)){
   setError("Select an authorized branch before creating a case.");
   return;
  }
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
  margin:"0 auto",
  padding:20,
  fontFamily:"system-ui"
 }}>


  <Link href="/admin/retail-finance/historical">
   Finance Reports
  </Link>

  <div style={{
 color:"#ef3321",
 fontSize:12,
 fontWeight:700,
 letterSpacing:1,
 marginTop:18
}}>
 ROYAL STEP / FINANCE
</div>

<h1 style={{
 color:"#104c72",
 fontSize:28,
 margin:"8px 0 14px"
}}>
 Retail Finance Investigations
</h1>
  <p style={{
   padding:"12px 15px",
   border:"1px solid #dbe3ed",
   borderRadius:8,
   background:"#f8fafc",
   marginBottom:18
  }}>
   Review the selected branch and source records
   before creating an investigation.
   Enter a summary to create a case, or use the case
   register to review existing investigations.
  </p>
  <p>
   Investigate retail refund and shift-closing discrepancies.
   Case resolution does not change financial records.
  </p>

  <section style={panel}>
   <h2 style={{color:"#104c72"}}>Investigation Register</h2>
   <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
    <select
     style={inputStyle}
     aria-label="Select retail branch"
     value={locationId}
     disabled={branchesLoading||busy}
     onChange={e=>setLocationId(e.target.value)}
    >
     <option value="">All authorized branches</option>

     {locationId&&!branches.some(b=>b.id===locationId)&&
      <option value={locationId}>
       Linked branch ({locationId.slice(0,8)}…)
      </option>
     }

     {branches.map(branch=>
      <option key={branch.id} value={branch.id}>
       {branch.code} — {branch.name}
      </option>
     )}
    </select>
    <select
     style={inputStyle}
     value={status}
     onChange={e=>setStatus(e.target.value)}
    >
     <option value="">All statuses</option>
     {["OPEN","INVESTIGATING","RESOLVED","DISMISSED"]
      .map(s=><option key={s} value={s}>{statusName(s)}</option>)}
    </select>
    <button disabled={busy} onClick={load}>
     View Investigations
    </button>
   </div>

   {branchesLoading&&
 <p style={{color:"#64748b"}}>
  Loading authorized branches…
 </p>
}

{branchesError&&
 <p role="alert" style={{color:"#b91c1c"}}>
  {branchesError}
 </p>
}

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
       <td style={{padding:8}}>{branchName(r.locationId)}</td>
       <td style={{padding:8}}>{r.sourceType}</td>
       <td style={{padding:8}}>{statusName(r.status)}</td>
       <td style={{padding:8}}>{r.summary}</td>
       <td style={{padding:8}}>
        <button onClick={()=>openCase(r.id)}>View Details</button>
       </td>
      </tr>)}
     </tbody>
    </table>
   </div>
  </section>

  <section style={panel}>
   <h2 style={{color:"#104c72"}}>Create Investigation</h2>
   <p>Select the relevant branch above before creating a case.</p>
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
   <h2 style={{color:"#104c72"}}>Investigation Details</h2>
   <p><strong>Case:</strong> {selected.id}</p>
   <p><strong>Status:</strong> {statusName(selected.status)}</p>
   <p><strong>Branch:</strong> {branchName(selected.locationId)}</p>
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

   <h3 style={{color:"#104c72"}}>Investigation History</h3>
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