"use client";

import React,{useState} from "react";

type RequestFn=(
 path:string,
 method?:string,
 body?:unknown
)=>Promise<any>;

type Props={
 request:RequestFn;
};

const denominations=[
 5000,1000,500,100,50,20,10,5,2,1
];

const money=(value:unknown)=>
 "PKR "+Number(value??0).toLocaleString(
  "en-PK",
  {
   minimumFractionDigits:2,
   maximumFractionDigits:2
  }
 );

const panel:React.CSSProperties={
 border:"1px solid #cbd5e1",
 borderRadius:12,
 padding:20,
 marginTop:18,
 marginBottom:18
};

const grid:React.CSSProperties={
 display:"grid",
 gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",
 gap:12
};

const inputStyle:React.CSSProperties={
 padding:10,
 border:"1px solid #94a3b8",
 borderRadius:6,
 width:"100%",
 boxSizing:"border-box"
};

const buttonStyle:React.CSSProperties={
 padding:"10px 15px",
 borderRadius:6,
 border:"1px solid #64748b",
 cursor:"pointer"
};

export default function CashOperations({request}:Props){

 const [shiftId,setShiftId]=useState("");
 const [record,setRecord]=useState<any>(null);
 const [counts,setCounts]=useState<Record<string,number>>({});
 const [note,setNote]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState(false);

 const total=denominations.reduce(
  (sum,d)=>sum+d*(counts[String(d)]??0),
  0
 );

 const base="/cash-reconciliation/operations/";

 async function load(id=shiftId){

  const result=await request(
   base+encodeURIComponent(id.trim())
  );

  if(result.shiftId!==id.trim().toLowerCase()){
   throw new Error("Unexpected shift response");
  }

  setRecord(result);

  if(result.denominationCount){
   setCounts(result.denominationCount.denominations??{});
  }else{
   setCounts({});
  }

  return result;
 }

 async function run(action:()=>Promise<unknown>,success:string){

  if(busy)return;

  setBusy(true);
  setMessage("");
  setError(false);

  try{
   await action();
   setMessage(success);
  }catch(e){
   setError(true);
   setMessage(String(e));
  }finally{
   setBusy(false);
  }
 }

 async function mutate(
  path:string,
  method:string,
  body:unknown
 ){

  if(!record||record.shiftId!==shiftId.trim().toLowerCase()){
   throw new Error("Load the selected shift first");
  }

  await request(path,method,body);

  try{
   await load(record.shiftId);
  }catch(e){
   setRecord(null);
   throw new Error(
    "Action submitted. Refresh failed; reload the shift before retrying. "+
    String(e)
   );
  }

  setNote("");
 }

 const snapshot=record?.snapshot;
 const reconciliation=record?.reconciliation;
 const handover=record?.handover;

 const validCounts=denominations.every(d=>{
  const n=counts[String(d)]??0;
  return Number.isSafeInteger(n)&&n>=0&&n<=1000000;
 });

 const matches=!!snapshot&&
  validCounts&&
  Math.round(total*100)===
  Math.round(Number(snapshot.countedCash)*100);

 const noteValid=note.trim().length>=3&&
  note.trim().length<=1000;

 return (
  <section style={panel}>

   <h2>Shift Cash Operations</h2>

   <p>
    Review closed shifts, record cash denominations,
    reconcile cash and acknowledge physical handovers.
   </p>

   <label>
    Closed shift ID
    <input
     style={inputStyle}
     value={shiftId}
     disabled={busy}
     onChange={e=>{
      setShiftId(e.target.value);
      setRecord(null);
      setCounts({});
      setNote("");
      setMessage("");
     }}
     placeholder="Enter closed shift UUID"
    />
   </label>

   <button
    style={{...buttonStyle,marginTop:10}}
    disabled={busy||!shiftId.trim()}
    onClick={()=>run(
     async()=>{
      setRecord(null);
      await load();
     },
     "Shift loaded"
    )}
   >
    {busy?"Processing...":"Load closed shift"}
   </button>

   {message&&(
    <p role={error?"alert":"status"}
     style={{color:error?"#b91c1c":"#15803d"}}>
     {message}
    </p>
   )}

   {record&&snapshot&&(
    <>

     <div style={{...grid,marginTop:18}}>
      {[
       ["Opening cash",snapshot.openingCash],
       ["Recorded cash sales",snapshot.cashSales],
       ["Expected cash",snapshot.expectedCash],
       ["Counted cash",snapshot.countedCash],
       ["Variance",snapshot.variance]
      ].map(([label,value])=>(
       <div key={String(label)} style={panel}>
        <small>{label}</small>
        <h3>{money(value)}</h3>
       </div>
      ))}
     </div>

     <h3>Cash denomination count</h3>

     <div style={grid}>
      {denominations.map(d=>(
       <label key={d}>
        PKR {d.toLocaleString()}
        <input
         style={inputStyle}
         type="number"
         min="0"
         max="1000000"
         step="1"
         value={counts[String(d)]??0}
         disabled={busy||!!record.denominationCount}
         onChange={e=>setCounts(previous=>({
          ...previous,
          [String(d)]:Number(e.target.value)
         }))}
        />
        <small>
         {money(d*(counts[String(d)]??0))}
        </small>
       </label>
      ))}
     </div>

     <p>
      <strong>Denomination total: {money(total)}</strong>
     </p>

     <p>
      Difference from closing count:
      {" "+money(total-Number(snapshot.countedCash))}
     </p>

     {!record.denominationCount&&(
      <button
       style={buttonStyle}
       disabled={busy||!matches}
       onClick={()=>run(
        ()=>mutate(
         base+record.shiftId+"/denominations",
         "POST",
         {denominations:counts}
        ),
        "Denominations recorded"
       )}
      >
       Record verified denominations
      </button>
     )}

     <h3>Cash reconciliation</h3>

     <p>Status: {reconciliation?.status??"NOT SUBMITTED"}</p>

     {reconciliation?.reviewNote&&(
      <p>Review note: {reconciliation.reviewNote}</p>
     )}

     <h3>Cash handover</h3>

     <p>Status: {handover?.status??"NOT SUBMITTED"}</p>

     {handover&&(
      <p>Handover amount: {money(handover.amount)}</p>
     )}

     {handover?.acknowledgementNote&&(
      <p>Receipt note: {handover.acknowledgementNote}</p>
     )}

     <label>
      Operational note
      <textarea
       style={inputStyle}
       rows={3}
       maxLength={1000}
       disabled={busy}
       value={note}
       onChange={e=>setNote(e.target.value)}
       placeholder="Enter supporting operational details"
      />
     </label>

     <div style={{
      display:"flex",
      gap:10,
      flexWrap:"wrap",
      marginTop:12
     }}>

      {!reconciliation&&(
       <button
        style={buttonStyle}
        disabled={busy||!noteValid||!record.denominationCount}
        onClick={()=>run(
         ()=>mutate(
          "/cash-reconciliation/submit",
          "POST",
          {
           shiftId:record.shiftId,
           countedCash:Number(snapshot.countedCash),
           note:note.trim()
          }
         ),
         "Cash reconciliation submitted"
        )}
       >
        Submit reconciliation
       </button>
      )}

      {reconciliation?.status==="SUBMITTED"&&
       ["APPROVED","DISPUTED"].map(status=>(
        <button
         key={status}
         style={buttonStyle}
         disabled={busy||!noteValid}
         onClick={()=>run(
          ()=>mutate(
           "/cash-reconciliation/"+
           reconciliation.id+"/review",
           "PATCH",
           {status,note:note.trim()}
          ),
          "Reconciliation "+status.toLowerCase()
         )}
        >
         {status==="APPROVED"?
          "Approve reconciliation":
          "Dispute reconciliation"}
        </button>
       ))
      }

      {!handover&&record.reconciliationApproved&&
       record.denominationRecorded&&(
        <button
         style={buttonStyle}
         disabled={busy||!noteValid}
         onClick={()=>run(
          ()=>mutate(
           base+record.shiftId+"/handover",
           "POST",
           {note:note.trim()}
          ),
          "Cash handover submitted"
         )}
        >
         Submit cash handover
        </button>
      )}

      {handover?.status==="SUBMITTED"&&(
       <button
        style={buttonStyle}
        disabled={busy||!noteValid}
        onClick={()=>run(
         ()=>mutate(
          base+record.shiftId+"/handover/acknowledge",
          "POST",
          {note:note.trim()}
         ),
         "Cash receipt acknowledged"
        )}
       >
        Acknowledge physical receipt
       </button>
      )}

     </div>

     <p>
      Management actions require authorized accounts
      and independent review.
     </p>

     <h3>
      Cash operations:
      {" "+(record.cashOperationsComplete?
       "COMPLETE":"INCOMPLETE")}
     </h3>

    </>
   )}

  </section>
 );
}