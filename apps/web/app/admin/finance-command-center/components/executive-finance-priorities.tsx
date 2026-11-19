"use client";

import {useMemo,useState} from "react";
import Link from "next/link";
import ExecutiveFinanceInvestigationOversight
 from "./executive-finance-investigation-oversight";
import ExecutiveFinanceInvestigationDetail, {
 type InvestigationSelection
} from "./executive-finance-investigation-detail";

export type InvestigationItem={
 id:string;
 title:string;
 description:string;
 category:string;
 href:string;
 createdAt?:string;
};

type Priority=
 "CRITICAL"|
 "HIGH"|
 "MEDIUM"|
 "NORMAL"|
 "UNCLASSIFIED";

type Classified={
 item:InvestigationItem;
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

const priorityRank:Record<Priority,number>={
 CRITICAL:0,
 HIGH:1,
 MEDIUM:2,
 NORMAL:3,
 UNCLASSIFIED:4
};

const priorityColors:Record<Priority,string>={
 CRITICAL:"#b91c1c",
 HIGH:"#c2410c",
 MEDIUM:"#a16207",
 NORMAL:"#104c72",
 UNCLASSIFIED:"#64748b"
};

function ageInDays(date?:string):number|null{

 if(!date)return null;

 const timestamp=Date.parse(date);

 if(!Number.isFinite(timestamp)){
  return null;
 }

 const elapsed=Date.now()-timestamp;

 if(elapsed<0){
  return null;
 }

 return Math.floor(elapsed/86400000);
}

function classify(item:InvestigationItem):Classified{

 const ageDays=ageInDays(item.createdAt);

 const text=(
  item.title+" "+
  item.category+" "+
  item.description
 ).toUpperCase();

 const disputed=text.includes(
  "DISPUTED_SETTLEMENT"
 )||text.includes(
  "DISPUTED SETTLEMENT"
 );

 const overReserved=text.includes(
  "OVER_RESERVED_INVOICE"
 )||text.includes(
  "OVER RESERVED INVOICE"
 );

 const investigating=text.includes(
  "INVESTIGATING"
 );

 const unreviewed=text.includes(
  "UNREVIEWED_SETTLEMENT"
 )||text.includes(
  "UNREVIEWED SETTLEMENT"
 );

 if(disputed){
  return {
   item,
   priority:"CRITICAL",
   ageDays,
   reason:"Disputed settlement evidence"
  };
 }

 if(ageDays!==null&&ageDays>=30){
  return {
   item,
   priority:"CRITICAL",
   ageDays,
   reason:"Unresolved item aged 30+ days"
  };
 }

 if(overReserved){
  return {
   item,
   priority:"HIGH",
   ageDays,
   reason:"Over-reserved invoice"
  };
 }

 if(investigating){
  return {
   item,
   priority:"HIGH",
   ageDays,
   reason:"Investigation in progress"
  };
 }

 if(ageDays!==null&&ageDays>=14){
  return {
   item,
   priority:"HIGH",
   ageDays,
   reason:"Unresolved item aged 14+ days"
  };
 }

 if(unreviewed){
  return {
   item,
   priority:"MEDIUM",
   ageDays,
   reason:"Unreviewed settlement evidence"
  };
 }

 if(ageDays!==null&&ageDays>=7){
  return {
   item,
   priority:"MEDIUM",
   ageDays,
   reason:"Unresolved item aged 7+ days"
  };
 }

 if(ageDays!==null){
  return {
   item,
   priority:"NORMAL",
   ageDays,
   reason:"Recent unresolved item"
  };
 }

 return {
  item,
  priority:"UNCLASSIFIED",
  ageDays:null,
  reason:"Insufficient source information"
 };
}

export default function ExecutiveFinancePriorities({
 supplierCases,
 retailCases,
 exceptions,
 agedAlerts,
 sourceStatus
}:{
 supplierCases:InvestigationItem[];
 retailCases:InvestigationItem[];
 exceptions:InvestigationItem[];
 agedAlerts:InvestigationItem[];
 sourceStatus:SourceStatus;
}){

 const [severity,setSeverity]=useState("ALL");
 const [category,setCategory]=useState("ALL");
 const [search,setSearch]=useState("");
 const [minimumAge,setMinimumAge]=useState(0);
 const [sort,setSort]=useState("PRIORITY");
const [selected,setSelected]=
  useState<InvestigationSelection|null>(null);

 const all=useMemo(()=>{

  const sources=[
   ...supplierCases,
   ...retailCases,
   ...exceptions,
   ...agedAlerts
  ];

  // De-duplicate only within the same category
  // and identifier. Cross-category items remain
  // separate because source identity may differ.

  const seen=new Set<string>();

  return sources.filter(x=>{

   const key=x.category+"::"+x.id;

   if(seen.has(key))return false;

   seen.add(key);

   return true;
  }).map(classify);

 },[
  supplierCases,
  retailCases,
  exceptions,
  agedAlerts
 ]);

 const filtered=useMemo(()=>{

  const q=search.trim().toLowerCase();

  const rows=all.filter(x=>{

   if(severity!=="ALL"&&
    x.priority!==severity){
    return false;
   }

   if(category!=="ALL"&&
    x.item.category!==category){
    return false;
   }

   if(minimumAge>0&&(
    x.ageDays===null||
    x.ageDays<minimumAge
   )){
    return false;
   }

   if(q){

    const haystack=(
     x.item.title+" "+
     x.item.description+" "+
     x.item.category+" "+
     x.item.id
    ).toLowerCase();

    if(!haystack.includes(q)){
     return false;
    }
   }

   return true;
  });

  rows.sort((a,b)=>{

   if(sort==="OLDEST"){

    if(a.ageDays===null&&b.ageDays!==null)return 1;
    if(b.ageDays===null&&a.ageDays!==null)return -1;

    return (b.ageDays??-1)-(a.ageDays??-1);
   }

   if(sort==="NEWEST"){

    if(a.ageDays===null&&b.ageDays!==null)return 1;
    if(b.ageDays===null&&a.ageDays!==null)return -1;

    return (a.ageDays??Infinity)-
     (b.ageDays??Infinity);
   }

   return priorityRank[a.priority]-
    priorityRank[b.priority]||
    (b.ageDays??-1)-(a.ageDays??-1);
  });

  return rows;

 },[
  all,
  severity,
  category,
  search,
  minimumAge,
  sort
 ]);

 const categories=Array.from(
  new Set(all.map(x=>x.item.category))
 ).sort();

 const counts={
  CRITICAL:all.filter(x=>x.priority==="CRITICAL").length,
  HIGH:all.filter(x=>x.priority==="HIGH").length,
  MEDIUM:all.filter(x=>x.priority==="MEDIUM").length,
  UNCLASSIFIED:all.filter(
   x=>x.priority==="UNCLASSIFIED"
  ).length
 };

 const unavailable=Object.entries(sourceStatus)
  .filter(([,available])=>!available)
  .map(([name])=>name);

 return (
  <section style={{
   border:"1px solid #dbe3ed",
   borderRadius:12,
   padding:18,
   marginTop:20,
   background:"#ffffff"
  }}>
   <header style={{marginBottom:17}}>
    <h3 style={{
     color:"#104c72",
     margin:"0 0 7px",
     fontSize:19
    }}>
     Investigation Priorities
    </h3>

    <p style={{
     margin:0,
     fontSize:12,
     color:"#64748b",
     lineHeight:1.7
    }}>
     Advisory severity classification based
     on returned case and exception data.
     No financial records are modified.
    </p>
   </header>

   {unavailable.length>0&&(
    <div role="status" style={{
     padding:12,
     background:"#fff7ed",
     border:"1px solid #fed7aa",
     borderRadius:8,
     color:"#9a3412",
     fontSize:12,
     marginBottom:15
    }}>
     Partial reporting: unavailable sources —
     {" "+unavailable.join(", ")}.
     Counts below cover available results only.
    </div>
   )}

   <ExecutiveFinanceInvestigationOversight
    items={all}
    sourceStatus={sourceStatus}
   />

   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(130px,1fr))",
    gap:10,
    marginBottom:18
   }}>
    {([
     ["CRITICAL",counts.CRITICAL],
     ["HIGH",counts.HIGH],
     ["MEDIUM",counts.MEDIUM],
     ["UNCLASSIFIED",counts.UNCLASSIFIED]
    ] as [Priority,number][]).map(([level,count])=>(
     <div key={level} style={{
      border:"1px solid #e2e8f0",
      borderRadius:9,
      padding:13
     }}>
      <div style={{
       fontSize:11,
       color:"#64748b"
      }}>
       {level}
      </div>

      <div style={{
       fontSize:25,
       fontWeight:700,
       color:priorityColors[level],
       marginTop:5
      }}>
       {count}
      </div>
     </div>
    ))}
   </div>

   <div style={{
    display:"grid",
    gridTemplateColumns:
     "repeat(auto-fit,minmax(150px,1fr))",
    gap:10,
    marginBottom:18
   }}>
    <label style={{fontSize:12}}>
     Severity
     <select
      value={severity}
      onChange={e=>setSeverity(e.target.value)}
      style={{display:"block",width:"100%",padding:9}}
     >
      {[
       "ALL",
       "CRITICAL",
       "HIGH",
       "MEDIUM",
       "NORMAL",
       "UNCLASSIFIED"
      ].map(x=>(
       <option key={x} value={x}>{x}</option>
      ))}
     </select>
    </label>

    <label style={{fontSize:12}}>
     Category
     <select
      value={category}
      onChange={e=>setCategory(e.target.value)}
      style={{display:"block",width:"100%",padding:9}}
     >
      <option value="ALL">All categories</option>
      {categories.map(x=>(
       <option key={x} value={x}>{x}</option>
      ))}
     </select>
    </label>

    <label style={{fontSize:12}}>
     Minimum age
     <select
      value={minimumAge}
      onChange={e=>setMinimumAge(Number(e.target.value))}
      style={{display:"block",width:"100%",padding:9}}
     >
      {[0,3,7,14,30,60,90].map(x=>(
       <option key={x} value={x}>
        {x===0?"Any age":x+"+ days"}
       </option>
      ))}
     </select>
    </label>

    <label style={{fontSize:12}}>
     Sort by
     <select
      value={sort}
      onChange={e=>setSort(e.target.value)}
      style={{display:"block",width:"100%",padding:9}}
     >
      <option value="PRIORITY">Highest priority</option>
      <option value="OLDEST">Oldest first</option>
      <option value="NEWEST">Newest first</option>
     </select>
    </label>
   </div>

   <label style={{
    display:"block",
    fontSize:12,
    marginBottom:15
   }}>
    Search investigations
    <input
     type="search"
     value={search}
     onChange={e=>setSearch(e.target.value)}
     placeholder="Search case, category or exception"
     style={{
      display:"block",
      width:"100%",
      padding:10,
      border:"1px solid #cbd5e1",
      borderRadius:8,
      marginTop:5
     }}
    />
   </label>

   <div style={{
    color:"#64748b",
    fontSize:12,
    marginBottom:12
   }}>
    Showing {filtered.length} of {all.length}
    {" "}returned investigation items
   </div>

   {filtered.length===0?(
    <p style={{
     color:"#64748b",
     fontSize:12
    }}>
     No returned items match the current filters.
    </p>
   ):(
    <div style={{display:"grid",gap:10}}>
     {filtered.map((row,i)=>(
      <div
       key={row.item.category+"-"+row.item.id+"-"+i}
       style={{
        border:"1px solid #e2e8f0",
        borderRadius:9,
        padding:13
       }}
      >
       <div style={{
        display:"flex",
        flexWrap:"wrap",
        justifyContent:"space-between",
        gap:10
       }}>
        <div>
         <div style={{
          fontSize:11,
          fontWeight:700,
          color:priorityColors[row.priority]
         }}>
          {row.priority}
         </div>

         <div style={{
          fontWeight:700,
          color:"#104c72",
          fontSize:13,
          marginTop:5
         }}>
          {row.item.title.replaceAll("_"," ")}
         </div>
        </div>

        <div style={{
         display:"flex",
         alignItems:"center",
         flexWrap:"wrap",
         gap:9
        }}>
         <button
          type="button"
          onClick={()=>setSelected(row)}
          style={{
           border:"1px solid #104c72",
           borderRadius:8,
           background:"#ffffff",
           color:"#104c72",
           padding:"8px 11px",
           fontSize:12,
           fontWeight:700,
           cursor:"pointer"
          }}
         >
          View Details
         </button>

         <Link
         href={row.item.href}
         style={{
          alignSelf:"center",
          color:"#ef3321",
          fontWeight:700,
          fontSize:12
         }}
        >
         Open investigation
        </Link>
        </div>
       </div>

       <p style={{
        fontSize:12,
        color:"#64748b",
        lineHeight:1.6,
        margin:"9px 0"
       }}>
        {row.item.description}
       </p>

       <div style={{
        fontSize:11,
        color:"#475569"
       }}>
        {row.item.category}
        {" · "}
        {row.ageDays===null
         ?"Age unavailable"
         :row.ageDays+" days old"}
        {" · "}
        {row.reason}
       </div>
      </div>
     ))}
    </div>
   )}

   <div id="rs-executive-investigation-queue" />
   <ExecutiveFinanceInvestigationDetail
    selection={selected}
    onClose={()=>setSelected(null)}
   />

   <p style={{
    margin:"17px 0 0",
    fontSize:11,
    color:"#64748b",
    lineHeight:1.7
   }}>
    Priorities are advisory. Source results may
    be truncated or overlap. Classification does
    not constitute an accounting determination,
    payment approval or confirmed financial loss.
   </p>
  </section>
 );
}