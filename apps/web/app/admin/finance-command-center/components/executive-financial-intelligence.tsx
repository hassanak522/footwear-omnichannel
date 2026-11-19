"use client";

import {useEffect,useState} from "react";
import Link from "next/link";

type Location={
 id:string;
 name:string;
 code?:string;
};

type RecordData=Record<string,unknown>;

type SupplierOverview={
 pendingRequests:{count:number;amount:string};
 approvedRequests:{count:number;amount:string};
 recordedSettlementEvidence:{count:number;amount:string};
 stagedPostingBatches:number;
 registeredPeriodLocks:number;
 warning?:string;
};

type RetailCases={
 total:number;
 rows:Array<{status:string}>;
 truncated:boolean;
};

type FinanceExceptions={
 items:Array<{type:string;amount:string}>;
 truncated:boolean;
 warning?:string;
};

type Workflow={
 openCases:unknown[];
 pendingPaymentRequestCount:number;
 recentPeriodLocks:unknown[];
 truncated:boolean;
 warning?:string;
};

type ComparisonRow={
 locationId:string;
 snapshotDate:string|null;
 pendingCount:number;
 pendingAmount:string;
 approvedCount:number;
 approvedAmount:string;
 recordedSettlementAmount:string;
};

type Comparison={
 from:string;
 to:string;
 rows:ComparisonRow[];
 truncated:boolean;
 warning?:string;
};

type Results={
 supplier:SupplierOverview|null;
 cases:RetailCases|null;
 exceptions:FinanceExceptions|null;
 workflow:Workflow|null;
 comparison:Comparison|null;
};

const empty:Results={
 supplier:null,
 cases:null,
 exceptions:null,
 workflow:null,
 comparison:null
};

function record(value:unknown):value is RecordData{
 return value!==null &&
  typeof value==="object" &&
  !Array.isArray(value);
}

function validLocations(value:unknown):Location[]{
 const input=Array.isArray(value)
  ?value
  :record(value)&&Array.isArray(value.locations)
   ?value.locations
   :record(value)&&Array.isArray(value.rows)
    ?value.rows
    :[];

 return input.filter((x:unknown):x is Location=>
  record(x)&&typeof x.id==="string"&&
  typeof x.name==="string"
 );
}

function amount(value:unknown):string{
 if(typeof value!=="string"&&typeof value!=="number"){
  return "Unavailable";
 }

 const text=String(value).trim();

 if(!/^-?\d+(\.\d+)?$/.test(text)){
  return "Unavailable";
 }

 const number=Number(text);

 if(!Number.isFinite(number)){
  return "Unavailable";
 }

 return "PKR "+new Intl.NumberFormat("en-PK",{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 }).format(number);
}

function count(value:unknown):string{
 return typeof value==="number"&&
  Number.isFinite(value)
  ?new Intl.NumberFormat("en-PK").format(value)
  :"Unavailable";
}

function dateToday(){
 const d=new Date();
 const y=d.getFullYear();
 const m=String(d.getMonth()+1).padStart(2,"0");
 const day=String(d.getDate()).padStart(2,"0");
 return `${y}-${m}-${day}`;
}

function monthStart(){
 return dateToday().slice(0,7)+"-01";
}

function Kpi({
 label,value,note,href
}:{
 label:string;
 value:string;
 note:string;
 href:string;
}){
 return (
  <Link href={href} style={{
   display:"block",
   textDecoration:"none",
   color:"#0f172a",
   border:"1px solid #dbe3ed",
   background:"#ffffff",
   borderRadius:10,
   padding:16,
   minWidth:0
  }}>
   <div style={{
    fontSize:12,color:"#64748b",marginBottom:8
   }}>{label}</div>
   <div style={{
    fontSize:22,fontWeight:700,color:"#104c72",
    overflowWrap:"anywhere"
   }}>{value}</div>
   <div style={{
    fontSize:11,color:"#64748b",
    lineHeight:1.6,marginTop:9
   }}>{note}</div>
  </Link>
 );
}

async function getJson(url:string):Promise<unknown>{
 const response=await fetch(url,{
  method:"GET",
  credentials:"include",
  cache:"no-store"
 });

 if(!response.ok){
  throw new Error("HTTP "+response.status);
 }

 return response.json();
}

export default function ExecutiveFinancialIntelligence(){

 const [locations,setLocations]=useState<Location[]>([]);
 const [selected,setSelected]=useState<string[]>([]);
 const [from,setFrom]=useState(monthStart);
 const [to,setTo]=useState(dateToday);
 const [loading,setLoading]=useState(false);
 const [results,setResults]=useState<Results>(empty);
 const [errors,setErrors]=useState<string[]>([]);
 const [loaded,setLoaded]=useState(false);
 const [reportScope,setReportScope]=useState("");
 const [reportPeriod,setReportPeriod]=useState("");

 useEffect(()=>{
  let active=true;

  void getJson("/api/v1/inventory/locations")
   .then(value=>{
    if(active)setLocations(validLocations(value));
   })
   .catch(()=>{
    if(active)setErrors([
     "Unable to load authorized locations. Check your session and access."
    ]);
   });

  return ()=>{active=false};
 },[]);

 function toggle(id:string){
  setSelected(old=>
   old.includes(id)
    ?old.filter(x=>x!==id)
    :[...old,id]
  );
 }

 async function load(){

  if(!selected.length){
   setErrors(["Select at least one authorized location."]);
   return;
  }

  if(!from||!to||from>to){
   setErrors(["Enter a valid reporting period."]);
   return;
  }

  const days=(Date.parse(to+"T00:00:00Z")-
   Date.parse(from+"T00:00:00Z"))/86400000;

  if(!Number.isFinite(days)||days>366){
   setErrors(["Reporting period must not exceed 366 days."]);
   return;
  }

  setLoading(true);
  setLoaded(false);
  setErrors([]);
  setResults(empty);

  const primary=selected[0];
  const query="locationId="+encodeURIComponent(primary);
  const comparisonQuery=new URLSearchParams({
   locationIds:selected.join(","),
   from,to
  });

  const requests=[
   "/api/v1/finance-reconciliation/hq-overview?"+query,
   "/api/v1/pos/finance/cases?"+query,
   "/api/v1/finance-operations/exceptions?"+query,
   "/api/v1/finance-command-center/workflow?"+query,
   "/api/v1/finance-operations/compare?"+
    comparisonQuery.toString()
  ];

  const names=[
   "Supplier overview",
   "Retail cases",
   "Finance exceptions",
   "Finance workflow",
   "Period comparison"
  ];

  const responses=await Promise.allSettled(
   requests.map(getJson)
  );

  const failures:string[]=[];

  responses.forEach((r,i)=>{
   if(r.status==="rejected"){
    failures.push(names[i]+": "+
     (r.reason instanceof Error
      ?r.reason.message:"Unavailable"));
   }
  });

  const value=(index:number):unknown=>{
   const r=responses[index];
   return r.status==="fulfilled"?r.value:null;
  };

  const supplier=value(0);
  const cases=value(1);
  const exceptions=value(2);
  const workflow=value(3);
  const comparison=value(4);

  setResults({
   supplier:record(supplier)
    ?supplier as SupplierOverview:null,
   cases:record(cases)
    ?cases as RetailCases:null,
   exceptions:record(exceptions)
    ?exceptions as FinanceExceptions:null,
   workflow:record(workflow)
    ?workflow as Workflow:null,
   comparison:record(comparison)
    ?comparison as Comparison:null
  });

  setReportScope(selected.map(id=>
   locations.find(x=>x.id===id)?.name||id
  ).join(", "));
  setReportPeriod(from+" to "+to);
  setErrors(failures);
  setLoaded(true);
  setLoading(false);
 }

 const supplier=results.supplier;
 const cases=results.cases;
 const exceptions=results.exceptions;
 const workflow=results.workflow;
 const comparison=results.comparison;

 const openRetailCases=cases&&Array.isArray(cases.rows)
  ?cases.rows.filter(x=>
    x.status==="OPEN"||x.status==="INVESTIGATING"
   ).length
  :null;

 const casesIncomplete=cases?.truncated===true;

 const exceptionCount=exceptions&&Array.isArray(exceptions.items)
  ?exceptions.items.length:null;

 return (
  <section style={{
   border:"1px solid #dbe3ed",
   background:"#f8fafc",
   borderRadius:12,
   padding:20,
   margin:"24px 0"
  }}>
   <header style={{marginBottom:18}}>
    <h2 style={{
     fontSize:22,color:"#104c72",margin:"0 0 6px"
    }}>
     Executive Financial Intelligence
    </h2>
    <p style={{
     color:"#64748b",fontSize:13,lineHeight:1.7,
     margin:0
    }}>
     Verified financial definitions from existing APIs.
     All reports are read-only. Supplier settlement
     evidence is not bank-confirmed payment.
    </p>
   </header>

   <div style={{
    background:"#ffffff",
    border:"1px solid #e2e8f0",
    borderRadius:10,
    padding:15,
    marginBottom:18
   }}>
    <strong style={{fontSize:13}}>
     Authorized locations
    </strong>

    <p style={{
     color:"#64748b",fontSize:11,margin:"6px 0 12px"
    }}>
     The first selected location is used for
     current supplier and exception KPIs.
     All selected locations are used for
     the period comparison.
    </p>

    <div style={{
     display:"flex",flexWrap:"wrap",gap:12,
     marginBottom:14
    }}>
     {locations.map(location=>(
      <label key={location.id} style={{
       display:"flex",gap:6,alignItems:"center",
       fontSize:12
      }}>
       <input
        type="checkbox"
        checked={selected.includes(location.id)}
        onChange={()=>toggle(location.id)}
       />
       {location.name}
      </label>
     ))}
    </div>

    <div style={{
     display:"flex",gap:12,flexWrap:"wrap",
     alignItems:"end"
    }}>
     <label style={{fontSize:12}}>
      Period from (UTC)
      <input type="date" value={from}
       onChange={e=>setFrom(e.target.value)}
       style={{display:"block",padding:8}}/>
     </label>

     <label style={{fontSize:12}}>
      Period to (UTC)
      <input type="date" value={to}
       onChange={e=>setTo(e.target.value)}
       style={{display:"block",padding:8}}/>
     </label>

     <button
      type="button"
      disabled={loading||!selected.length}
      onClick={()=>void load()}
      style={{
       background:"#104c72",color:"white",
       border:0,borderRadius:8,padding:"10px 18px",
       cursor:"pointer"
      }}
     >
      {loading?"Loading...":"Load Executive Intelligence"}
     </button>
    </div>
   </div>

   {errors.length>0&&(
    <div role="status" style={{
     color:"#9a3412",fontSize:12,marginBottom:16
    }}>
     {errors.map((e,i)=><p key={i}>{e}</p>)}
    </div>
   )}

   {loaded&&(
    <>
     <p style={{fontSize:12,color:"#475569"}}>
      <strong>Loaded locations:</strong> {reportScope}
     </p>
     <p style={{fontSize:12,color:"#475569"}}>
      <strong>Comparison period:</strong> {reportPeriod}
     </p>

     <h3 style={{color:"#104c72",marginTop:22}}>
      Supplier Finance — Current Overview
     </h3>

     <p style={{fontSize:12,color:"#64748b"}}>
      These values are current location-level aggregates,
      not filtered by the comparison dates.
     </p>

     {supplier?(
      <div style={{
       display:"grid",
       gridTemplateColumns:
        "repeat(auto-fit,minmax(205px,1fr))",
       gap:12
      }}>
       <Kpi
        label="Pending Payment Requests"
        value={amount(supplier.pendingRequests?.amount)}
        note={count(supplier.pendingRequests?.count)+
         " pending requests"}
        href="/admin/finance-reconciliation"
       />
       <Kpi
        label="Approved Payment Requests"
        value={amount(supplier.approvedRequests?.amount)}
        note={count(supplier.approvedRequests?.count)+
         " approved requests"}
        href="/admin/finance-reconciliation"
       />
       <Kpi
        label="Recorded Settlement Evidence"
        value={amount(supplier.recordedSettlementEvidence?.amount)}
        note="User-recorded evidence; not bank verified"
        href="/admin/finance-reconciliation"
       />
       <Kpi
        label="Staged Posting Batches"
        value={count(supplier.stagedPostingBatches)}
        note="Pending accounting posting workflow"
        href="/admin/finance-controls"
       />
       <Kpi
        label="Registered Period Locks"
        value={count(supplier.registeredPeriodLocks)}
        note="Registered locks; not proof of universal enforcement"
        href="/admin/finance-controls"
       />
      </div>
     ):(
      <p>Supplier overview unavailable.</p>
     )}

     <h3 style={{color:"#104c72",marginTop:25}}>
      Financial Investigations
     </h3>

     <div style={{
      display:"grid",
      gridTemplateColumns:
       "repeat(auto-fit,minmax(205px,1fr))",
      gap:12
     }}>
      <Kpi
       label="Retail Finance Cases"
       value={count(cases?.total)}
       note="Total retail-origin cases, all statuses"
       href="/admin/retail-finance/cases"
      />
      <Kpi
       label="Open / Investigating Retail Cases"
       value={openRetailCases===null
        ?"Unavailable":casesIncomplete
         ?count(openRetailCases)+"+"
         :count(openRetailCases)}
       note={casesIncomplete
        ?"At least this many in the latest 100 cases"
        :"Open or investigating retail cases"}
       href="/admin/retail-finance/cases"
      />
      <Kpi
       label="Supplier Finance Exceptions"
       value={count(exceptionCount)}
       note={exceptions?.truncated
        ?"Partial queue; source record limit reached"
        :"Disputed, unreviewed or over-reserved items"}
       href="/admin/finance-operations"
      />
      <Kpi
       label="Open Supplier Finance Cases"
       value={workflow
        ?count(workflow.openCases?.length)
        :"Unavailable"}
       note={workflow?.truncated
        ?"Partial workflow list"
        :"Open and investigating cases"}
       href="/admin/finance-casework"
      />
      <Kpi
       label="Pending Supplier Payment Requests"
       value={count(workflow?.pendingPaymentRequestCount)}
       note="Current workflow count"
       href="/admin/finance-reconciliation"
      />
     </div>

     <h3 style={{color:"#104c72",marginTop:25}}>
      Supplier Finance — Period Comparison
     </h3>

     <p style={{fontSize:12,color:"#64748b"}}>
      Pending and approved amounts below are requests
      created in the selected period. Recorded settlement
      evidence uses settlement dates. These are different
      populations and must not be added together.
     </p>

     {comparison&&Array.isArray(comparison.rows)?(
      <div style={{overflowX:"auto"}}>
       <table style={{
        borderCollapse:"collapse",
        width:"100%",fontSize:12,
        background:"#ffffff"
       }}>
        <thead>
         <tr>
          {[
           "Location",
           "Pending requests",
           "Pending amount",
           "Approved requests",
           "Approved amount",
           "Settlement evidence"
          ].map(x=>(
           <th key={x} style={{
            textAlign:"left",padding:10,
            borderBottom:"1px solid #cbd5e1"
           }}>{x}</th>
          ))}
         </tr>
        </thead>
        <tbody>
         {comparison.rows.map(row=>(
          <tr key={row.locationId}>
           <td style={{padding:10}}>
            {locations.find(x=>x.id===row.locationId)
             ?.name||row.locationId}
           </td>
           <td style={{padding:10}}>
            {count(row.pendingCount)}
           </td>
           <td style={{padding:10}}>
            {amount(row.pendingAmount)}
           </td>
           <td style={{padding:10}}>
            {count(row.approvedCount)}
           </td>
           <td style={{padding:10}}>
            {amount(row.approvedAmount)}
           </td>
           <td style={{padding:10}}>
            {amount(row.recordedSettlementAmount)}
           </td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     ):(
      <p>Period comparison unavailable.</p>
     )}

     <div style={{
      fontSize:12,color:"#64748b",
      lineHeight:1.7,marginTop:20
     }}>
      <strong>Reporting limitations</strong>
      <p>
       No automatic net profit, company-wide revenue,
       or cash balance is calculated here.
       Results are restricted by backend authorization
       and the selected reporting scope.
      </p>
      {supplier?.warning&&<p>{supplier.warning}</p>}
      {exceptions?.warning&&<p>{exceptions.warning}</p>}
      {workflow?.warning&&<p>{workflow.warning}</p>}
      {comparison?.warning&&<p>{comparison.warning}</p>}
      {casesIncomplete&&<p>
       Retail case status counts cover only the returned
       page; the total case count is provided separately.
      </p>}
     </div>
    </>
   )}
  </section>
 );
}