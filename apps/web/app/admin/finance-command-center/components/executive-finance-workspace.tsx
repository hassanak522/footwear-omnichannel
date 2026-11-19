"use client";

import Link from "next/link";
import ExecutiveFinanceActions from "./executive-finance-actions";

type WorkspaceItem={
 title:string;
 description:string;
 href:string;
};

const retailItems:WorkspaceItem[]=[
 {
  title:"Recent Retail Finance",
  description:"Review recent shift closings, refund obligations, settlement traceability and cash reconciliation.",
  href:"/admin/retail-finance"
 },
 {
  title:"Historical Retail Finance",
  description:"Compare branch performance and review historical cash refund exceptions.",
  href:"/admin/retail-finance/historical"
 },
 {
  title:"Retail Finance Cases",
  description:"Create, assign, investigate and resolve retail financial exception cases.",
  href:"/admin/retail-finance/cases"
 }
];

const operationsItems:WorkspaceItem[]=[
 {
  title:"Retail Operations",
  description:"Review store sales, approved merchandise returns and daily reconciliation.",
  href:"/admin/retail"
 },
 {
  title:"Finance Controls",
  description:"Access cash movements, settlement batches and manual journals.",
  href:"/admin/finance-controls"
 },
 {
  title:"Supplier Reconciliation",
  description:"Review supplier invoice exposure and settlement reconciliation.",
  href:"/admin/finance-reconciliation"
 }
];

function WorkspaceSection({
 title,
 description,
 items
}:{
 title:string;
 description:string;
 items:WorkspaceItem[];
}){

 return (
  <section style={{marginBottom:26}}>
   <h2 style={{
    fontSize:19,
    color:"#104c72",
    margin:"0 0 6px"
   }}>
    {title}
   </h2>

   <p style={{
    color:"#64748b",
    fontSize:13,
    margin:"0 0 14px"
   }}>
    {description}
   </p>

   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(230px,1fr))",
    gap:12
   }}>
    {items.map(item=>(
     <Link
      key={item.href}
      href={item.href}
      style={{
       display:"block",
       padding:17,
       background:"#f8fafc",
       border:"1px solid #dbe3ed",
       borderRadius:10,
       color:"#0f172a",
       textDecoration:"none"
      }}
     >
      <div style={{
       fontWeight:700,
       color:"#104c72",
       marginBottom:7
      }}>
       {item.title}
      </div>

      <p style={{
       fontSize:12,
       color:"#475569",
       lineHeight:1.6,
       margin:0
      }}>
       {item.description}
      </p>
     </Link>
    ))}
   </div>
  </section>
 );
}

export default function ExecutiveFinanceWorkspace(){

 return (
  <div
   aria-label="Executive finance workspace"
   style={{
    margin:"24px 0 30px"
   }}
  >
   <header style={{
    padding:"22px",
    borderRadius:12,
    background:"#104c72",
    color:"#ffffff",
    marginBottom:25
   }}>
    <div style={{
     fontSize:12,
     textTransform:"uppercase",
     letterSpacing:".08em",
     opacity:.85
    }}>
     Royal Step Omnichannel
    </div>

    <h2 style={{
     margin:"8px 0",
     fontSize:25,
     color:"#ffffff"
    }}>
     Executive Finance Workspace
    </h2>

    <p style={{
     margin:0,
     fontSize:13,
     lineHeight:1.7,
     maxWidth:780
    }}>
     Central access to financial oversight,
     reconciliation, operational controls,
     investigations and retail finance reporting.
     Figures remain sourced from their respective
     existing financial modules.
    </p>
   </header>

   <ExecutiveFinanceActions />

   <WorkspaceSection
    title="Retail Financial Oversight"
    description="Monitor branch financial activity and investigate retail exceptions."
    items={retailItems}
   />

   <WorkspaceSection
    title="Operational Finance"
    description="Access existing retail, accounting and supplier finance workflows."
    items={operationsItems}
   />
  </div>
 );
}