"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";

const groups=[
 {
  title:"Executive Finance",
  items:[
   {
    label:"Finance Command Center",
    href:"/admin/finance-command-center"
   },
   {
    label:"Finance Operations",
    href:"/admin/finance-operations"
   }
  ]
 },
 {
  title:"Reconciliation",
  items:[
   {
    label:"Payment Reconciliation",
    href:"/admin/payment-reconciliation"
   },
   {
    label:"Supplier Reconciliation",
    href:"/admin/finance-reconciliation"
   }
  ]
 },
 {
  title:"Controls & Investigations",
  items:[
   {
    label:"Finance Controls",
    href:"/admin/finance-controls"
   },
   {
    label:"Supplier Finance Casework",
    href:"/admin/finance-casework"
   },
   {
    label:"Retail Exception Cases",
    href:"/admin/retail-finance/cases"
   }
  ]
 },
 {
  title:"Retail Operations & Finance",
  items:[
   {
    label:"Retail Operations",
    href:"/admin/retail"
   },
   {
    label:"Recent Retail Finance",
    href:"/admin/retail-finance"
   },
   {
    label:"Historical Retail Finance",
    href:"/admin/retail-finance/historical"
   }
  ]
 }
];

export default function FinanceUnifiedNav(){

 const pathname=usePathname();

 return (
  <nav
   aria-label="Unified finance navigation"
   style={{
    padding:18,
    margin:"0 0 24px",
    border:"1px solid #dbe3ed",
    borderRadius:12,
    background:"#f8fafc"
   }}
  >

   <div
    style={{
     display:"flex",
     justifyContent:"space-between",
     alignItems:"center",
     flexWrap:"wrap",
     gap:10,
     marginBottom:16
    }}
   >

    <strong
     style={{
      fontSize:17,
      color:"#104c72"
     }}
    >
     Royal Step Finance Management
    </strong>

    <Link
     href="/admin"
     style={{
      color:"#104c72",
      fontWeight:600,
      textDecoration:"none"
     }}
    >
     HQ Console
    </Link>

   </div>

   <div
    style={{
     display:"grid",
     gridTemplateColumns:
      "repeat(auto-fit,minmax(190px,1fr))",
     gap:16
    }}
   >

    {groups.map(group=>(

     <section key={group.title}>

      <h2
       style={{
        fontSize:12,
        textTransform:"uppercase",
        letterSpacing:".06em",
        color:"#64748b",
        margin:"0 0 10px"
       }}
      >
       {group.title}
      </h2>

      <div
       style={{
        display:"flex",
        flexDirection:"column",
        gap:7
       }}
      >

       {group.items.map(item=>{

        const active=pathname===item.href;

        return (

         <Link
          key={item.href}
          href={item.href}
          aria-current={active?"page":undefined}
          style={{
           display:"block",
           padding:"9px 11px",
           borderRadius:7,
           border:"1px solid",
           borderColor:active
            ?"#104c72"
            :"#e2e8f0",
           background:active
            ?"#104c72"
            :"#ffffff",
           color:active
            ?"#ffffff"
            :"#104c72",
           textDecoration:"none",
           fontSize:13,
           fontWeight:active?700:500
          }}
         >
          {item.label}
         </Link>

        );

       })}

      </div>

     </section>

    ))}

   </div>

  </nav>
 );
}