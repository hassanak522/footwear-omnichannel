"use client";

import Link from "next/link";

type ActionItem={
 title:string;
 description:string;
 href:string;
 category:string;
};

const actions:ActionItem[]=[
 {
  title:"Payment Reconciliation",
  description:"Investigate POS payment exceptions, record evidence and review supervisor decisions.",
  href:"/admin/payment-reconciliation",
  category:"Reconciliation"
 },
 {
  title:"Supplier Reconciliation",
  description:"Review supplier invoices, settlement records and reconciliation differences.",
  href:"/admin/finance-reconciliation",
  category:"Reconciliation"
 },
 {
  title:"Supplier Finance Casework",
  description:"Investigate supplier settlement cases and outstanding financial alerts.",
  href:"/admin/finance-casework",
  category:"Investigations"
 },
 {
  title:"Retail Exception Cases",
  description:"Investigate refund settlements and shift closing exceptions.",
  href:"/admin/retail-finance/cases",
  category:"Investigations"
 },
 {
  title:"Finance Controls",
  description:"Manage cash drawer movements, settlement batches and manual journal controls.",
  href:"/admin/finance-controls",
  category:"Controls"
 },
 {
  title:"Finance Operations",
  description:"Review branch comparisons, invoice statements and financial exceptions.",
  href:"/admin/finance-operations",
  category:"Operations"
 }
];

export default function ExecutiveFinanceActions(){

 return (
  <section
   aria-label="Financial action center"
   style={{marginBottom:28}}
  >
   <div style={{marginBottom:15}}>
    <h2 style={{
     fontSize:20,
     margin:"0 0 5px",
     color:"#104c72"
    }}>
     Financial Action Center
    </h2>

    <p style={{
     margin:0,
     color:"#64748b",
     fontSize:13
    }}>
     Open existing financial workflows directly from the
     executive dashboard. Financial approvals and changes
     remain subject to their existing authorization rules.
    </p>
   </div>

   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(230px,1fr))",
    gap:12
   }}>
    {actions.map(item=>(
     <Link
      key={item.href}
      href={item.href}
      style={{
       display:"block",
       padding:16,
       border:"1px solid #dbe3ed",
       borderRadius:10,
       textDecoration:"none",
       color:"#0f172a",
       background:"#ffffff"
      }}
     >
      <span style={{
       display:"inline-block",
       fontSize:11,
       color:"#64748b",
       marginBottom:8,
       textTransform:"uppercase",
       letterSpacing:".05em"
      }}>
       {item.category}
      </span>

      <div style={{
       fontWeight:700,
       color:"#104c72",
       marginBottom:6
      }}>
       {item.title}
      </div>

      <p style={{
       margin:0,
       fontSize:12,
       lineHeight:1.6,
       color:"#475569"
      }}>
       {item.description}
      </p>
     </Link>
    ))}
   </div>
  </section>
 );
}