"use client";

import {
 useEffect,
 useState
} from "react";

import Link from "next/link";

import ExecutiveFinanceWorkspace
 from "./executive-finance-workspace";

import ExecutiveFinancialIntelligence
 from "./executive-financial-intelligence";
import ExecutiveFinanceActionCenter from "./executive-finance-action-center";

import ExecutiveFinanceKpis
 from "./executive-finance-kpis";

type WorkspaceTab=
 |"overview"
 |"retail"
 |"supplier"
 |"investigations";

type NavigationItem={
 title:string;
 description:string;
 href:string;
};

const tabs:{
 id:WorkspaceTab;
 label:string;
 description:string;
}[]=[
 {
  id:"overview",
  label:"Executive Overview",
  description:"Management intelligence and oversight"
 },
 {
  id:"retail",
  label:"Retail Finance",
  description:"Branch finance and historical reporting"
 },
 {
  id:"supplier",
  label:"Supplier Finance",
  description:"Payments, reconciliation and controls"
 },
 {
  id:"investigations",
  label:"Financial Investigations",
  description:"Exceptions, casework and reviews"
 }
];

const navigation:Record<
 WorkspaceTab,
 NavigationItem[]
>={
 overview:[
  {
   title:"Finance Command Center",
   description:"Executive reporting and management oversight.",
   href:"/admin/finance-command-center"
  },
  {
   title:"Finance Operations",
   description:"Financial comparisons and operational reporting.",
   href:"/admin/finance-operations"
  }
 ],
 retail:[
  {
   title:"Recent Retail Finance",
   description:"Shift closings, cash reconciliation and refund obligations.",
   href:"/admin/retail-finance"
  },
  {
   title:"Historical Retail Finance",
   description:"Historical branch reporting and refund analysis.",
   href:"/admin/retail-finance/historical"
  },
  {
   title:"Retail Operations",
   description:"Branch sales, returns and operational reconciliation.",
   href:"/admin/retail"
  },
  {
   title:"Customer Finance",
   description:"Customer-related financial workflows.",
   href:"/admin/customer-finance"
  }
 ],
 supplier:[
  {
   title:"Supplier Reconciliation",
   description:"Supplier payment requests and settlement evidence.",
   href:"/admin/finance-reconciliation"
  },
  {
   title:"Finance Operations",
   description:"Supplier comparisons, statements and exceptions.",
   href:"/admin/finance-operations"
  },
  {
   title:"Financial Controls",
   description:"Accounting controls and settlement oversight.",
   href:"/admin/finance-controls"
  }
 ],
 investigations:[
  {
   title:"Retail Finance Cases",
   description:"Investigate retail finance exceptions.",
   href:"/admin/retail-finance/cases"
  },
  {
   title:"Supplier Finance Casework",
   description:"Review supplier finance investigations.",
   href:"/admin/finance-casework"
  },
  {
   title:"Payment Reconciliation",
   description:"Review payment reconciliation exceptions.",
   href:"/admin/payment-reconciliation"
  },
  {
   title:"Finance Operations Exceptions",
   description:"Review supplier settlement exceptions.",
   href:"/admin/finance-operations"
  }
 ]
};

function isWorkspace(value:string|null):value is WorkspaceTab{
 return value==="overview"||
  value==="retail"||
  value==="supplier"||
  value==="investigations";
}

function readWorkspace():WorkspaceTab{
 if(typeof window==="undefined"){
  return "overview";
 }

 const params=new URLSearchParams(
  window.location.search
 );

 const value=params.get("workspace");

 return isWorkspace(value)?value:"overview";
}

function NavigationCards({
 items
}:{
 items:NavigationItem[];
}){
 return (
  <div style={{
   display:"grid",
   gridTemplateColumns:
    "repeat(auto-fit,minmax(220px,1fr))",
   gap:12
  }}>
   {items.map(item=>(
    <Link
     key={item.href+item.title}
     href={item.href}
     style={{
      display:"block",
      padding:17,
      border:"1px solid #dbe3ed",
      borderRadius:10,
      background:"#ffffff",
      color:"#0f172a",
      textDecoration:"none"
     }}
    >
     <div style={{
      color:"#104c72",
      fontWeight:700,
      fontSize:14,
      marginBottom:8
     }}>
      {item.title}
     </div>

     <p style={{
      color:"#64748b",
      fontSize:12,
      lineHeight:1.65,
      margin:0
     }}>
      {item.description}
     </p>

     <div style={{
      color:"#ef3321",
      fontWeight:700,
      fontSize:12,
      marginTop:12
     }}>
      Open module
     </div>
    </Link>
   ))}
  </div>
 );
}

function StatusNote({
 title,
 children
}:{
 title:string;
 children:React.ReactNode;
}){
 return (
  <div style={{
   background:"#ffffff",
   border:"1px solid #dbe3ed",
   borderRadius:10,
   padding:14
  }}>
   <strong style={{
    color:"#104c72",
    fontSize:12
   }}>
    {title}
   </strong>

   <p style={{
    color:"#64748b",
    fontSize:11,
    lineHeight:1.7,
    margin:"7px 0 0"
   }}>
    {children}
   </p>
  </div>
 );
}

export default function ExecutiveFinanceConsolidated(){

 const [active,setActive]=useState<WorkspaceTab>(
  "overview"
 );

 useEffect(()=>{

  const sync=()=>{
   setActive(readWorkspace());
  };

  sync();

  window.addEventListener("popstate",sync);

  return ()=>{
   window.removeEventListener("popstate",sync);
  };

 },[]);

 function changeWorkspace(next:WorkspaceTab){

  setActive(next);

  const url=new URL(window.location.href);

  url.searchParams.set("workspace",next);

  window.history.pushState(
   {workspace:next},
   "",
   url.pathname+url.search+url.hash
  );
 }

 const current=tabs.find(x=>x.id===active)!;

 return (
  <section
   aria-label="Consolidated finance workspace"
   style={{
    background:"#f8fafc",
    border:"1px solid #dbe3ed",
    borderRadius:14,
    padding:20,
    margin:"22px 0"
   }}
  >
   <header style={{marginBottom:20}}>
    <div style={{
     fontSize:11,
     fontWeight:700,
     color:"#ef3321",
     letterSpacing:1,
     marginBottom:7
    }}>
     ROYAL STEP · HQ FINANCE
    </div>

    <h2 style={{
     color:"#104c72",
     fontSize:24,
     margin:"0 0 8px"
    }}>
     Executive Finance Command Center
    </h2>

    <p style={{
     color:"#64748b",
     fontSize:13,
     lineHeight:1.7,
     margin:0
    }}>
     Centralized financial intelligence,
     operational navigation and management oversight.
    </p>
   </header>

   <nav
    aria-label="Finance workspace navigation"
    style={{
     display:"grid",
     gridTemplateColumns:
      "repeat(auto-fit,minmax(170px,1fr))",
     gap:9,
     marginBottom:20
    }}
   >
    {tabs.map(tab=>(
     <button
      key={tab.id}
      type="button"
      aria-current={
       active===tab.id?"page":undefined
      }
      onClick={()=>changeWorkspace(tab.id)}
      style={{
       borderRadius:9,
       border:active===tab.id
        ?"2px solid #104c72"
        :"1px solid #cbd5e1",
       background:active===tab.id
        ?"#eaf4fb"
        :"#ffffff",
       padding:"14px 12px",
       cursor:"pointer",
       textAlign:"left"
      }}
     >
      <div style={{
       color:"#104c72",
       fontWeight:700,
       fontSize:13
      }}>
       {tab.label}
      </div>

      <div style={{
       color:"#64748b",
       fontSize:11,
       marginTop:6,
       lineHeight:1.5
      }}>
       {tab.description}
      </div>
     </button>
    ))}
   </nav>

   <div>
    <h3 style={{
     color:"#104c72",
     fontSize:19,
     margin:"0 0 15px"
    }}>
     {current.label}
    </h3>

    {active==="overview"&&(
     <>
      <ExecutiveFinanceWorkspace/>

      <ExecutiveFinancialIntelligence/>
<ExecutiveFinanceActionCenter/>

      <details style={{
       background:"#ffffff",
       border:"1px solid #dbe3ed",
       borderRadius:10,
       padding:15,
       marginTop:17
      }}>
       <summary style={{
        color:"#104c72",
        fontWeight:700,
        fontSize:14,
        cursor:"pointer"
       }}>
        Detailed KPI Reports & Technical Data
       </summary>

       <p style={{
        color:"#64748b",
        fontSize:12,
        marginTop:12
       }}>
        Existing R5-C29D financial reports,
        technical fields and raw API data.
       </p>

       <ExecutiveFinanceKpis/>
      </details>
     </>
    )}

    {active!=="overview"&&(
     <>
      <NavigationCards items={navigation[active]}/>

      <div style={{
       marginTop:20,
       display:"grid",
       gridTemplateColumns:
        "repeat(auto-fit,minmax(220px,1fr))",
       gap:12
      }}>
       <StatusNote title="Operational Status">
        Existing financial workflows remain
        active in their original modules.
       </StatusNote>

       <StatusNote title="Authorization">
        Location and role permissions continue
        to be enforced by the backend.
       </StatusNote>

       <StatusNote title="Financial Integrity">
        No financial transactions or accounting
        calculations are performed by this navigation.
       </StatusNote>
      </div>
     </>
    )}

    <div style={{
     borderTop:"1px solid #dbe3ed",
     marginTop:22,
     paddingTop:15
    }}>
     <strong style={{
      color:"#104c72",
      fontSize:13
     }}>
      Quick Actions
     </strong>

     <div style={{
      display:"flex",
      flexWrap:"wrap",
      gap:10,
      marginTop:12
     }}>
      {navigation[active].map(item=>(
       <Link
        key={item.href+item.title}
        href={item.href}
        style={{
         border:"1px solid #cbd5e1",
         borderRadius:8,
         background:"#ffffff",
         padding:"9px 12px",
         color:"#104c72",
         fontSize:12,
         fontWeight:600,
         textDecoration:"none"
        }}
       >
        {item.title}
       </Link>
      ))}
     </div>
    </div>
   </div>

   <footer style={{
    borderTop:"1px solid #dbe3ed",
    marginTop:20,
    paddingTop:14,
    color:"#64748b",
    fontSize:11,
    lineHeight:1.7
   }}>
    Financial reporting is read-only.
    Supplier settlement evidence is not
    independently bank-confirmed.
    Existing accounting controls and
    authorization remain unchanged.
   </footer>
  </section>
 );
}