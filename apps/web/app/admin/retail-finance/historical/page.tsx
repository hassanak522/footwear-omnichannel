"use client";
import RetailCaseLink from 'next/link';


import {useEffect,useState} from "react";


type Branch = {
 locationId:string;
 code:string;
 name:string;
 closedShifts:number;
 netShiftVariance:string;
 absoluteShiftVariance:string;
 refundDueAllTime:string;
 refundSettledAllTime:string;
 refundOutstandingAllTime:string;
 cashDrawerExceptions:number;
};

type Totals = {
 closedShifts:number;
 netShiftVariance:string;
 absoluteShiftVariance:string;
 refundDueAllTime:string;
 refundSettledAllTime:string;
 refundOutstandingAllTime:string;
 cashDrawerExceptions:number;
};

type Exception = {
 locationId:string;
 settlementId:string;
 returnId:string;
 payoutShiftId:string|null;
 amount:string;
 movementCount:number;
 validMovementCount:number;
};

type HistoricalReport = {
 generatedAt:string;
 currency:string;
 scope:string;
 from:string|null;
 to:string|null;
 timezone:string;
 liabilityScope:string;
 periodScope:string;
 branches:Branch[];
 totals:Totals;
 cashDrawerExceptionDetails?:Exception[];
 exceptionsTruncated?:boolean;
 notes?:string[];
};

const formatMoney=(value:string|number)=>
 "PKR "+Number(value).toLocaleString("en-PK",{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 });

const formatDate=(value:string)=>
 new Date(value).toLocaleString();

const shortId=(value:string)=>
 value.length>20
  ?value.slice(0,8)+"…"+value.slice(-6)
  :value;

const panel:React.CSSProperties={
 background:"#fff",
 border:"1px solid #dbe3ed",
 borderRadius:12,
 padding:18
};

const cell:React.CSSProperties={
 padding:"11px 12px",
 textAlign:"left",
 borderBottom:"1px solid #e2e8f0",
 fontSize:13,
 whiteSpace:"nowrap"
};

function Metric({
 title,value
}:{
 title:string;
 value:string;
}){
 return <div style={panel}>
  <div style={{color:"#475569",fontSize:13}}>
   {title}
  </div>
  <div style={{
   fontSize:22,
   fontWeight:700,
   marginTop:8,
   overflowWrap:"anywhere"
  }}>
   {value}
  </div>
 </div>;
}

export default function HistoricalRetailFinance(){
 const [locationId,setLocationId]=useState("");
 const [availableBranches,setAvailableBranches]=useState<Branch[]>([]);
 const [branchesLoading,setBranchesLoading]=useState(true);
 const [branchesError,setBranchesError]=useState("");
 const [scope,setScope]=useState<"HQ"|"BRANCH_MANAGER"|null>(null);

 useEffect(()=>{
  let cancelled=false;

  async function loadBranches(){
   try{
    const response=await fetch(
     "/api/v1/pos/finance/historical-summary",
     {
      credentials:"include",
      cache:"no-store"
     }
    );

    if(response.status===400){
     const locationsResponse=await fetch(
      "/api/v1/inventory/locations",
      {
       credentials:"include",
       cache:"no-store"
      }
     );

     if(!locationsResponse.ok){
      throw new Error(
       "Unable to retrieve authorized branch locations."
      );
     }

     const raw=await locationsResponse.json();

     const items=Array.isArray(raw)
      ?raw
      :Array.isArray(raw?.locations)
       ?raw.locations
       :Array.isArray(raw?.data)
        ?raw.data
        :[];

     const branches=items
      .filter(
       (item:any)=>
        item &&
        item.type==="BRANCH" &&
        item.active!==false &&
        typeof item.id==="string"
      )
      .map((item:any)=>({
       locationId:item.id,
       code:String(item.code||""),
       name:String(item.name||item.code||"Branch"),
       closedShifts:0,
       netShiftVariance:"0.00",
       absoluteShiftVariance:"0.00",
       refundDueAllTime:"0.00",
       refundSettledAllTime:"0.00",
       refundOutstandingAllTime:"0.00",
       cashDrawerExceptions:0
      })) as Branch[];

     if(!cancelled){
      setAvailableBranches(branches);
      setScope("BRANCH_MANAGER");

      if(branches.length===1){
       setLocationId(branches[0].locationId);
      }
     }

     return;
    }

    if(!response.ok){
     throw new Error(
      "Unable to retrieve authorized branches (HTTP "+
      response.status+")."
     );
    }

    const data=await response.json();

    if(!Array.isArray(data?.branches)){
     throw new Error("Invalid branch list response.");
    }

    if(!cancelled){
     setAvailableBranches(data.branches);
     setScope(
      data.scope==="HQ"?"HQ":"BRANCH_MANAGER"
     );
    }

   }catch(error){
    if(!cancelled){
     setBranchesError(
      error instanceof Error
       ?error.message
       :String(error)
     );
    }
   }finally{
    if(!cancelled){
     setBranchesLoading(false);
    }
   }
  }

  void loadBranches();

  return ()=>{
   cancelled=true;
  };
 },[]);

 const [from,setFrom]=useState("");
 const [to,setTo]=useState("");
 const [report,setReport]=useState<HistoricalReport|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);

 async function load(){
  setError("");
  setReport(null);

  if(branchesLoading){
   setError("Branch permissions are still loading.");
   return;
  }

  if(branchesError){
   setError(branchesError);
   return;
  }

  if(scope!=="HQ"&&!locationId){
   setError("Select an authorized retail branch.");
   return;
  }

  if(locationId&&!availableBranches.some(
   branch=>branch.locationId===locationId
  )){
   setError("Selected branch is not in the authorized list.");
   return;
  }

  if(from&&to&&from>to){
   setError("Start date cannot exceed end date.");
   return;
  }

  if(from&&to){
   const start=new Date(from+"T00:00:00Z");
   const end=new Date(to+"T00:00:00Z");
   if(end.getTime()-start.getTime()>365*86400000){
    setError("Select a reporting period of up to 366 days.");
    return;
   }
  }

  setLoading(true);

  try{
   const params=new URLSearchParams();

   if(locationId.trim()){
    params.set("locationId",locationId.trim());
   }

   if(from)params.set("from",from);
   if(to)params.set("to",to);

   const query=params.toString();

   const url="/api/v1/pos/finance/historical-summary"+
    (query?"?"+query:"");

   const response=await fetch(url,{
    credentials:"include",
    cache:"no-store"
   });

   const data=await response.json().catch(()=>null);

   if(!response.ok){
    const message=Array.isArray(data?.message)
     ?data.message.join(", ")
     :data?.message;

    throw new Error(
     message||"HTTP "+response.status
    );
   }

   if(
    !data||
    !data.totals||
    !Array.isArray(data.branches)
   ){
    throw new Error("Unexpected historical finance response.");
   }

   setReport(data as HistoricalReport);

  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }finally{
   setLoading(false);
  }
 }

 const totals=report?.totals;

 return <main style={{
  maxWidth:1200,
  margin:"0 auto",
  padding:"28px 20px 48px",
  fontFamily:"system-ui",
  color:"#172b4d"
 }}>
  

  <div style={{marginBottom:20}}>
   <a href="/admin/retail-finance"
    style={{color:"#104c72"}}>
    Retail Finance Dashboard
   </a>
   
   <div style={{
  color:"#ef3321",
  fontSize:12,
  fontWeight:700,
  letterSpacing:1
}}>
  ROYAL STEP / FINANCE
</div>
<h1 style={{
  color:"#104c72",
  fontSize:28,
  margin:"8px 0"
}}>
  Finance Reports
</h1>
   <p style={{color:"#475569"}}>
    Compare financial records across retail branches,
    review refunds and identify cash drawer issues.
   </p>
  </div>

  <section style={{...panel,marginBottom:20}}>
   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(190px,1fr))",
    gap:14
   }}>
    <label style={{display:"grid",gap:6}}>
 <strong>Branch</strong>
 <select
  value={locationId}
  onChange={e=>setLocationId(e.target.value)}
  disabled={branchesLoading}
  style={{
   padding:10,
   border:"1px solid #94a3b8",
   borderRadius:6,
   background:"#fff"
  }}
 >
  {scope==="HQ"&&
   <option value="">All authorized branches</option>
  }
  {scope!=="HQ"&&
   <option value="">Select branch</option>
  }
  {availableBranches.map(branch=>
   <option
    key={branch.locationId}
    value={branch.locationId}
   >
    {branch.code} — {branch.name}
   </option>
  )}
 </select>
</label>

    <label style={{display:"grid",gap:6}}>
     <strong>From Date (UTC)</strong>
     <input
      type="date"
      value={from}
      onChange={e=>setFrom(e.target.value)}
      style={{
       padding:10,
       border:"1px solid #94a3b8",
       borderRadius:6
      }}
     />
    </label>

    <label style={{display:"grid",gap:6}}>
     <strong>To Date (UTC)</strong>
     <input
      type="date"
      value={to}
      onChange={e=>setTo(e.target.value)}
      style={{
       padding:10,
       border:"1px solid #94a3b8",
       borderRadius:6
      }}
     />
    </label>
   </div>

   <p style={{fontSize:13,color:"#64748b"}}>
    Dates filter shift closings only, using UTC boundaries.
    Refund liabilities and drawer exceptions are current
    all-time figures. Branch managers must select an
    authorized branch.
   </p>

   <button
    type="button"
    disabled={loading||branchesLoading||!!branchesError}
    onClick={load}
    style={{
     padding:"11px 20px",
     background:"#104c72",
     color:"#fff",
     border:0,
     borderRadius:7,
     cursor:"pointer"
    }}
   >
    {loading?"Loading…":"Generate Report"}
   </button>
  </section>

  {branchesLoading&&
   <p style={{color:"#64748b"}}>
    Loading authorized retail branches…
   </p>
  }

  {branchesError&&
   <p role="alert" style={{color:"#b91c1c"}}>
    {branchesError}
   </p>
  }
  {error&&
   <p role="alert" style={{color:"#b91c1c"}}>
    {error}
   </p>
  }

  {report&&totals&&<>
   <section style={{
    ...panel,
    background:"#f8fafc",
    marginBottom:20
   }}>
    <strong>Reporting scope: {report.scope}</strong>
    <p>
     Generated {formatDate(report.generatedAt)}
     {" · "}Currency: {report.currency}
     {" · "}Timezone: {report.timezone}
    </p>
    <p>
     Shift closing period: {report.from||"Beginning"}
     {" to "}{report.to||"Latest"}
    </p>
    <p style={{fontSize:13,color:"#64748b"}}>
     Refund liabilities represent current all-time
     outstanding amounts, not historical as-of-date balances.
    </p>
   </section>

   <section style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(215px,1fr))",
    gap:12,
    marginBottom:24
   }}>
    <Metric
     title="Closed Shifts"
     value={String(totals.closedShifts)}
    />
    <Metric
     title="Net Cash Difference"
     value={formatMoney(totals.netShiftVariance)}
    />
    <Metric
     title="Total Cash Differences"
     value={formatMoney(totals.absoluteShiftVariance)}
    />
    <Metric
     title="Total Refunds Due (All Time)"
     value={formatMoney(totals.refundDueAllTime)}
    />
    <Metric
     title="Refunds Recorded as Paid (All Time)"
     value={formatMoney(totals.refundSettledAllTime)}
    />
    <Metric
     title="Refunds Pending (All Time)"
     value={formatMoney(totals.refundOutstandingAllTime)}
    />
    <Metric
     title="Cash Drawer Issues"
     value={String(totals.cashDrawerExceptions)}
    />
   </section>

   <section style={{...panel,marginBottom:22}}>
    <h2 style={{color:"#104c72"}}>Branch Comparison</h2>
    <div style={{overflowX:"auto"}}>
     <table style={{
      width:"100%",
      borderCollapse:"collapse"
     }}>
      <thead>
       <tr>
        {[
         "Branch",
         "Closed shifts",
         "Net variance",
         "Absolute variance",
         "Refund due",
         "Refund settled",
         "Outstanding refunds",
         "Drawer exceptions"
        ].map(h=>
         <th key={h} style={{
          ...cell,
          background:"#f1f5f9"
         }}>{h}</th>
        )}
       </tr>
      </thead>
      <tbody>
       {report.branches.map(b=>
        <tr key={b.locationId}>
         <td style={cell}>
          <strong>{b.name}</strong>
          <div style={{color:"#64748b"}}>
           {b.code}
          </div>
         </td>
         <td style={cell}>{b.closedShifts}</td>
         <td style={cell}>
          {formatMoney(b.netShiftVariance)}
         </td>
         <td style={cell}>
          {formatMoney(b.absoluteShiftVariance)}
         </td>
         <td style={cell}>
          {formatMoney(b.refundDueAllTime)}
         </td>
         <td style={cell}>
          {formatMoney(b.refundSettledAllTime)}
         </td>
         <td style={cell}>
          <strong>
           {formatMoney(b.refundOutstandingAllTime)}
          </strong>
         </td>
         <td style={cell}>
          <strong style={{
           color:b.cashDrawerExceptions>0
            ?"#b91c1c":"#166534"
          }}>
           {b.cashDrawerExceptions}
          </strong>
         </td>
        </tr>
       )}
      </tbody>
     </table>

     {!report.branches.length&&
      <p>No authorized active branches found.</p>
     }
    </div>
   </section>

   <details style={{...panel,marginBottom:22}}>
    <summary style={{
      cursor:"pointer",
      color:"#104c72",
      fontSize:18,
      fontWeight:700
    }}>
      Cash Drawer Issues
    </summary>
    <p style={{fontSize:13,color:"#64748b"}}>
     These exceptions require finance review.
     This dashboard does not automatically approve,
     reverse, or alter any settlement.
    </p>
    <p style={{color:"#64748b"}}>
     Refund settlements without exactly one matching
     approved cash drawer movement.
    </p>

    <div style={{overflowX:"auto"}}>
     <table style={{
      width:"100%",
      borderCollapse:"collapse"
     }}>
      <thead>
       <tr>
        {[
         "Branch",
         "Settlement",
         "Return",
         "Amount",
         "Drawer movements",
         "Valid matches"
        ].map(h=>
         <th key={h} style={{
          ...cell,
          background:"#f1f5f9"
         }}>{h}</th>
        )}
       </tr>
      </thead>
      <tbody>
       {(report.cashDrawerExceptionDetails||[]).map(e=>
        <tr key={e.settlementId}>
         <td style={cell}>
          {report.branches.find(
           b=>b.locationId===e.locationId
          )?.code||shortId(e.locationId)}
         </td>
         <td style={cell} title={e.settlementId}>
          <div style={{display:"grid",gap:5}}>
           <span><RetailCaseLink
 href={`/admin/retail-finance/cases?locationId=${encodeURIComponent(e.locationId)}&sourceType=POS_REFUND_SETTLEMENT&sourceId=${encodeURIComponent(e.settlementId)}`}
 title={`Investigate settlement ${e.settlementId}`}
 style={{
  color:"#104c72",
  fontWeight:600,
  textDecoration:"underline"
 }}
>
 {shortId(e.settlementId)}
</RetailCaseLink></span>
           <button
            type="button"
            onClick={()=>{
             void navigator.clipboard.writeText(
              e.settlementId
             ).catch(()=>{});
            }}
            aria-label={"Copy settlement "+e.settlementId}
            style={{
             border:"1px solid #cbd5e1",
             borderRadius:5,
             background:"#fff",
             padding:"4px 7px",
             cursor:"pointer",
             fontSize:11
            }}
           >
            Copy ID
           </button>
          </div>
         </td>
         <td style={cell} title={e.returnId}>
          {shortId(e.returnId)}
         </td>
         <td style={cell}>{formatMoney(e.amount)}</td>
         <td style={cell}>{e.movementCount}</td>
         <td style={cell}>{e.validMovementCount}</td>
        </tr>
       )}
      </tbody>
     </table>

     {!(report.cashDrawerExceptionDetails||[]).length&&
      <p>No cash drawer exceptions found.</p>
     }
    </div>

    {report.exceptionsTruncated&&
     <p role="alert" style={{color:"#b45309"}}>
      Only the first 100 exception details are displayed.
      The total exception count includes all matches.
     </p>
    }
   </details>

   <section style={{
    ...panel,
    background:"#f8fafc"
   }}>
    <h2 style={{color:"#104c72"}}>About This Report</h2>
    <ul>
     {(report.notes||[]).map((note,i)=>
      <li key={i} style={{marginBottom:8}}>
       {note}
      </li>
     )}
    </ul>
   </section>
  </>}
 </main>;
}