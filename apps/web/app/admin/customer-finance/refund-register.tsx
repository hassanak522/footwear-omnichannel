"use client";

import React,{useState} from "react";

type Props={
 request:(
  path:string,
  method?:string,
  body?:unknown
 )=>Promise<any>;
};

type RefundRow={
 returnId:string;
 saleId:string;
 locationId:string;
 createdAt:string;
 originalReturnValue:string;
 exchangeCredit:string;
 refundDue:string;
 ordinaryRefundPaid:string;
 historicalRefundPaid:string;
 legacyRefundPaid:string;
 refundSettled:string;
 refundOutstanding:string;
 refundOverpayment:string;
 settlementStatus:string;
 blockers:string[];
 refundExecutionBlocked:boolean;
 requiresReconciliation:boolean;
};

const money=(value:unknown)=>
 Number(value??0).toLocaleString("en-PK",{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 });

export default function RefundRegister({request}:Props){

 const [location,setLocation]=useState("");
 const [rows,setRows]=useState<RefundRow[]>([]);
 const [cursor,setCursor]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [loaded,setLoaded]=useState(false);
 const [filter,setFilter]=useState("ALL");

 async function load(next=false){

  setBusy(true);
  setError("");

  if(!next){
   setRows([]);
   setCursor(null);
   setLoaded(false);
  }

  try{

   const query=new URLSearchParams({limit:"25"});

   if(location.trim()){
    query.set("locationId",location.trim());
   }

   if(next&&cursor){
    query.set("cursor",cursor);
   }

   const result=await request(
    "/customer-finance/refund-positions?"+
    query.toString()
   );

   if(!Array.isArray(result.rows)){
    throw new Error("Invalid refund register response");
   }

   setRows(previous=>next
    ?[
      ...previous,
      ...result.rows.filter((r:RefundRow)=>
       !previous.some(p=>p.returnId===r.returnId)
      )
     ]
    :result.rows
   );

   setCursor(result.nextCursor??null);
   setLoaded(true);

  }catch(e){
   setError(String(e));
  }finally{
   setBusy(false);
  }
 }

 const visible=rows.filter(r=>{
  if(filter==="OUTSTANDING"){
   return Number(r.refundOutstanding)>0;
  }

  if(filter==="OVERPAID"){
   return Number(r.refundOverpayment)>0;
  }

  if(filter==="RECONCILIATION"){
   return r.requiresReconciliation;
  }

  return true;
 });

 function exportCsv(){

  const fields=[
   "returnId",
   "saleId",
   "locationId",
   "createdAt",
   "originalReturnValue",
   "exchangeCredit",
   "refundDue",
   "ordinaryRefundPaid",
   "historicalRefundPaid",
   "legacyRefundPaid",
   "refundSettled",
   "refundOutstanding",
   "refundOverpayment",
   "settlementStatus",
   "blockers"
  ] as const;

  const escape=(value:unknown)=>{
   let s=Array.isArray(value)
    ?value.join("; ")
    :String(value??"");

   if(/^[=+@\-\t\r]/.test(s)){
    s="'"+s;
   }

   return '"'+s.replace(/"/g,'""')+'"';
  };

  const csv=[
   fields.join(","),
   ...visible.map(r=>
    fields.map(f=>escape(r[f])).join(",")
   )
  ].join("\r\n");

  const url=URL.createObjectURL(
   new Blob(["\uFEFF",csv],{
    type:"text/csv;charset=utf-8"
   })
  );

  const link=document.createElement("a");

  link.href=url;
  link.download="royal-step-loaded-refund-register.csv";

  link.click();

  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }

 return (
  <section style={{
   padding:20,
   border:"1px solid #cbd5e1",
   borderRadius:12,
   marginBottom:20
  }}>

   <h2>Authoritative Refund Register</h2>

   <p>
    Recorded refund obligations and payment evidence.
    This register does not execute payments.
   </p>

   <div style={{
    display:"flex",
    flexWrap:"wrap",
    gap:10,
    marginBottom:15
   }}>

    <input
     value={location}
     disabled={busy}
     onChange={e=>{
      setLocation(e.target.value);
      setRows([]);
      setCursor(null);
      setLoaded(false);
     }}
     placeholder="Location UUID (optional)"
    />

    <select
     value={filter}
     onChange={e=>setFilter(e.target.value)}
    >
     <option value="ALL">All loaded returns</option>
     <option value="OUTSTANDING">Outstanding</option>
     <option value="OVERPAID">Overpaid</option>
     <option value="RECONCILIATION">Needs reconciliation</option>
    </select>

    <button disabled={busy} onClick={()=>load()}>
     Refresh register
    </button>

    <button
     disabled={busy||!visible.length}
     onClick={exportCsv}
    >
     Export loaded rows
    </button>

   </div>

   {error&&<p role="alert">{error}</p>}

   {loaded&&(
    <p>
     Loaded {rows.length} returns.
     Showing {visible.length}.
     {cursor?" Additional records available.":""}
    </p>
   )}

   <div style={{overflowX:"auto"}}>

    <table style={{
     width:"100%",
     borderCollapse:"collapse",
     fontSize:13
    }}>

     <thead>
      <tr>
       {[
        "Return",
        "Refund due",
        "POS paid",
        "Historical paid",
        "Legacy paid",
        "Recorded total",
        "Outstanding",
        "Overpayment",
        "Status",
        "Restrictions"
       ].map(h=>(
        <th key={h} style={{
         padding:10,
         textAlign:"left",
         borderBottom:"1px solid #cbd5e1"
        }}>{h}</th>
       ))}
      </tr>
     </thead>

     <tbody>
      {visible.map(r=>(
       <tr key={r.returnId}>

        {[
         r.returnId,
         money(r.refundDue),
         money(r.ordinaryRefundPaid),
         money(r.historicalRefundPaid),
         money(r.legacyRefundPaid),
         money(r.refundSettled),
         money(r.refundOutstanding),
         money(r.refundOverpayment),
         r.settlementStatus,
         r.blockers?.join(", ")||"None recorded"
        ].map((value,i)=>(
         <td key={i} style={{
          padding:10,
          borderBottom:"1px solid #e2e8f0",
          overflowWrap:"anywhere"
         }}>{value}</td>
        ))}

       </tr>
      ))}
     </tbody>

    </table>

   </div>

   {cursor&&(
    <button
     disabled={busy}
     onClick={()=>load(true)}
    >
     Load more returns
    </button>
   )}

   <p>
    Amounts in PKR. Filters and exports apply only to
    loaded records. Cross-workflow payment evidence
    may require independent reconciliation.
   </p>

  </section>
 );
}