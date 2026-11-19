"use client";

import {useEffect,useState} from "react";
import Link from "next/link";
import ExecutiveFinancePriorities from "./executive-finance-priorities";

type Location={
 id:string;
 name:string;
};

type DataObject=Record<string,unknown>;

type ActionItem={
 id:string;
 title:string;
 description:string;
 category:string;
 href:string;
 createdAt?:string;
};

type ActionResults={
 pendingCount:number|null;
 pendingAmount:string|null;
 supplierCases:ActionItem[];
 retailCases:ActionItem[];
 exceptions:ActionItem[];
 agedAlerts:ActionItem[];
 notes:string[];
};

const initial:ActionResults={
 pendingCount:null,
 pendingAmount:null,
 supplierCases:[],
 retailCases:[],
 exceptions:[],
 agedAlerts:[],
 notes:[]
};

function object(value:unknown):value is DataObject{
 return value!==null&&
  typeof value==="object"&&
  !Array.isArray(value);
}

function string(value:unknown):string{
 return typeof value==="string"?value:"";
}

function number(value:unknown):number|null{
 return typeof value==="number"&&
  Number.isFinite(value)?value:null;
}

function money(value:unknown):string{
 if(typeof value!=="string"&&typeof value!=="number"){
  return "Unavailable";
 }

 const text=String(value).trim();

 if(!/^-?\d+(\.\d+)?$/.test(text)){
  return "Unavailable";
 }

 const n=Number(text);

 if(!Number.isFinite(n)){
  return "Unavailable";
 }

 return "PKR "+new Intl.NumberFormat("en-PK",{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 }).format(n);
}

function locationsFrom(value:unknown):Location[]{
 const rows=Array.isArray(value)
  ?value
  :object(value)&&Array.isArray(value.locations)
   ?value.locations
   :object(value)&&Array.isArray(value.rows)
    ?value.rows
    :[];

 return rows.filter((x:unknown):x is Location=>
  object(x)&&
  typeof x.id==="string"&&
  typeof x.name==="string"
 );
}

async function read(url:string):Promise<unknown>{
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

function item(
 value:unknown,
 category:string,
 href:string,
 index:number
):ActionItem{

 const data=object(value)?value:{};

 const type=string(data.type);
 const status=string(data.status);
 const summary=string(data.summary);
 const note=string(data.note);

 return {
  id:string(data.id)||category+"-"+index,
  category,
  title:type||status||category,
  description:summary||note||
   "Open the source module to review this item.",
  href,
  createdAt:string(data.createdAt)||undefined
 };
}

function ActionList({
 title,
 items,
 emptyMessage,
 href
}:{
 title:string;
 items:ActionItem[];
 emptyMessage:string;
 href:string;
}){
 return (
  <section style={{
   border:"1px solid #dbe3ed",
   borderRadius:10,
   background:"#ffffff",
   padding:15
  }}>
   <div style={{
    display:"flex",
    justifyContent:"space-between",
    alignItems:"center",
    gap:10,
    marginBottom:12
   }}>
    <h4 style={{
     color:"#104c72",
     margin:0,
     fontSize:15
    }}>
     {title}
    </h4>

    <Link href={href} style={{
     color:"#ef3321",
     fontSize:12,
     fontWeight:700
    }}>
     Open module
    </Link>
   </div>

   {items.length===0?(
    <p style={{
     color:"#64748b",
     fontSize:12
    }}>
     {emptyMessage}
    </p>
   ):(
    <div style={{
     display:"grid",
     gap:9
    }}>
     {items.slice(0,8).map((x,i)=>(
      <Link
       key={x.id+"-"+i}
       href={x.href}
       style={{
        display:"block",
        padding:12,
        border:"1px solid #e2e8f0",
        borderRadius:8,
        textDecoration:"none",
        color:"#0f172a"
       }}
      >
       <div style={{
        fontWeight:700,
        fontSize:12,
        color:"#104c72"
       }}>
        {x.title.replaceAll("_"," ")}
       </div>

       <div style={{
        fontSize:11,
        color:"#64748b",
        lineHeight:1.6,
        marginTop:5
       }}>
        {x.description}
       </div>

       {x.createdAt&&(
        <div style={{
         fontSize:10,
         color:"#94a3b8",
         marginTop:5
        }}>
         {new Date(x.createdAt).toLocaleString()}
        </div>
       )}
      </Link>
     ))}
    </div>
   )}
  </section>
 );
}

export default function ExecutiveFinanceActionCenter(){

 const [locations,setLocations]=useState<Location[]>([]);
 const [locationId,setLocationId]=useState("");
 const [age,setAge]=useState(7);
 const [loading,setLoading]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [results,setResults]=useState<ActionResults>(initial);
 const [errors,setErrors]=useState<string[]>([]);
 const [loadedScope,setLoadedScope]=useState("");
const [sourceStatus,setSourceStatus]=useState({
 supplierCases:false,
 retailCases:false,
 exceptions:false,
 agedAlerts:false
});

 useEffect(()=>{
  let active=true;

  void read("/api/v1/inventory/locations")
   .then(value=>{
    if(!active)return;

    const rows=locationsFrom(value);
    setLocations(rows);
   })
   .catch(()=>{
    if(active)setErrors([
     "Unable to load authorized locations."
    ]);
   });

  return ()=>{active=false};
 },[]);

 async function load(){

  if(!locationId){
   setErrors(["Select an authorized location."]);
   return;
  }

  setLoading(true);
  setLoaded(false);
  setResults(initial);
  setSourceStatus({
   supplierCases:false,
   retailCases:false,
   exceptions:false,
   agedAlerts:false
  });
  setErrors([]);

  const query="locationId="+encodeURIComponent(locationId);

  const urls=[
   "/api/v1/finance-command-center/workflow?"+query,
   "/api/v1/finance-command-center/alert-feed?"+
    query+"&olderThanDays="+age,
   "/api/v1/finance-operations/exceptions?"+query,
   "/api/v1/pos/finance/cases?"+query,
   "/api/v1/finance-reconciliation/hq-overview?"+query
  ];

  const names=[
   "Supplier workflow",
   "Aged alerts",
   "Supplier exceptions",
   "Retail finance cases",
   "Supplier overview"
  ];

  const responses=await Promise.allSettled(
   urls.map(read)
  );

  const failures:string[]=[];

  responses.forEach((response,i)=>{
   if(response.status==="rejected"){
    failures.push(
     names[i]+": "+
     (response.reason instanceof Error
      ?response.reason.message
      :"Unavailable")
    );
   }
  });

  function value(index:number):DataObject|null{
   const response=responses[index];

   if(response.status!=="fulfilled"||
    !object(response.value)){
    return null;
   }

   return response.value;
  }

  setSourceStatus({
   supplierCases:responses[0].status==="fulfilled",
   agedAlerts:responses[1].status==="fulfilled",
   exceptions:responses[2].status==="fulfilled",
   retailCases:responses[3].status==="fulfilled"
  });

  const workflow=value(0);
  const alerts=value(1);
  const exceptions=value(2);
  const cases=value(3);
  const overview=value(4);

  const supplierCases=Array.isArray(workflow?.openCases)
   ?workflow.openCases.map((x:unknown,i:number)=>
     item(
      x,
      "Supplier finance case",
      "/admin/finance-casework",
      i
     ))
   :[];

  const agedAlerts=Array.isArray(alerts?.alerts)
   ?alerts.alerts.map((x:unknown,i:number)=>
     item(
      x,
      "Aged finance alert",
      "/admin/finance-casework",
      i
     ))
   :[];

  const exceptionItems=Array.isArray(exceptions?.items)
   ?exceptions.items.map((x:unknown,i:number)=>
     item(
      x,
      "Supplier finance exception",
      "/admin/finance-operations",
      i
     ))
   :[];

  const retailCases=Array.isArray(cases?.rows)
   ?cases.rows
    .filter((x:unknown)=>
     object(x)&&
     (x.status==="OPEN"||
      x.status==="INVESTIGATING")
    )
    .map((x:unknown,i:number)=>
     item(
      x,
      "Retail finance case",
      "/admin/retail-finance/cases",
      i
     ))
   :[];

  const pending=object(overview?.pendingRequests)
   ?overview.pendingRequests:null;

  const notes:string[]=[];

  for(const [name,data] of [
   ["Supplier workflow",workflow],
   ["Aged alerts",alerts],
   ["Supplier exceptions",exceptions],
   ["Retail cases",cases]
  ] as [string,DataObject|null][]){
   if(data?.truncated===true){
    notes.push(name+
     " returned a truncated result set.");
   }
  }

  if(workflow&&typeof workflow.warning==="string"){
   notes.push(workflow.warning);
  }

  if(alerts&&typeof alerts.warning==="string"){
   notes.push(alerts.warning);
  }

  if(exceptions&&typeof exceptions.warning==="string"){
   notes.push(exceptions.warning);
  }

  setResults({
   pendingCount:pending?number(pending.count):null,
   pendingAmount:pending?
    string(pending.amount):null,
   supplierCases,
   retailCases,
   exceptions:exceptionItems,
   agedAlerts,
   notes
  });

  setLoadedScope(
   locations.find(x=>x.id===locationId)?.name||
   locationId
  );

  setErrors(failures);
  setLoaded(true);
  setLoading(false);
 }

 const summary=[
  {
   label:"Pending Supplier Payments",
   value:results.pendingCount===null
    ?"Unavailable"
    :String(results.pendingCount),
   detail:money(results.pendingAmount)
  },
  {
   label:"Open Supplier Cases",
   value:String(results.supplierCases.length),
   detail:"Cases returned by workflow"
  },
  {
   label:"Retail Cases Requiring Action",
   value:String(results.retailCases.length),
   detail:"Open or investigating cases in returned page"
  },
  {
   label:"Supplier Finance Exceptions",
   value:String(results.exceptions.length),
   detail:"Exceptions returned by source API"
  },
  {
   label:"Aged Alerts",
   value:String(results.agedAlerts.length),
   detail:"Alerts older than "+age+" days"
  }
 ];

 return (
  <section style={{
   border:"1px solid #dbe3ed",
   borderRadius:12,
   padding:20,
   background:"#f8fafc",
   margin:"22px 0"
  }}>
   <header style={{marginBottom:18}}>
    <h3 style={{
     color:"#104c72",
     fontSize:21,
     margin:"0 0 7px"
    }}>
     Executive Finance Operational Action Center
    </h3>

    <p style={{
     color:"#64748b",
     fontSize:12,
     lineHeight:1.7,
     margin:0
    }}>
     Centralized, read-only financial action queue.
     Select an authorized location to load pending
     payments, investigations and aged alerts.
    </p>
   </header>

   <div style={{
    display:"flex",
    flexWrap:"wrap",
    alignItems:"end",
    gap:12,
    padding:15,
    border:"1px solid #e2e8f0",
    borderRadius:10,
    background:"#ffffff",
    marginBottom:18
   }}>
    <label style={{fontSize:12}}>
     Location
     <select
      value={locationId}
      onChange={e=>setLocationId(e.target.value)}
      style={{
       display:"block",
       padding:9,
       minWidth:220
      }}
     >
      <option value="">Select location</option>

      {locations.map(x=>(
       <option key={x.id} value={x.id}>
        {x.name}
       </option>
      ))}
     </select>
    </label>

    <label style={{fontSize:12}}>
     Aged alerts threshold
     <select
      value={age}
      onChange={e=>setAge(Number(e.target.value))}
      style={{
       display:"block",
       padding:9
      }}
     >
      {[3,7,14,30,60,90].map(days=>(
       <option key={days} value={days}>
        {days} days
       </option>
      ))}
     </select>
    </label>

    <button
     type="button"
     disabled={loading||!locationId}
     onClick={()=>void load()}
     style={{
      padding:"10px 17px",
      border:0,
      borderRadius:8,
      background:"#104c72",
      color:"#ffffff",
      cursor:"pointer"
     }}
    >
     {loading?"Loading...":"Load Action Center"}
    </button>
   </div>

   {errors.length>0&&(
    <div role="status" style={{
     color:"#9a3412",
     fontSize:12,
     marginBottom:15
    }}>
     {errors.map((x,i)=><p key={i}>{x}</p>)}
    </div>
   )}

   {loaded&&(
    <>
     <p style={{
      fontSize:12,
      color:"#475569",
      marginBottom:14
     }}>
      <strong>Reporting location:</strong>{" "}
      {loadedScope}
     </p>

     <div style={{
      display:"grid",
      gridTemplateColumns:
       "repeat(auto-fit,minmax(170px,1fr))",
      gap:12,
      marginBottom:20
     }}>
      {summary.map(x=>(
       <div key={x.label} style={{
        border:"1px solid #dbe3ed",
        borderRadius:10,
        background:"#ffffff",
        padding:14
       }}>
        <div style={{
         color:"#64748b",
         fontSize:11
        }}>
         {x.label}
        </div>

        <div style={{
         color:"#104c72",
         fontSize:24,
         fontWeight:700,
         margin:"8px 0"
        }}>
         {x.value}
        </div>

        <div style={{
         color:"#64748b",
         fontSize:11,
         lineHeight:1.6
        }}>
         {x.detail}
        </div>
       </div>
      ))}
     </div>

     <ExecutiveFinancePriorities
      supplierCases={results.supplierCases}
      retailCases={results.retailCases}
      exceptions={results.exceptions}
      agedAlerts={results.agedAlerts}
      sourceStatus={sourceStatus}
     />

     <div style={{
      display:"grid",
      gridTemplateColumns:
       "repeat(auto-fit,minmax(300px,1fr))",
      gap:14
     }}>
      <ActionList
       title="Supplier Finance Cases"
       items={results.supplierCases}
       emptyMessage="No open cases returned."
       href="/admin/finance-casework"
      />

      <ActionList
       title="Retail Finance Cases"
       items={results.retailCases}
       emptyMessage="No open retail cases returned."
       href="/admin/retail-finance/cases"
      />

      <ActionList
       title="Supplier Finance Exceptions"
       items={results.exceptions}
       emptyMessage="No supplier exceptions returned."
       href="/admin/finance-operations"
      />

      <ActionList
       title="Aged Finance Alerts"
       items={results.agedAlerts}
       emptyMessage="No aged alerts returned."
       href="/admin/finance-casework"
      />
     </div>

     {results.notes.length>0&&(
      <div style={{
       borderTop:"1px solid #dbe3ed",
       marginTop:20,
       paddingTop:14,
       fontSize:11,
       color:"#64748b",
       lineHeight:1.7
      }}>
       <strong>Source limitations</strong>

       {results.notes.map((x,i)=>(
        <p key={i}>{x}</p>
       ))}
      </div>
     )}
    </>
   )}
  </section>
 );
}