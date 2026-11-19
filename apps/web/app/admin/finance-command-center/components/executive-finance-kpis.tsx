"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";

type JsonValue =
 | string
 | number
 | boolean
 | null
 | JsonValue[]
 | {[key:string]:JsonValue};

type ReportResult={
 key:string;
 title:string;
 description:string;
 href:string;
 data:JsonValue|null;
 error:string|null;
 loading:boolean;
};

type ReportDefinition={
 key:string;
 title:string;
 description:string;
 href:string;
 endpoint:(locationId:string,from:string,to:string)=>string|null;
};

type NumericMetric={
 path:string;
 value:number;
};

const definitions:ReportDefinition[]=[
 {
  key:"retail-history",
  title:"Historical Retail Finance",
  description:"Branch financial history for the selected reporting period.",
  href:"/admin/retail-finance/historical",
  endpoint:(locationId,from,to)=>{
   const q=new URLSearchParams();
   if(locationId)q.set("locationId",locationId);
   if(from)q.set("from",from);
   if(to)q.set("to",to);
   return "/api/v1/pos/finance/historical-summary?"+q.toString();
  }
 },
 {
  key:"retail-recent",
  title:"Recent Retail Finance",
  description:"Recent branch shift closing and refund settlement reporting.",
  href:"/admin/retail-finance",
  endpoint:(locationId)=>{
   if(!locationId)return null;
   return "/api/v1/pos/finance/retail-summary?locationId="+
    encodeURIComponent(locationId);
  }
 },
 {
  key:"retail-cases",
  title:"Retail Exception Cases",
  description:"Retail financial investigations and case statuses.",
  href:"/admin/retail-finance/cases",
  endpoint:(locationId)=>{
   if(!locationId)return null;
   return "/api/v1/pos/finance/cases?locationId="+
    encodeURIComponent(locationId);
  }
 },
 {
  key:"supplier-reconciliation",
  title:"Supplier Reconciliation",
  description:"Supplier invoice and settlement reconciliation data.",
  href:"/admin/finance-reconciliation",
  endpoint:(locationId)=>{
   if(!locationId)return null;
   return "/api/v1/finance-reconciliation/hq-overview?locationId="+
    encodeURIComponent(locationId);
  }
 },
 {
  key:"branch-comparison",
  title:"Financial Branch Comparison",
  description:"Existing financial operations branch comparison report.",
  href:"/admin/finance-operations",
  endpoint:(locationId,from,to)=>{
   if(!locationId)return null;
   const q=new URLSearchParams();
   q.set("locationIds",locationId);
   if(from)q.set("from",from);
   if(to)q.set("to",to);
   return "/api/v1/finance-operations/compare?"+q.toString();
  }
 }
];

function todayUtc(){
 return new Date().toISOString().slice(0,10);
}

function firstDayUtc(){
 const d=new Date();
 return new Date(
  Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)
 ).toISOString().slice(0,10);
}

function isRecord(value:JsonValue):
 value is {[key:string]:JsonValue}{
 return value!==null &&
  typeof value==="object" &&
  !Array.isArray(value);
}

function extractMetrics(
 value:JsonValue,
 prefix="",
 depth=0,
 result:NumericMetric[]=[]
):NumericMetric[]{

 if(result.length>=36 || depth>3)return result;

 if(typeof value==="number" && Number.isFinite(value)){
  result.push({
   path:prefix||"value",
   value
  });
  return result;
 }

 if(Array.isArray(value)){
  return result;
 }

 if(isRecord(value)){
  for(const [key,child] of Object.entries(value)){
   if(result.length>=36)break;

   const path=prefix?prefix+"."+key:key;

   if(typeof child==="number" && Number.isFinite(child)){
    result.push({path,value:child});
   }else if(isRecord(child)){
    extractMetrics(child,path,depth+1,result);
   }
  }
 }

 return result;
}

function formatValue(value:number){
 return new Intl.NumberFormat("en-PK",{
  maximumFractionDigits:2
 }).format(value);
}

function ReportCard({report}:{
 report:ReportResult;
}){

 const metrics=useMemo(
  ()=>report.data===null?[]:extractMetrics(report.data),
  [report.data]
 );

 return (
  <section style={{
   background:"#ffffff",
   border:"1px solid #dbe3ed",
   borderRadius:12,
   padding:17,
   minWidth:0
  }}>
   <div style={{
    display:"flex",
    justifyContent:"space-between",
    alignItems:"flex-start",
    gap:12,
    flexWrap:"wrap"
   }}>
    <div>
     <h3 style={{
      color:"#104c72",
      fontSize:16,
      margin:"0 0 5px"
     }}>
      {report.title}
     </h3>

     <p style={{
      fontSize:12,
      color:"#64748b",
      lineHeight:1.6,
      margin:"0 0 12px"
     }}>
      {report.description}
     </p>
    </div>

    <Link href={report.href} style={{
     color:"#104c72",
     fontSize:12,
     fontWeight:600
    }}>
     Open module
    </Link>
   </div>

   {report.loading?(
    <p role="status">Loading financial report...</p>
   ):report.error?(
    <p role="status" style={{
     color:"#9a3412",
     fontSize:12
    }}>
     {report.error}
    </p>
   ):report.data===null?(
    <p style={{fontSize:12,color:"#64748b"}}>
     Select a branch and load the report.
    </p>
   ):(
    <>
     {metrics.length>0?(
      <div style={{
       display:"grid",
       gridTemplateColumns:
        "repeat(auto-fit,minmax(135px,1fr))",
       gap:9
      }}>
       {metrics.map(metric=>(
        <div key={metric.path} style={{
         border:"1px solid #e2e8f0",
         borderRadius:8,
         padding:11,
         background:"#f8fafc",
         minWidth:0
        }}>
         <div style={{
          fontSize:11,
          color:"#64748b",
          overflowWrap:"anywhere"
         }}>
          {metric.path}
         </div>

         <div style={{
          fontSize:19,
          fontWeight:700,
          color:"#104c72",
          marginTop:5,
          overflowWrap:"anywhere"
         }}>
          {formatValue(metric.value)}
         </div>
        </div>
       ))}
      </div>
     ):(
      <p style={{fontSize:12,color:"#64748b"}}>
       No top-level numerical KPI fields were returned.
      </p>
     )}

     <details style={{marginTop:13}}>
      <summary style={{
       cursor:"pointer",
       color:"#104c72",
       fontSize:12
      }}>
       View original API report
      </summary>

      <pre style={{
       whiteSpace:"pre-wrap",
       overflowWrap:"anywhere",
       background:"#f1f5f9",
       padding:12,
       borderRadius:8,
       fontSize:11,
       maxHeight:400,
       overflow:"auto"
      }}>
       {JSON.stringify(report.data,null,2)}
      </pre>
     </details>
    </>
   )}
  </section>
 );
}

export default function ExecutiveFinanceKpis(){

 const [locations,setLocations]=useState<
  Array<{id:string;name:string;type?:string}>
 >([]);

 const [locationId,setLocationId]=useState("");
 const [from,setFrom]=useState(firstDayUtc);
 const [to,setTo]=useState(todayUtc);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");

 const [reports,setReports]=useState<ReportResult[]>(
  definitions.map(d=>({
   key:d.key,
   title:d.title,
   description:d.description,
   href:d.href,
   data:null,
   error:null,
   loading:false
  }))
 );

 useEffect(()=>{
  let cancelled=false;

  async function loadLocations(){
   try{
    const response=await fetch(
     "/api/v1/inventory/locations",
     {credentials:"include",cache:"no-store"}
    );

    if(!response.ok){
     throw new Error("HTTP "+response.status);
    }

    const result:unknown=await response.json();

    if(!Array.isArray(result)){
     throw new Error("Unexpected location response");
    }

    const list=result.filter(
     (item):item is {
      id:string;
      name:string;
      type?:string;
     }=>
      item!==null &&
      typeof item==="object" &&
      typeof item.id==="string" &&
      typeof item.name==="string"
    );

    if(!cancelled){
     setLocations(list);
    }
   }catch(error){
    if(!cancelled){
     setMessage(
      error instanceof Error
       ?error.message
       :"Unable to load locations"
     );
    }
   }
  }

  void loadLocations();

  return ()=>{cancelled=true;};
 },[]);

 const load=useCallback(async()=>{

  if(!locationId){
   setMessage("Select a branch or warehouse location.");
   return;
  }

  if(from>to){
   setMessage("The start date must not exceed the end date.");
   return;
  }

  setBusy(true);
  setMessage("");

  setReports(definitions.map(d=>({
   key:d.key,
   title:d.title,
   description:d.description,
   href:d.href,
   data:null,
   error:null,
   loading:true
  })));

  const results=await Promise.all(
   definitions.map(async definition=>{

    const endpoint=definition.endpoint(locationId,from,to);

    if(!endpoint){
     return {
      key:definition.key,
      title:definition.title,
      description:definition.description,
      href:definition.href,
      data:null,
      error:"Required report parameters are unavailable.",
      loading:false
     } as ReportResult;
    }

    try{
     const response=await fetch(endpoint,{
      credentials:"include",
      cache:"no-store"
     });

     const data:JsonValue=await response.json();

     if(!response.ok){
      throw new Error(
       "API returned HTTP "+response.status
      );
     }

     return {
      key:definition.key,
      title:definition.title,
      description:definition.description,
      href:definition.href,
      data,
      error:null,
      loading:false
     } as ReportResult;

    }catch(error){

     return {
      key:definition.key,
      title:definition.title,
      description:definition.description,
      href:definition.href,
      data:null,
      error:error instanceof Error
       ?error.message
       :"Report unavailable",
      loading:false
     } as ReportResult;

    }
   })
  );

  setReports(results);
  setBusy(false);

 },[locationId,from,to]);

 return (
  <section
   aria-label="Executive financial KPI reports"
   style={{
    margin:"25px 0 30px",
    padding:20,
    background:"#f8fafc",
    border:"1px solid #dbe3ed",
    borderRadius:12
   }}
  >
   <header style={{marginBottom:18}}>
    <h2 style={{
     fontSize:21,
     color:"#104c72",
     margin:"0 0 6px"
    }}>
     Executive Financial KPI Reports
    </h2>

    <p style={{
     fontSize:12,
     color:"#64748b",
     lineHeight:1.7,
     margin:0
    }}>
     Read-only financial reporting from existing
     Royal Step APIs. Each report retains its own
     accounting definition. Values from different
     reports are not added together.
    </p>
   </header>

   <div style={{
    display:"flex",
    flexWrap:"wrap",
    alignItems:"end",
    gap:12,
    marginBottom:18
   }}>
    <label style={{
     display:"flex",
     flexDirection:"column",
     gap:5,
     fontSize:12
    }}>
     Branch / Location
     <select
      value={locationId}
      onChange={e=>setLocationId(e.target.value)}
      style={{padding:9,minWidth:220}}
     >
      <option value="">Select location</option>

      {locations.map(location=>(
       <option key={location.id} value={location.id}>
        {location.name}
       </option>
      ))}
     </select>
    </label>

    <label style={{
     display:"flex",
     flexDirection:"column",
     gap:5,
     fontSize:12
    }}>
     From (UTC)
     <input
      type="date"
      value={from}
      onChange={e=>setFrom(e.target.value)}
      style={{padding:9}}
     />
    </label>

    <label style={{
     display:"flex",
     flexDirection:"column",
     gap:5,
     fontSize:12
    }}>
     To (UTC)
     <input
      type="date"
      value={to}
      onChange={e=>setTo(e.target.value)}
      style={{padding:9}}
     />
    </label>

    <button
     type="button"
     disabled={busy||!locationId}
     onClick={()=>void load()}
     style={{
      padding:"10px 18px",
      border:0,
      borderRadius:8,
      background:"#104c72",
      color:"#ffffff",
      cursor:"pointer"
     }}
    >
     {busy?"Loading...":"Load Financial KPIs"}
    </button>
   </div>

   {message&&(
    <p role="status" style={{
     color:"#9a3412",
     fontSize:12
    }}>
     {message}
    </p>
   )}

   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(310px,1fr))",
    gap:14
   }}>
    {reports.map(report=>(
     <ReportCard key={report.key} report={report}/>
    ))}
   </div>

   <p style={{
    fontSize:11,
    color:"#64748b",
    marginTop:17,
    lineHeight:1.6
   }}>
    Reporting note: A value is shown with its
    original API field name. Numeric fields are
    not automatically classified as currency,
    revenue, profit or liabilities. Date filters
    apply only to endpoints that support them.
   </p>
  </section>
 );
}