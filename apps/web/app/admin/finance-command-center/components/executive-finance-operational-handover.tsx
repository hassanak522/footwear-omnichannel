"use client";

import Link from "next/link";
import {useState} from "react";

type Workflow={
 id:string;
 title:string;
 description:string;
 href:string;
 external?:boolean;
};

const workflows:Workflow[]=[
 {
  id:"management-report",
  title:"Management Reporting",
  description:
   "Prepare executive briefings, meeting context, printable reports and CSV exports.",
  href:"#rs-executive-report-access"
 },
 {
  id:"investigation-priorities",
  title:"Investigation Prioritization",
  description:
   "Review advisory severity, aging, source information and investigation details.",
  href:"#rs-executive-investigation-queue"
 },
 {
  id:"priority-distribution",
  title:"Priority Distribution",
  description:
   "Understand the classification of currently returned investigation records.",
  href:"#rs-executive-priority-distribution"
 },
 {
  id:"investigation-aging",
  title:"Investigation Aging",
  description:
   "Review age bands and identify records without usable timestamps.",
  href:"#rs-executive-investigation-aging"
 },
 {
  id:"source-workload",
  title:"Source Workload",
  description:
   "Compare returned records across the configured finance sources.",
  href:"#rs-executive-source-workload"
 },
 {
  id:"management-attention",
  title:"Management Attention",
  description:
   "Review the highest-priority returned investigations and open source workflows.",
  href:"#rs-executive-management-attention"
 }
];

const operationalLinks=[
 {
  title:"Finance Casework",
  href:"/admin/finance-casework",
  description:
   "Review authorized supplier finance investigations and supporting case records."
 },
 {
  title:"Retail Finance Cases",
  href:"/admin/retail-finance/cases",
  description:
   "Review retail-specific cases in their original operational context."
 },
 {
  title:"Finance Operations",
  href:"/admin/finance-operations",
  description:
   "Review financial exceptions and supporting operational information."
 },
 {
  title:"Finance Reconciliation",
  href:"/admin/finance-reconciliation",
  description:
   "Review reconciliation information and available settlement evidence."
 },
 {
  title:"Finance Controls",
  href:"/admin/finance-controls",
  description:
   "Access the existing finance control and governance workspace."
 }
];

const steps=[
 {
  title:"Review the executive overview",
  description:
   "Start with existing financial intelligence and operational action indicators. Confirm the scope of returned records."
 },
 {
  title:"Identify management attention",
  description:
   "Use priority distribution, aging and source workload to identify investigations requiring further review."
 },
 {
  title:"Examine investigation details",
  description:
   "Use the existing prioritized queue and detail panel to review context, evidence limitations and suggested next steps."
 },
 {
  title:"Open authoritative workflows",
  description:
   "Follow the existing finance module links for operational review. Advisory summaries do not replace source records."
 },
 {
  title:"Prepare management reporting",
  description:
   "Enter meeting details, generate the executive briefing and review data-quality disclosures before distribution."
 },
 {
  title:"Distribute through approved channels",
  description:
   "Use existing Print / Save PDF or CSV export actions. Confirm recipients and handle files according to internal policy."
 }
];

const linkStyle={
 display:"block",
 padding:"12px 13px",
 border:"1px solid #dbe3ed",
 borderRadius:9,
 background:"#ffffff",
 textDecoration:"none",
 color:"#104c72",
 height:"100%"
};

export default function ExecutiveFinanceOperationalHandover(){

 const [guideOpen,setGuideOpen]=useState(false);

 return (
  <section
   aria-label="Executive finance operational navigation"
   style={{
    border:"1px solid #cbd5e1",
    borderRadius:12,
    background:"#f8fafc",
    padding:18,
    margin:"0 0 20px"
   }}
  >
   <div style={{
    display:"flex",
    justifyContent:"space-between",
    alignItems:"flex-start",
    flexWrap:"wrap",
    gap:12,
    marginBottom:16
   }}>
    <div>
     <div style={{
      fontSize:11,
      fontWeight:700,
      color:"#ef3321",
      letterSpacing:0.8,
      marginBottom:7
     }}>
      R5-C29N · EXECUTIVE WORKFLOW
     </div>

     <h3 style={{
      color:"#104c72",
      fontSize:19,
      margin:"0 0 7px"
     }}>
      Finance Management Workspace
     </h3>

     <p style={{
      color:"#64748b",
      fontSize:12,
      lineHeight:1.7,
      margin:0,
      maxWidth:700
     }}>
      Navigate existing investigation,
      management oversight and reporting
      capabilities without leaving the
      authorized finance workflow.
     </p>
    </div>

    <button
     type="button"
     aria-expanded={guideOpen}
     aria-controls="rs-finance-handover-guide"
     onClick={()=>setGuideOpen(x=>!x)}
     style={{
      padding:"10px 13px",
      background:"#104c72",
      color:"#ffffff",
      border:"none",
      borderRadius:8,
      cursor:"pointer",
      fontSize:12,
      fontWeight:700
     }}
    >
     {guideOpen
      ?"Hide Operational Guide"
      :"View Operational Guide"}
    </button>
   </div>

   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(210px,1fr))",
    gap:10
   }}>
    {workflows.map(workflow=>(
     <a
      key={workflow.id}
      href={workflow.href}
      style={linkStyle}
     >
      <div style={{
       fontSize:13,
       fontWeight:700,
       marginBottom:7
      }}>
       {workflow.title}
      </div>

      <div style={{
       fontSize:11,
       color:"#64748b",
       lineHeight:1.7
      }}>
       {workflow.description}
      </div>
     </a>
    ))}
   </div>

   <div style={{
    marginTop:17,
    paddingTop:15,
    borderTop:"1px solid #dbe3ed"
   }}>
    <h4 style={{
     fontSize:13,
     color:"#104c72",
     margin:"0 0 11px"
    }}>
     Authorized Source Workflows
    </h4>

    <div style={{
     display:"flex",
     flexWrap:"wrap",
     gap:8
    }}>
     {operationalLinks.map(link=>(
      <Link
       key={link.href}
       href={link.href}
       title={link.description}
       style={{
        display:"inline-block",
        padding:"9px 11px",
        border:"1px solid #cbd5e1",
        background:"#ffffff",
        borderRadius:8,
        color:"#104c72",
        textDecoration:"none",
        fontSize:12,
        fontWeight:700
       }}
      >
       {link.title}
      </Link>
     ))}
    </div>
   </div>

   {guideOpen&&(
    <div
     id="rs-finance-handover-guide"
     style={{
      border:"1px solid #dbe3ed",
      borderRadius:10,
      background:"#ffffff",
      padding:16,
      marginTop:18
     }}
    >
     <h4 style={{
      fontSize:16,
      color:"#104c72",
      margin:"0 0 12px"
     }}>
      Executive Finance Operational Handover
     </h4>

     <p style={{
      fontSize:12,
      color:"#64748b",
      lineHeight:1.8,
      margin:"0 0 15px"
     }}>
      This guide describes the intended
      management review sequence. It does
      not grant permissions, change case
      ownership or authorize financial
      transactions.
     </p>

     <ol style={{
      paddingLeft:22,
      margin:"0 0 18px"
     }}>
      {steps.map((step,index)=>(
       <li
        key={index}
        style={{
         paddingLeft:4,
         marginBottom:14,
         fontSize:12,
         lineHeight:1.7
        }}
       >
        <strong style={{
         color:"#104c72"
        }}>
         {step.title}
        </strong>

        <div style={{
         color:"#475569",
         marginTop:4
        }}>
         {step.description}
        </div>
       </li>
      ))}
     </ol>

     <div style={{
      background:"#f8fafc",
      border:"1px solid #e2e8f0",
      borderRadius:9,
      padding:14
     }}>
      <h5 style={{
       fontSize:13,
       color:"#104c72",
       margin:"0 0 10px"
      }}>
       Operational Boundaries
      </h5>

      <ul style={{
       paddingLeft:19,
       margin:0,
       fontSize:12,
       lineHeight:1.9,
       color:"#475569"
      }}>
       <li>
        Investigation priorities are advisory.
       </li>
       <li>
        Source records may be incomplete,
        truncated or unavailable.
       </li>
       <li>
        Multiple categories may describe
        the same underlying financial event.
       </li>
       <li>
        Unknown timestamps cannot establish
        investigation age.
       </li>
       <li>
        Management reports summarize loaded
        records, not certified financial balances.
       </li>
       <li>
        Original finance modules remain
        authoritative for operational actions.
       </li>
       <li>
        Report classifications are labels,
        not access-control mechanisms.
       </li>
       <li>
        Exported reports must be shared only
        with authorized recipients.
       </li>
      </ul>
     </div>
    </div>
   )}

   <p style={{
    fontSize:11,
    color:"#64748b",
    lineHeight:1.7,
    margin:"15px 0 0"
   }}>
    Navigation and handover guidance only.
    No additional finance requests, record
    modifications or approval operations
    are performed by this component.
   </p>
  </section>
 );
}