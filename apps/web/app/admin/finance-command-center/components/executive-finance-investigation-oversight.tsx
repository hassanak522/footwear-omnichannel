"use client";

import Link from "next/link";
import ExecutiveFinanceOperationalHandover
 from "./executive-finance-operational-handover";
import ExecutiveFinanceManagementReport
 from "./executive-finance-management-report";

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

const priorityOrder:Priority[]=[
 "CRITICAL",
 "HIGH",
 "MEDIUM",
 "NORMAL",
 "UNCLASSIFIED"
];

const priorityColors:Record<Priority,string>={
 CRITICAL:"#b91c1c",
 HIGH:"#c2410c",
 MEDIUM:"#a16207",
 NORMAL:"#104c72",
 UNCLASSIFIED:"#64748b"
};

const sourceDefinitions=[
 {
  key:"supplierCases",
  label:"Supplier Cases",
  category:"Supplier finance case",
  href:"/admin/finance-casework"
 },
 {
  key:"retailCases",
  label:"Retail Cases",
  category:"Retail finance case",
  href:"/admin/retail-finance/cases"
 },
 {
  key:"exceptions",
  label:"Supplier Exceptions",
  category:"Supplier finance exception",
  href:"/admin/finance-operations"
 },
 {
  key:"agedAlerts",
  label:"Aged Alerts",
  category:"Aged finance alert",
  href:"/admin/finance-casework"
 }
] as const;

function CountCard({
 title,
 count,
 description,
 color
}:{
 title:string;
 count:number;
 description:string;
 color?:string;
}){
 return (
  <div style={{
   border:"1px solid #e2e8f0",
   background:"#ffffff",
   borderRadius:10,
   padding:14
  }}>
   <div style={{
    fontSize:12,
    color:"#64748b"
   }}>
    {title}
   </div>

   <div style={{
    fontSize:27,
    fontWeight:700,
    color:color||"#104c72",
    margin:"7px 0"
   }}>
    {count}
   </div>

   <div style={{
    fontSize:11,
    lineHeight:1.6,
    color:"#64748b"
   }}>
    {description}
   </div>
  </div>
 );
}

function DistributionRow({
 label,
 count,
 total,
 color
}:{
 label:string;
 count:number;
 total:number;
 color:string;
}){
 const percentage=total>0
  ?Math.round(count/total*100)
  :0;

 return (
  <div style={{marginBottom:13}}>
   <div style={{
    display:"flex",
    justifyContent:"space-between",
    gap:12,
    marginBottom:6,
    fontSize:12,
    color:"#475569"
   }}>
    <span>{label}</span>
    <strong>
     {count} ({percentage}%)
    </strong>
   </div>

   <div style={{
    height:9,
    background:"#e2e8f0",
    borderRadius:20,
    overflow:"hidden"
   }}>
    <div style={{
     width:percentage+"%",
     height:"100%",
     background:color,
     borderRadius:20
    }}/>
   </div>
  </div>
 );
}

export default function ExecutiveFinanceInvestigationOversight({
 items,
 sourceStatus
}:{
 items:TrackingItem[];
 sourceStatus:SourceStatus;
}){

 const total=items.length;

 const countPriority=(level:Priority)=>
  items.filter(x=>x.priority===level).length;

 const countAge=(minimum:number,maximum:number)=>
  items.filter(x=>
   x.ageDays!==null&&
   x.ageDays>=minimum&&
   x.ageDays<=maximum
  ).length;

 const unknownAge=items.filter(
  x=>x.ageDays===null
 ).length;

 const attention=items.filter(
  x=>x.priority==="CRITICAL"||
   x.priority==="HIGH"
 ).length;

 const aged=items.filter(
  x=>x.ageDays!==null&&x.ageDays>=14
 ).length;

 const unavailable=sourceDefinitions.filter(
  x=>!sourceStatus[x.key]
 );

 const sourceRows=sourceDefinitions.map(source=>({
  ...source,
  available:sourceStatus[source.key],
  count:items.filter(
   x=>x.item.category===source.category
  ).length
 }));

 const ageRows=[
  {
   label:"0–6 days",
   count:countAge(0,6),
   color:"#104c72"
  },
  {
   label:"7–13 days",
   count:countAge(7,13),
   color:"#64748b"
  },
  {
   label:"14–29 days",
   count:countAge(14,29),
   color:"#c2410c"
  },
  {
   label:"30+ days",
   count:items.filter(x=>
    x.ageDays!==null&&x.ageDays>=30
   ).length,
   color:"#b91c1c"
  },
  {
   label:"Unknown age",
   count:unknownAge,
   color:"#94a3b8"
  }
 ];

 const priorityRows=priorityOrder.map(level=>({
  label:level,
  count:countPriority(level),
  color:priorityColors[level]
 }));

 const attentionItems=items.filter(x=>
  x.priority==="CRITICAL"||
  x.priority==="HIGH"
 ).sort((a,b)=>{

  const rank=(x:Priority)=>
   priorityOrder.indexOf(x);

  return rank(a.priority)-rank(b.priority)||
   (b.ageDays??-1)-(a.ageDays??-1);

 }).slice(0,8);

 return (
  <section
   aria-label="Investigation management oversight"
   style={{
    border:"1px solid #dbe3ed",
    borderRadius:12,
    background:"#f8fafc",
    padding:18,
    margin:"18px 0 22px"
   }}
  >
   <header style={{marginBottom:18}}>
    <div style={{
     fontSize:11,
     fontWeight:700,
     color:"#ef3321",
     letterSpacing:0.8,
     marginBottom:6
    }}>
     MANAGEMENT OVERSIGHT
    </div>

    <h3 style={{
     color:"#104c72",
     fontSize:20,
     margin:"0 0 8px"
    }}>
     Investigation Tracking Overview
    </h3>

    <p style={{
     color:"#64748b",
     fontSize:12,
     lineHeight:1.7,
     margin:0
    }}>
     Read-only management summaries derived
     from the currently loaded investigation
     records. These are returned-item counts,
     not verified enterprise-wide totals.
    </p>
   </header>

   {unavailable.length>0&&(
    <div role="status" style={{
     border:"1px solid #fed7aa",
     borderRadius:9,
     padding:13,
     background:"#fff7ed",
     color:"#9a3412",
     fontSize:12,
     lineHeight:1.7,
     marginBottom:16
    }}>
     <strong>Partial reporting</strong>
     <div>
      Unavailable sources:{" "}
      {unavailable.map(x=>x.label).join(", ")}.
      Their outstanding workload cannot be
      determined from this dashboard.
     </div>
    </div>
   )}

   <ExecutiveFinanceOperationalHandover />

   <div id="rs-executive-report-access">
    <ExecutiveFinanceManagementReport
     items={items}
     sourceStatus={sourceStatus}
    />
   </div>

   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(155px,1fr))",
    gap:11,
    marginBottom:20
   }}>
    <CountCard
     title="Returned Items"
     count={total}
     description="Unique category and record combinations"
    />

    <CountCard
     title="Critical / High"
     count={attention}
     description="Advisory management attention"
     color="#c2410c"
    />

    <CountCard
     title="Aged 14+ Days"
     count={aged}
     description="Items with valid older timestamps"
    />

    <CountCard
     title="Unknown Age"
     count={unknownAge}
     description="Items without usable timestamps"
    />
   </div>

   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(270px,1fr))",
    gap:14,
    marginBottom:18
   }}>
    <div style={{
     border:"1px solid #e2e8f0",
     borderRadius:10,
     background:"#ffffff",
     padding:16
    }}>
     <h4 id="rs-executive-priority-distribution" style={{
      color:"#104c72",
      fontSize:14,
      margin:"0 0 16px"
     }}>
      Priority Distribution
     </h4>

     {priorityRows.map(x=>(
      <DistributionRow
       key={x.label}
       label={x.label}
       count={x.count}
       total={total}
       color={x.color}
      />
     ))}
    </div>

    <div style={{
     border:"1px solid #e2e8f0",
     borderRadius:10,
     background:"#ffffff",
     padding:16
    }}>
     <h4 id="rs-executive-investigation-aging" style={{
      color:"#104c72",
      fontSize:14,
      margin:"0 0 16px"
     }}>
      Investigation Aging
     </h4>

     {ageRows.map(x=>(
      <DistributionRow
       key={x.label}
       label={x.label}
       count={x.count}
       total={total}
       color={x.color}
      />
     ))}
    </div>
   </div>

   <div style={{
    border:"1px solid #e2e8f0",
    borderRadius:10,
    background:"#ffffff",
    padding:16,
    marginBottom:18
   }}>
    <h4 id="rs-executive-source-workload" style={{
     color:"#104c72",
     fontSize:14,
     margin:"0 0 14px"
    }}>
     Investigation Source Workload
    </h4>

    <div style={{
     display:"grid",
     gridTemplateColumns:
      "repeat(auto-fit,minmax(190px,1fr))",
     gap:11
    }}>
     {sourceRows.map(source=>(
      <div key={source.key} style={{
       border:"1px solid #e2e8f0",
       borderRadius:9,
       padding:13
      }}>
       <div style={{
        color:"#64748b",
        fontSize:11
       }}>
        {source.label}
       </div>

       <div style={{
        color:"#104c72",
        fontSize:24,
        fontWeight:700,
        margin:"7px 0"
       }}>
        {source.available
         ?source.count
         :"Unavailable"}
       </div>

       <Link
        href={source.href}
        style={{
         color:"#ef3321",
         fontWeight:700,
         fontSize:12
        }}
       >
        Open source workflow
       </Link>
      </div>
     ))}
    </div>
   </div>

   <div style={{
    border:"1px solid #e2e8f0",
    borderRadius:10,
    background:"#ffffff",
    padding:16
   }}>
    <h4 id="rs-executive-management-attention" style={{
     color:"#104c72",
     fontSize:14,
     margin:"0 0 7px"
    }}>
     Management Attention Queue
    </h4>

    <p style={{
     color:"#64748b",
     fontSize:11,
     lineHeight:1.7,
     margin:"0 0 14px"
    }}>
     Up to eight returned Critical or High
     priority items. Review the full
     investigation queue below for all records.
    </p>

    {attentionItems.length===0?(
     <p style={{
      color:"#64748b",
      fontSize:12
     }}>
      No Critical or High items were returned
      by the available sources.
     </p>
    ):(
     <div style={{display:"grid",gap:9}}>
      {attentionItems.map((row,i)=>(
       <div
        key={row.item.category+"-"+row.item.id+"-"+i}
        style={{
         border:"1px solid #e2e8f0",
         borderRadius:8,
         padding:12,
         display:"flex",
         flexWrap:"wrap",
         justifyContent:"space-between",
         gap:10
        }}
       >
        <div>
         <div style={{
          fontSize:11,
          fontWeight:700,
          color:priorityColors[row.priority]
         }}>
          {row.priority}
         </div>

         <div style={{
          fontSize:12,
          fontWeight:700,
          color:"#104c72",
          marginTop:5
         }}>
          {row.item.title.replaceAll("_"," ")}
         </div>

         <div style={{
          fontSize:11,
          color:"#64748b",
          marginTop:5
         }}>
          {row.item.category}
          {" · "}
          {row.ageDays===null
           ?"Age unavailable"
           :row.ageDays+" days"}
         </div>
        </div>

        <Link
         href={row.item.href}
         style={{
          color:"#ef3321",
          fontSize:12,
          fontWeight:700,
          alignSelf:"center"
         }}
        >
         Open investigation
        </Link>
       </div>
      ))}
     </div>
    )}
   </div>

   <p style={{
    color:"#64748b",
    fontSize:11,
    lineHeight:1.7,
    margin:"16px 0 0"
   }}>
    Counts may represent overlapping
    underlying financial events across
    different source categories.
    This overview does not establish
    unique financial exposure, confirmed
    losses, case ownership or resolution
    progress. All operational decisions
    remain in the original authorized modules.
   </p>
  </section>
 );
}