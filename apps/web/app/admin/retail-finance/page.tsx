"use client";
import RetailFinanceOperationsNav from './components/retail-finance-operations-nav';

import {useState} from "react";
import RetailFinanceToolbar from "./components/retail-finance-toolbar";

type Shift = {
 shiftId:string;
 closedAt:string;
 openingCash:string;
 cashSales:string;
 drawerAdjustment:string;
 expectedCash:string;
 countedCash:string;
 variance:string;
 acceptedSales:number;
 approvedMovements:number;
 snapshotVerified:boolean;
};

type ReturnRow = {
 returnId:string;
 saleId:string;
 createdAt:string;
 refundDue:string;
 refundSettled:string;
 refundOutstanding:string;
 settlementStatus:string;
};

type Settlement = {
 settlementId:string;
 returnId:string;
 method:string;
 amount:string;
 reference:string|null;
 payoutShiftId:string|null;
 settledAt:string;
 drawerLinkStatus:string;
 drawerMovements:Array<{
  movementId:string;
  amount:string;
  status:string;
 }>;
};

type Reconciliation = {
 id:string;
 shiftId:string;
 status:string;
 expectedCash:string;
 countedCash:string;
 variance:string;
 submittedAt:string;
 reviewedAt:string|null;
};

type Report = {
 locationId:string;
 generatedAt:string;
 currency:string;
 rowLimit:number;
 anyTruncated:boolean;
 truncated:Record<string,boolean>;
 totalsScope:string;
 summary:{
  closedShifts:number;
  netShiftVariance:string;
  returnsShown:number;
  refundDue:string;
  refundSettled:string;
  refundOutstanding:string;
  cashSettlementsShown:number;
  cashDrawerLinksRequiringReview:number;
 };
 shifts:Shift[];
 returns:ReturnRow[];
 settlements:Settlement[];
 reconciliations:Reconciliation[];
 warning:string;
 note:string;
};

const uuid =
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const money=(v:string|number)=>
 "PKR "+Number(v).toLocaleString("en-PK",{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 });

const date=(v:string|null)=>
 v?new Date(v).toLocaleString():"—";

const short=(v:string)=>
 v.length>18?v.slice(0,8)+"…"+v.slice(-6):v;

const cell:React.CSSProperties={
 padding:"10px 12px",
 borderBottom:"1px solid #e2e8f0",
 textAlign:"left",
 verticalAlign:"top",
 fontSize:13
};

const panel:React.CSSProperties={
 border:"1px solid #dbe3ed",
 borderRadius:12,
 padding:18,
 background:"#fff"
};

function DataTable({
 headers,
 rows,
 empty
}:{
 headers:string[];
 rows:React.ReactNode[][];
 empty:string;
}){
 return <div style={{overflowX:"auto"}}>
  <table style={{width:"100%",borderCollapse:"collapse"}}>
   <thead>
    <tr>{headers.map(h=>
     <th key={h} style={{
      ...cell,
      background:"#f1f5f9",
      whiteSpace:"nowrap"
     }}>{h}</th>
    )}</tr>
   </thead>
   <tbody>
    {rows.map((r,i)=>
     <tr key={i}>
      {r.map((value,j)=>
       <td key={j} style={cell}>{value}</td>
      )}
     </tr>
    )}
   </tbody>
  </table>
  {!rows.length&&
   <p style={{padding:16,color:"#64748b"}}>{empty}</p>
  }
 </div>;
}

export default function RetailFinancePage(){
 const [locationId,setLocationId]=useState("");
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [section,setSection]=useState("overview");

 async function load(){
  setError("");
  setReport(null);

  if(!uuid.test(locationId.trim())){
   setError("Enter a valid branch location UUID.");
   return;
  }

  setLoading(true);

  try{
   const response=await fetch(
    "/api/v1/pos/finance/retail-summary?locationId="+
     encodeURIComponent(locationId.trim()),
    {
     credentials:"include",
     cache:"no-store"
    }
   );

   const data=await response.json().catch(()=>null);

   if(!response.ok){
    const detail=Array.isArray(data?.message)
     ?data.message.join(", ")
     :data?.message;

    throw new Error(
     detail||"Request failed: HTTP "+response.status
    );
   }

   if(
    !data ||
    !data.summary ||
    !Array.isArray(data.shifts) ||
    !Array.isArray(data.returns) ||
    !Array.isArray(data.settlements) ||
    !Array.isArray(data.reconciliations)
   ){
    throw new Error("Unexpected retail finance API response.");
   }

   setReport(data as Report);

  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }finally{
   setLoading(false);
  }
 }

 const sections=[
  ["overview","Overview"],
  ["shifts","Shift closings"],
  ["returns","Refund obligations"],
  ["settlements","Settlements"],
  ["reconciliations","Reconciliations"]
 ];

 const metric=(name:string,value:string)=>(
  <div key={name} style={panel}>
   <div style={{fontSize:13,color:"#475569"}}>
    {name}
   </div>
   <div style={{
    fontSize:22,
    fontWeight:700,
    marginTop:8,
    overflowWrap:"anywhere"
   }}>
    {value}
   </div>
  </div>
 );

 return <main style={{
  maxWidth:1350,
  margin:"30px auto",
  padding:20,
  fontFamily:"system-ui",
  color:"#172b4d"
 }}>
  <RetailFinanceOperationsNav />

  <RetailFinanceToolbar/>
  <h1>Retail Finance Dashboard</h1>
  <p style={{color:"#475569"}}>
   Royal Step physical retail — branch cash,
   customer refunds and shift reconciliation.
   Read-only operational reporting.
  </p>

  <div style={{
   ...panel,
   display:"flex",
   flexWrap:"wrap",
   alignItems:"end",
   gap:12,
   marginBottom:20
  }}>
   <label style={{display:"grid",gap:6,flex:"1 1 320px"}}>
    <strong>Branch location UUID</strong>
    <input
     value={locationId}
     onChange={e=>setLocationId(e.target.value)}
     placeholder="Enter branch location UUID"
     aria-label="Branch location UUID"
     style={{
      padding:11,
      border:"1px solid #94a3b8",
      borderRadius:7
     }}
    />
   </label>

   <button
    type="button"
    onClick={load}
    disabled={loading}
    style={{
     padding:"12px 20px",
     border:0,
     borderRadius:7,
     background:"#104c72",
     color:"white",
     cursor:"pointer"
    }}
   >
    {loading?"Loading…":"Load retail finance"}
   </button>
  </div>

  {error&&
   <p role="alert" style={{color:"#b91c1c"}}>
    {error}
   </p>
  }

  {report&&<>
   <div style={{
    ...panel,
    marginBottom:18,
    background:"#f8fafc"
   }}>
    <strong>Reporting scope</strong>
    <p>
     Generated: {date(report.generatedAt)}
     {" · "}Branch: {report.locationId}
    </p>
    <p>
     Maximum {report.rowLimit} records per category.
     Totals cover displayed rows only.
    </p>
    {report.anyTruncated&&
     <p role="alert" style={{color:"#b45309",fontWeight:700}}>
      One or more result sets are truncated.
      Figures must not be treated as complete
      historical balances.
     </p>
    }
    <p style={{fontSize:13,color:"#64748b"}}>
     {report.warning}
    </p>
   </div>

   <nav aria-label="Retail finance sections"
    style={{
     display:"flex",
     gap:8,
     flexWrap:"wrap",
     marginBottom:20
    }}>
    {sections.map(([key,label])=>
     <button
      key={key}
      type="button"
      onClick={()=>setSection(key)}
      aria-pressed={section===key}
      style={{
       padding:"9px 14px",
       borderRadius:7,
       border:"1px solid #cbd5e1",
       background:section===key?"#104c72":"white",
       color:section===key?"white":"#172b4d",
       cursor:"pointer"
      }}
     >{label}</button>
    )}
   </nav>

   {section==="overview"&&<>
    <div style={{
     display:"grid",
     gridTemplateColumns:
      "repeat(auto-fit,minmax(210px,1fr))",
     gap:12
    }}>
     {metric(
      "Closed shifts shown",
      String(report.summary.closedShifts)
     )}
     {metric(
      "Net closing variance",
      money(report.summary.netShiftVariance)
     )}
     {metric(
      "Refund due (shown returns)",
      money(report.summary.refundDue)
     )}
     {metric(
      "Refund settled (shown returns)",
      money(report.summary.refundSettled)
     )}
     {metric(
      "Refund outstanding (shown returns)",
      money(report.summary.refundOutstanding)
     )}
     {metric(
      "Cash settlements shown",
      String(report.summary.cashSettlementsShown)
     )}
     {metric(
      "Drawer links requiring review",
      String(report.summary.cashDrawerLinksRequiringReview)
     )}
    </div>
    <p style={{marginTop:20,color:"#64748b"}}>
     These figures are limited operational summaries,
     not bank-verified accounting or complete
     historical liabilities.
    </p>
   </>}

   {section==="shifts"&&
    <section style={panel}>
     <h2>Verified shift closing snapshots</h2>
     <DataTable
      headers={[
       "Shift","Closed","Opening",
       "Cash sales","Drawer adjustment",
       "Expected","Counted","Variance",
       "Accepted sales"
      ]}
      rows={report.shifts.map(s=>[
       <span title={s.shiftId}>{short(s.shiftId)}</span>,
       date(s.closedAt),
       money(s.openingCash),
       money(s.cashSales),
       money(s.drawerAdjustment),
       money(s.expectedCash),
       money(s.countedCash),
       <strong key="variance"
        style={{
         color:Number(s.variance)===0
          ?"#166534":"#b45309"
        }}>
        {money(s.variance)}
       </strong>,
       s.acceptedSales
      ])}
      empty="No verified shift closings found."
     />
    </section>
   }

   {section==="returns"&&
    <section style={panel}>
     <h2>Customer refund obligations</h2>
     <DataTable
      headers={[
       "Return","Created","Due",
       "Settled","Outstanding","Status"
      ]}
      rows={report.returns.map(r=>[
       <span title={r.returnId}>{short(r.returnId)}</span>,
       date(r.createdAt),
       money(r.refundDue),
       money(r.refundSettled),
       money(r.refundOutstanding),
       r.settlementStatus
      ])}
      empty="No return records found."
     />
    </section>
   }

   {section==="settlements"&&
    <section style={panel}>
     <h2>Refund settlement traceability</h2>
     <DataTable
      headers={[
       "Settlement","Return","Date",
       "Method","Amount","Reference",
       "Drawer linkage"
      ]}
      rows={report.settlements.map(s=>[
       <span title={s.settlementId}>
        {short(s.settlementId)}
       </span>,
       <span title={s.returnId}>
        {short(s.returnId)}
       </span>,
       date(s.settledAt),
       s.method,
       money(s.amount),
       s.reference||"—",
       <strong key="link" style={{
        color:s.drawerLinkStatus==="REVIEW_REQUIRED"
         ?"#b91c1c":"#166534"
       }}>{s.drawerLinkStatus}</strong>
      ])}
      empty="No refund settlements found."
     />
    </section>
   }

   {section==="reconciliations"&&
    <section style={panel}>
     <h2>Cash reconciliation review history</h2>
     <DataTable
      headers={[
       "Shift","Submitted","Status",
       "Expected","Counted","Variance",
       "Reviewed"
      ]}
      rows={report.reconciliations.map(r=>[
       <span title={r.shiftId}>{short(r.shiftId)}</span>,
       date(r.submittedAt),
       r.status,
       money(r.expectedCash),
       money(r.countedCash),
       money(r.variance),
       date(r.reviewedAt)
      ])}
      empty="No reconciliation submissions found."
     />
    </section>
   }

   <p style={{
    marginTop:24,
    fontSize:12,
    color:"#64748b"
   }}>
    {report.note}
   </p>
  </>}
 </main>;
}