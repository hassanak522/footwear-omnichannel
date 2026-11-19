"use client";

import {useMemo,useState} from "react";

type Priority=
 "CRITICAL"|
 "HIGH"|
 "MEDIUM"|
 "NORMAL"|
 "UNCLASSIFIED";

type TrackingItem={
 item:{
  id:string;
  title:string;
  description:string;
  category:string;
  href:string;
  createdAt?:string;
 };
 priority:Priority;
 ageDays:number|null;
 reason:string;
};

type SourceStatus={
 supplierCases:boolean;
 retailCases:boolean;
 exceptions:boolean;
 agedAlerts:boolean;
};

const sourceNames=[
 {key:"supplierCases",label:"Supplier Cases",
  category:"Supplier finance case"},
 {key:"retailCases",label:"Retail Cases",
  category:"Retail finance case"},
 {key:"exceptions",label:"Supplier Exceptions",
  category:"Supplier finance exception"},
 {key:"agedAlerts",label:"Aged Alerts",
  category:"Aged finance alert"}
] as const;

const levels:Priority[]=[
 "CRITICAL","HIGH","MEDIUM",
 "NORMAL","UNCLASSIFIED"
];

const priorityRank:Record<Priority,number>={
 CRITICAL:0,
 HIGH:1,
 MEDIUM:2,
 NORMAL:3,
 UNCLASSIFIED:4
};

function csvCell(value:unknown):string{
 const raw=String(value??"");

 // Prevent spreadsheet formula execution when
 // opening exported data in spreadsheet software.
 const safe=/^[\s]*[=+\-@\t\r]/.test(raw)
  ?"'"+raw
  :raw;

 return '"'+safe.replace(/"/g,'""')+'"';
}

function downloadCsv(
 filename:string,
 rows:string[][]
){
 const content="\uFEFF"+rows.map(
  row=>row.map(csvCell).join(",")
 ).join("\r\n");

 const blob=new Blob([content],{
  type:"text/csv;charset=utf-8"
 });

 const url=URL.createObjectURL(blob);
 const link=document.createElement("a");

 link.href=url;
 link.download=filename;
 document.body.appendChild(link);
 link.click();
 link.remove();

 // Release the temporary URL after download starts.
 window.setTimeout(
  ()=>URL.revokeObjectURL(url),
  1000
 );
}

function SummaryMetric({
 label,
 value
}:{
 label:string;
 value:number|string;
}){
 return (
  <div style={{
   border:"1px solid #dbe3ed",
   borderRadius:9,
   padding:13,
   background:"#ffffff"
  }}>
   <div style={{
    fontSize:11,
    color:"#64748b"
   }}>
    {label}
   </div>
   <div style={{
    fontSize:23,
    fontWeight:700,
    color:"#104c72",
    marginTop:6
   }}>
    {value}
   </div>
  </div>
 );
}

export default function ExecutiveFinanceManagementReport({
 items,
 sourceStatus
}:{
 items:TrackingItem[];
 sourceStatus:SourceStatus;
}){

 const [expanded,setExpanded]=useState(false);
 const [reportDate,setReportDate]=useState<string|null>(null);

 // R5C29M_MEETING_PREPARATION
 const [meetingTitle,setMeetingTitle]=useState(
  "Executive Finance Review"
 );

 const [meetingDate,setMeetingDate]=useState("");

 const [meetingAudience,setMeetingAudience]=useState(
  "HQ Finance Management"
 );

 const [meetingAgenda,setMeetingAgenda]=useState("");

 const [preparedBy,setPreparedBy]=useState("");

 const [distribution,setDistribution]=useState(
  "INTERNAL_RESTRICTED"
 );

 const [exportConfirmed,setExportConfirmed]=useState(false);

 const [reportReference,setReportReference]=
  useState<string|null>(null);

 const report=useMemo(()=>{

  const priorityCounts=levels.map(level=>({
   label:level,
   count:items.filter(
    x=>x.priority===level
   ).length
  }));

  const aging=[
   {
    label:"0–6 days",
    count:items.filter(x=>
     x.ageDays!==null&&
     x.ageDays>=0&&x.ageDays<=6
    ).length
   },
   {
    label:"7–13 days",
    count:items.filter(x=>
     x.ageDays!==null&&
     x.ageDays>=7&&x.ageDays<=13
    ).length
   },
   {
    label:"14–29 days",
    count:items.filter(x=>
     x.ageDays!==null&&
     x.ageDays>=14&&x.ageDays<=29
    ).length
   },
   {
    label:"30+ days",
    count:items.filter(x=>
     x.ageDays!==null&&x.ageDays>=30
    ).length
   },
   {
    label:"Unknown age",
    count:items.filter(
     x=>x.ageDays===null
    ).length
   }
  ];

  const sources=sourceNames.map(source=>({
   label:source.label,
   available:sourceStatus[source.key],
   count:items.filter(
    x=>x.item.category===source.category
   ).length
  }));

  const attention=items.filter(x=>
   x.priority==="CRITICAL"||
   x.priority==="HIGH"
  ).sort((a,b)=>
   priorityRank[a.priority]-
    priorityRank[b.priority]||
   (b.ageDays??-1)-(a.ageDays??-1)
  );

  const missing=sources.filter(
   x=>!x.available
  ).map(x=>x.label);

  const unknownAge=items.filter(
   x=>x.ageDays===null
  ).length;

  const aged14=items.filter(
   x=>x.ageDays!==null&&
   x.ageDays>=14
  ).length;

  return {
   total:items.length,
   priorityCounts,
   aging,
   sources,
   attention,
   missing,
   unknownAge,
   aged14
  };

 },[items,sourceStatus]);

 function openReport(){

  const now=new Date();

  const reference=
   "RS-FIN-"+now.getFullYear()+
   String(now.getMonth()+1).padStart(2,"0")+
   String(now.getDate()).padStart(2,"0")+
   "-"+
   String(now.getHours()).padStart(2,"0")+
   String(now.getMinutes()).padStart(2,"0")+
   String(now.getSeconds()).padStart(2,"0");

  setReportDate(now.toLocaleString());
  setReportReference(reference);
  setExpanded(true);
 }

 function printReport(){

  if(!expanded){
   openReport();
  }

  // Printing occurs on the next rendering frame so
  // an expanded report can be included.
  window.requestAnimationFrame(()=>{
   window.requestAnimationFrame(()=>{
    window.print();
   });
  });
 }

 function exportCsv(){

  if(!exportConfirmed){
   const approved=window.confirm(
    "This export contains internal financial investigation information. "+
    "Confirm that the destination and recipients are authorized."
   );

   if(!approved)return;

   setExportConfirmed(true);
  }

  const rows:string[][]=[
   [
    "Record ID",
    "Title",
    "Category",
    "Priority",
    "Priority Reason",
    "Age Days",
    "Created At",
    "Description",
    "Workflow Path"
   ]
  ];

  for(const x of items){

   rows.push([
    x.item.id,
    x.item.title,
    x.item.category,
    x.priority,
    x.reason,
    x.ageDays===null
     ?"Unavailable"
     :String(x.ageDays),
    x.item.createdAt||"Unavailable",
    x.item.description,
    x.item.href
   ]);
  }

  const date=new Date()
   .toISOString()
   .slice(0,10);

  downloadCsv(
   "royal-step-finance-investigations-"+date+".csv",
   rows
  );
 }

 const tableStyle={
  width:"100%",
  borderCollapse:"collapse" as const,
  fontSize:12
 };

 const cellStyle={
  padding:"9px 10px",
  borderBottom:"1px solid #e2e8f0",
  textAlign:"left" as const,
  verticalAlign:"top" as const
 };

 return (
  <section
   aria-label="Executive management reporting"
   style={{
    border:"1px solid #cbd5e1",
    borderRadius:12,
    padding:17,
    background:"#ffffff",
    margin:"18px 0"
   }}
  >
   <div className="rs-report-controls" style={{
    display:"flex",
    justifyContent:"space-between",
    flexWrap:"wrap",
    gap:12,
    alignItems:"center"
   }}>
    <div>
     <h3 style={{
      color:"#104c72",
      margin:"0 0 6px",
      fontSize:18
     }}>
      Executive Investigation Report
     </h3>

     <p style={{
      color:"#64748b",
      fontSize:12,
      lineHeight:1.6,
      margin:0
     }}>
      Management summary, printable report
      and investigation register export.
     </p>
    </div>

    <div style={{
     display:"flex",
     flexWrap:"wrap",
     gap:8
    }}>
     <button
      type="button"
      onClick={()=>{
       if(expanded){
        setExpanded(false);
       }else{
        openReport();
       }
      }}
      style={{
       padding:"9px 12px",
       background:"#104c72",
       color:"#ffffff",
       border:"none",
       borderRadius:8,
       cursor:"pointer",
       fontWeight:700,
       fontSize:12
      }}
     >
      {expanded?"Hide Report":"Generate Report"}
     </button>

     <button
      type="button"
      onClick={printReport}
      style={{
       padding:"9px 12px",
       background:"#ffffff",
       color:"#104c72",
       border:"1px solid #104c72",
       borderRadius:8,
       cursor:"pointer",
       fontWeight:700,
       fontSize:12
      }}
     >
      Print / Save PDF
     </button>

     <button
      type="button"
      onClick={exportCsv}
      style={{
       padding:"9px 12px",
       background:"#ffffff",
       color:"#104c72",
       border:"1px solid #cbd5e1",
       borderRadius:8,
       cursor:"pointer",
       fontWeight:700,
       fontSize:12
      }}
     >
      Export CSV
     </button>
    </div>
   </div>

   {/* R5-C29M: Management meeting preparation */}
   <div className="rs-report-controls" style={{
    border:"1px solid #e2e8f0",
    borderRadius:10,
    background:"#f8fafc",
    padding:16,
    marginTop:18
   }}>
    <h4 style={{
     margin:"0 0 7px",
     color:"#104c72",
     fontSize:15
    }}>
     Management Meeting Preparation
    </h4>

    <p style={{
     margin:"0 0 16px",
     fontSize:12,
     color:"#64748b",
     lineHeight:1.7
    }}>
     Configure the report heading and meeting
     context before generating or printing.
     These fields are held only in this
     browser session and are not saved
     to the finance database.
    </p>

    <div style={{
     display:"grid",
     gridTemplateColumns:
      "repeat(auto-fit,minmax(210px,1fr))",
     gap:12
    }}>
     <label style={{
      display:"block",
      fontSize:12,
      color:"#475569"
     }}>
      Meeting title

      <input
       value={meetingTitle}
       maxLength={120}
       onChange={e=>setMeetingTitle(e.target.value)}
       style={{
        display:"block",
        width:"100%",
        padding:10,
        marginTop:5,
        border:"1px solid #cbd5e1",
        borderRadius:8
       }}
      />
     </label>

     <label style={{
      display:"block",
      fontSize:12,
      color:"#475569"
     }}>
      Meeting date

      <input
       type="date"
       value={meetingDate}
       onChange={e=>setMeetingDate(e.target.value)}
       style={{
        display:"block",
        width:"100%",
        padding:10,
        marginTop:5,
        border:"1px solid #cbd5e1",
        borderRadius:8
       }}
      />
     </label>

     <label style={{
      display:"block",
      fontSize:12,
      color:"#475569"
     }}>
      Intended audience

      <input
       value={meetingAudience}
       maxLength={120}
       onChange={e=>setMeetingAudience(e.target.value)}
       style={{
        display:"block",
        width:"100%",
        padding:10,
        marginTop:5,
        border:"1px solid #cbd5e1",
        borderRadius:8
       }}
      />
     </label>

     <label style={{
      display:"block",
      fontSize:12,
      color:"#475569"
     }}>
      Prepared by

      <input
       value={preparedBy}
       maxLength={120}
       onChange={e=>setPreparedBy(e.target.value)}
       placeholder="Optional"
       style={{
        display:"block",
        width:"100%",
        padding:10,
        marginTop:5,
        border:"1px solid #cbd5e1",
        borderRadius:8
       }}
      />
     </label>
    </div>

    <label style={{
     display:"block",
     fontSize:12,
     color:"#475569",
     marginTop:14
    }}>
     Management agenda / discussion notes

     <textarea
      value={meetingAgenda}
      maxLength={2000}
      onChange={e=>setMeetingAgenda(e.target.value)}
      rows={4}
      placeholder="Optional discussion topics"
      style={{
       display:"block",
       width:"100%",
       padding:10,
       marginTop:5,
       border:"1px solid #cbd5e1",
       borderRadius:8,
       resize:"vertical"
      }}
     />
    </label>

    <label style={{
     display:"block",
     fontSize:12,
     color:"#475569",
     marginTop:14
    }}>
     Distribution classification

     <select
      value={distribution}
      onChange={e=>{
       setDistribution(e.target.value);
       setExportConfirmed(false);
      }}
      style={{
       display:"block",
       width:"100%",
       padding:10,
       marginTop:5,
       border:"1px solid #cbd5e1",
       borderRadius:8
      }}
     >
      <option value="INTERNAL_RESTRICTED">
       Internal — Restricted
      </option>

      <option value="HQ_MANAGEMENT">
       HQ Management Only
      </option>

      <option value="AUTHORIZED_FINANCE">
       Authorized Finance Personnel
      </option>
     </select>
    </label>

    <p style={{
     fontSize:11,
     color:"#64748b",
     lineHeight:1.7,
     margin:"12px 0 0"
    }}>
     Classification is a report label,
     not an access-control mechanism.
     Share exported files only through
     approved internal channels.
    </p>
   </div>
   {expanded&&(
    <div
     id="rs-executive-finance-report"
     className="rs-printable-report"
     style={{
      marginTop:20,
      paddingTop:16,
      borderTop:"1px solid #e2e8f0",
      color:"#334155"
     }}
    >
     <header style={{
      borderBottom:"2px solid #104c72",
      paddingBottom:15,
      marginBottom:18
     }}>
      <div style={{
       color:"#ef3321",
       fontSize:12,
       fontWeight:700,
       letterSpacing:1
      }}>
       ROYAL STEP
      </div>

      <h2 style={{
       color:"#104c72",
       fontSize:23,
       margin:"7px 0"
      }}>
       Executive Finance Investigation Summary
      </h2>

      <div style={{
       color:"#64748b",
       fontSize:12,
       lineHeight:1.7
      }}>
       Report reference: {reportReference||"Unavailable"}

       <div>
        Generated: {reportDate||"Unavailable"}
       </div>

       <div>
        Meeting: {meetingTitle||"Executive Finance Review"}
       </div>

       <div>
        Meeting date: {meetingDate||"Not specified"}
       </div>

       <div>
        Audience: {meetingAudience||"Not specified"}
       </div>

       <div>
        Prepared by: {preparedBy||"Not specified"}
       </div>

       <div>
        Distribution: {distribution.replaceAll("_"," ")}
       </div>
       <div>
        Scope: Currently loaded investigation records
       </div>
       <div>
        Classification: Internal management reporting
       </div>
      </div>
     </header>

     {report.missing.length>0&&(
      <div style={{
       background:"#fff7ed",
       border:"1px solid #fed7aa",
       padding:12,
       borderRadius:8,
       marginBottom:18,
       fontSize:12,
       lineHeight:1.7
      }}>
       <strong>Incomplete source coverage</strong>
       <div>
        Unavailable sources:{" "}
        {report.missing.join(", ")}.
       </div>
      </div>
     )}

     <section style={{
      border:"1px solid #dbe3ed",
      borderRadius:9,
      padding:15,
      marginBottom:20,
      background:"#f8fafc"
     }}>
      <h3 style={{
       color:"#104c72",
       fontSize:16,
       margin:"0 0 12px"
      }}>
       Executive Briefing
      </h3>

      <p style={{
       fontSize:12,
       lineHeight:1.8,
       margin:"0 0 10px"
      }}>
       The currently loaded investigation
       register contains {report.total}
       {" "}returned entries, including
       {" "}{report.attention.length}
       {" "}classified as Critical or High
       priority. There are
       {" "}{report.aged14}
       {" "}entries aged at least 14 days,
       based on usable source timestamps.
      </p>

      <p style={{
       fontSize:12,
       lineHeight:1.8,
       margin:"0 0 10px"
      }}>
       {report.missing.length>0
        ? "Some reporting sources are unavailable: "+
          report.missing.join(", ")+"."
        : "All configured reporting sources returned data successfully; completeness of underlying records is not independently verified."}
      </p>

      <p style={{
       fontSize:12,
       lineHeight:1.8,
       margin:0
      }}>
       Recommended meeting focus:
       review high-priority investigations,
       examine aged items, confirm source
       evidence, and assign follow-up
       through existing authorized
       finance workflows.
      </p>

      {meetingAgenda.trim()!==""&&(
       <div style={{
        borderTop:"1px solid #e2e8f0",
        marginTop:13,
        paddingTop:12
       }}>
        <strong style={{
         fontSize:12,
         color:"#104c72"
        }}>
         Meeting Agenda
        </strong>

        <p style={{
         fontSize:12,
         lineHeight:1.8,
         whiteSpace:"pre-wrap",
         overflowWrap:"anywhere",
         margin:"7px 0 0"
        }}>
         {meetingAgenda}
        </p>
       </div>
      )}
     </section>

     <h3 style={{
      color:"#104c72",
      fontSize:16
     }}>
      1. Executive Summary
     </h3>

     <div style={{
      display:"grid",
      gridTemplateColumns:
       "repeat(auto-fit,minmax(135px,1fr))",
      gap:10,
      marginBottom:18
     }}>
      <SummaryMetric
       label="Returned Items"
       value={report.total}
      />

      <SummaryMetric
       label="Critical / High"
       value={report.attention.length}
      />

      <SummaryMetric
       label="Aged 14+ Days"
       value={report.aged14}
      />

      <SummaryMetric
       label="Unknown Age"
       value={report.unknownAge}
      />
     </div>

     <p style={{
      fontSize:12,
      lineHeight:1.8
     }}>
      This report summarizes {report.total}
      {" "}returned investigation entries.
      {" "}{report.attention.length}
      {" "}entries have Critical or High
      advisory priority.
      {" "}{report.aged14}
      {" "}entries have usable timestamps
      indicating an age of at least 14 days.
      {" "}{report.unknownAge}
      {" "}entries have unknown age.
     </p>

     <h3 style={{
      color:"#104c72",
      fontSize:16,
      marginTop:22
     }}>
      2. Priority Distribution
     </h3>

     <table style={tableStyle}>
      <thead>
       <tr>
        <th style={cellStyle}>Priority</th>
        <th style={cellStyle}>Returned Items</th>
       </tr>
      </thead>
      <tbody>
       {report.priorityCounts.map(x=>(
        <tr key={x.label}>
         <td style={cellStyle}>{x.label}</td>
         <td style={cellStyle}>{x.count}</td>
        </tr>
       ))}
      </tbody>
     </table>

     <h3 style={{
      color:"#104c72",
      fontSize:16,
      marginTop:22
     }}>
      3. Investigation Aging
     </h3>

     <table style={tableStyle}>
      <thead>
       <tr>
        <th style={cellStyle}>Age Category</th>
        <th style={cellStyle}>Returned Items</th>
       </tr>
      </thead>
      <tbody>
       {report.aging.map(x=>(
        <tr key={x.label}>
         <td style={cellStyle}>{x.label}</td>
         <td style={cellStyle}>{x.count}</td>
        </tr>
       ))}
      </tbody>
     </table>

     <h3 style={{
      color:"#104c72",
      fontSize:16,
      marginTop:22
     }}>
      4. Source Workload
     </h3>

     <table style={tableStyle}>
      <thead>
       <tr>
        <th style={cellStyle}>Source</th>
        <th style={cellStyle}>Returned Items</th>
       </tr>
      </thead>
      <tbody>
       {report.sources.map(x=>(
        <tr key={x.label}>
         <td style={cellStyle}>{x.label}</td>
         <td style={cellStyle}>
          {x.available?x.count:"Unavailable"}
         </td>
        </tr>
       ))}
      </tbody>
     </table>

     <h3 style={{
      color:"#104c72",
      fontSize:16,
      marginTop:22
     }}>
      5. Management Attention
     </h3>

     <p style={{
      fontSize:12,
      lineHeight:1.7
     }}>
      The following entries are the highest
      priority returned investigations.
      Their classification is advisory.
     </p>

     <table style={tableStyle}>
      <thead>
       <tr>
        <th style={cellStyle}>Investigation</th>
        <th style={cellStyle}>Priority</th>
        <th style={cellStyle}>Age</th>
       </tr>
      </thead>
      <tbody>
       {report.attention.slice(0,15).map((x,i)=>(
        <tr key={
         x.item.category+"-"+x.item.id+"-"+i
        }>
         <td style={cellStyle}>
          {x.item.title}
         </td>
         <td style={cellStyle}>
          {x.priority}
         </td>
         <td style={cellStyle}>
          {x.ageDays===null
           ?"Unavailable"
           :x.ageDays+" days"}
         </td>
        </tr>
       ))}
      </tbody>
     </table>

     {report.attention.length>15&&(
      <p style={{
       color:"#64748b",
       fontSize:11
      }}>
       Showing the first 15 of
       {" "}{report.attention.length}
       {" "}Critical / High returned entries.
       Use the investigation queue for
       additional records.
      </p>
     )}

     <h3 style={{
      color:"#104c72",
      fontSize:16,
      marginTop:22
     }}>
      6. Data Quality and Limitations
     </h3>

     <ul style={{
      fontSize:12,
      lineHeight:1.9,
      paddingLeft:21
     }}>
      <li>
       The report covers only currently
       loaded Action Center records.
      </li>
      <li>
       Source results may be truncated,
       incomplete or unavailable.
      </li>
      <li>
       Different categories may describe
       the same underlying financial event.
      </li>
      <li>
       Unknown timestamps cannot be used
       to establish investigation age.
      </li>
      <li>
       Priority is advisory and does not
       establish financial exposure or loss.
      </li>
      <li>
       Original finance modules remain
       authoritative for operational decisions.
      </li>
      <li>
       Report generation does not verify
       bank settlement or audit evidence.
      </li>
     </ul>

     <footer style={{
      borderTop:"1px solid #e2e8f0",
      marginTop:23,
      paddingTop:12,
      color:"#64748b",
      fontSize:11
     }}>
      Royal Step — Internal Management Report
      <div>
       Read-only investigation summary.
       Not an accounting certification.
      </div>
     </footer>
    </div>
   )}

   <style jsx global>{`
    @media print {
     @page {
      size: A4;
      margin: 14mm;
     }

     html,
     body {
      background: #ffffff !important;
     }

     #rs-executive-finance-report {
      color: #111827 !important;
      font-size: 11pt !important;
      line-height: 1.5 !important;
     }

     #rs-executive-finance-report
      table {
      table-layout: auto !important;
      width: 100% !important;
     }

     #rs-executive-finance-report
      th,
     #rs-executive-finance-report
      td {
      overflow-wrap: anywhere !important;
      word-break: normal !important;
     }

     #rs-executive-finance-report
      thead {
      display: table-header-group !important;
     }

     #rs-executive-finance-report
      tr {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
     }

     #rs-executive-finance-report
      h2,
     #rs-executive-finance-report
      h3 {
      break-after: avoid !important;
      page-break-after: avoid !important;
     }

     #rs-executive-finance-report
      section {
      break-inside: avoid;
     }

     #rs-executive-finance-report
      a {
      color: #104c72 !important;
      text-decoration: none !important;
     }

     #rs-executive-finance-report
      footer {
      break-inside: avoid;
     }

     body:has(#rs-executive-finance-report)
      * {
      visibility: hidden !important;
     }

     body:has(#rs-executive-finance-report)
      #rs-executive-finance-report,
     body:has(#rs-executive-finance-report)
      #rs-executive-finance-report * {
      visibility: visible !important;
     }

     #rs-executive-finance-report {
      position: absolute !important;
      left: 0 !important;
      top: 0 !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      background: white !important;
     }

     #rs-executive-finance-report table {
      width: 100% !important;
      border-collapse: collapse !important;
     }

     #rs-executive-finance-report tr,
     #rs-executive-finance-report
      .rs-report-metric {
      break-inside: avoid;
     }

     #rs-executive-finance-report h3 {
      break-after: avoid;
     }
    }
   `}</style>
  </section>
 );
}