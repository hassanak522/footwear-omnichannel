"use client";

import Link from "next/link";

export type InvestigationDetailItem={
 id:string;
 title:string;
 description:string;
 category:string;
 href:string;
 createdAt?:string;
};

export type InvestigationPriority=
 "CRITICAL"|
 "HIGH"|
 "MEDIUM"|
 "NORMAL"|
 "UNCLASSIFIED";

export type InvestigationSelection={
 item:InvestigationDetailItem;
 priority:InvestigationPriority;
 ageDays:number|null;
 reason:string;
};

const colors:Record<InvestigationPriority,string>={
 CRITICAL:"#b91c1c",
 HIGH:"#c2410c",
 MEDIUM:"#a16207",
 NORMAL:"#104c72",
 UNCLASSIFIED:"#64748b"
};

function formatDate(value?:string):string{

 if(!value){
  return "Unavailable";
 }

 const timestamp=Date.parse(value);

 if(!Number.isFinite(timestamp)){
  return "Unavailable";
 }

 return new Date(timestamp).toLocaleString();
}

function DetailField({
 label,
 value
}:{
 label:string;
 value:string;
}){
 return (
  <div style={{
   border:"1px solid #e2e8f0",
   borderRadius:9,
   padding:13,
   background:"#ffffff"
  }}>
   <div style={{
    color:"#64748b",
    fontSize:11,
    marginBottom:7
   }}>
    {label}
   </div>

   <div style={{
    color:"#104c72",
    fontSize:13,
    fontWeight:600,
    overflowWrap:"anywhere"
   }}>
    {value}
   </div>
  </div>
 );
}

function guidance(
 selection:InvestigationSelection
):string[]{

 const category=selection.item.category.toLowerCase();

 const text=(
  selection.item.title+" "+
  selection.item.description
 ).toLowerCase();

 const steps=[
  "Open the original finance module and verify the current record status.",
  "Review supporting evidence before making any financial decision."
 ];

 if(category.includes("retail")){

  steps.push(
   "Review the related retail sale, refund, shift or reconciliation evidence."
  );

 }else if(
  text.includes("settlement")||
  category.includes("supplier")
 ){

  steps.push(
   "Compare supplier payment requests, invoice records and settlement evidence."
  );

 }else{

  steps.push(
   "Confirm the underlying transaction and its supporting documents."
  );
 }

 if(selection.priority==="CRITICAL"){

  steps.push(
   "Escalate for timely management review under existing approval procedures."
  );

 }else if(selection.priority==="HIGH"){

  steps.push(
   "Prioritize review according to the existing finance workflow."
  );
 }

 steps.push(
  "Record any authorized decision in the original workflow, not in this dashboard."
 );

 return steps;
}

export default function ExecutiveFinanceInvestigationDetail({
 selection,
 onClose
}:{
 selection:InvestigationSelection|null;
 onClose:()=>void;
}){

 if(!selection)return null;

 const item=selection.item;

 return (
  <section
   aria-label="Investigation details"
   style={{
    marginTop:18,
    border:"1px solid #cbd5e1",
    borderRadius:12,
    background:"#f8fafc",
    padding:19
   }}
  >
   <div style={{
    display:"flex",
    justifyContent:"space-between",
    alignItems:"flex-start",
    gap:15,
    marginBottom:17
   }}>
    <div>
     <div style={{
      color:"#64748b",
      fontSize:11,
      fontWeight:700,
      letterSpacing:0.7,
      marginBottom:7
     }}>
      INVESTIGATION DETAIL
     </div>

     <h4 style={{
      color:"#104c72",
      fontSize:18,
      margin:"0 0 7px",
      overflowWrap:"anywhere"
     }}>
      {item.title.replaceAll("_"," ")}
     </h4>

     <span style={{
      display:"inline-block",
      padding:"5px 9px",
      borderRadius:7,
      color:"#ffffff",
      background:colors[selection.priority],
      fontSize:11,
      fontWeight:700
     }}>
      {selection.priority}
     </span>
    </div>

    <button
     type="button"
     onClick={onClose}
     aria-label="Close investigation details"
     style={{
      background:"#ffffff",
      border:"1px solid #cbd5e1",
      borderRadius:8,
      padding:"8px 12px",
      cursor:"pointer",
      color:"#104c72"
     }}
    >
     Close
    </button>
   </div>

   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(180px,1fr))",
    gap:11,
    marginBottom:17
   }}>
    <DetailField
     label="Source category"
     value={item.category}
    />

    <DetailField
     label="Source record identifier"
     value={item.id||"Unavailable"}
    />

    <DetailField
     label="Advisory priority"
     value={selection.priority}
    />

    <DetailField
     label="Priority explanation"
     value={selection.reason}
    />

    <DetailField
     label="Reported age"
     value={
      selection.ageDays===null
       ?"Unavailable"
       :selection.ageDays+" days"
     }
    />

    <DetailField
     label="Source creation timestamp"
     value={formatDate(item.createdAt)}
    />
   </div>

   <div style={{
    border:"1px solid #e2e8f0",
    borderRadius:9,
    padding:15,
    background:"#ffffff",
    marginBottom:15
   }}>
    <h5 style={{
     margin:"0 0 9px",
     fontSize:13,
     color:"#104c72"
    }}>
     Available source description
    </h5>

    <p style={{
     margin:0,
     fontSize:12,
     lineHeight:1.7,
     color:"#475569",
     whiteSpace:"pre-wrap"
    }}>
     {item.description}
    </p>
   </div>

   <div style={{
    border:"1px solid #e2e8f0",
    borderRadius:9,
    padding:15,
    background:"#ffffff",
    marginBottom:15
   }}>
    <h5 style={{
     margin:"0 0 12px",
     color:"#104c72",
     fontSize:13
    }}>
     Suggested investigation steps
    </h5>

    <ol style={{
     margin:"0 0 0 19px",
     padding:0,
     color:"#475569",
     fontSize:12,
     lineHeight:1.9
    }}>
     {guidance(selection).map((step,i)=>(
      <li key={i}>{step}</li>
     ))}
    </ol>
   </div>

   <div style={{
    background:"#fff7ed",
    border:"1px solid #fed7aa",
    borderRadius:9,
    padding:14,
    marginBottom:17,
    color:"#9a3412",
    fontSize:12,
    lineHeight:1.7
   }}>
    <strong>Evidence limitation</strong>

    <p style={{margin:"7px 0 0"}}>
     This panel shows only the information
     returned to the Action Center.
     It does not retrieve bank confirmations,
     supporting attachments, complete audit
     history or the current full case record.
     Review the original authorized finance
     module before making decisions.
    </p>
   </div>

   <Link
    href={item.href}
    style={{
     display:"inline-block",
     padding:"11px 16px",
     borderRadius:8,
     background:"#104c72",
     color:"#ffffff",
     textDecoration:"none",
     fontSize:13,
     fontWeight:700
    }}
   >
    Open Original Investigation Workflow
   </Link>

   <p style={{
    margin:"13px 0 0",
    color:"#64748b",
    fontSize:11,
    lineHeight:1.7
   }}>
    Read-only decision support.
    No case status, approval, settlement
    or accounting record is changed here.
   </p>
  </section>
 );
}