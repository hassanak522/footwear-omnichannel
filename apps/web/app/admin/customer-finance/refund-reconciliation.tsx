// R10_3D24C_HQ_REFUND_RECONCILIATION

"use client";

import {useEffect,useRef,useState} from "react";
import PaymentInvestigation from "./payment-investigation";

type Props={
 call:(
  path:string,
  method?:string,
  body?:unknown
 )=>Promise<any>;
};

type Branch={
 id:string;
 name:string;
 code:string;
};

type Refund={
 id:string;
 idempotencyKey:string;
 returnId:string;
 locationId:string;
 deviceId:string;
 shiftId:string;
 amount:string;
 method:string;
 status:string;
 paymentState:string;
 registeredById:string;
 createdAt:string;
 updatedAt:string;
 canResume:boolean;
 canCancel:boolean;
 requiresReconciliation:boolean;
};

const base="/pos/returns/settlements";

const panel:React.CSSProperties={
 background:"#fff",
 border:"1px solid #dbe3ed",
 borderRadius:12,
 padding:22,
 marginBottom:20
};

const button:React.CSSProperties={
 padding:"10px 14px",
 background:"#104c72",
 color:"#fff",
 border:0,
 borderRadius:7,
 cursor:"pointer",
 marginRight:8,
 marginBottom:8
};

const field:React.CSSProperties={
 padding:10,
 border:"1px solid #cbd5e1",
 borderRadius:7,
 width:"100%",
 boxSizing:"border-box"
};

export default function RefundReconciliation({
 call
}:Props){

 const [branches,setBranches]=useState<Branch[]>([]);
 const [location,setLocation]=useState("");
 const [records,setRecords]=useState<Refund[]>([]);
 const [busy,setBusy]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [truncated,setTruncated]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const [checkedAt,setCheckedAt]=useState("");

 const active=useRef(false);

 useEffect(()=>{

  let mounted=true;

  async function initialize(){

   try{

    const data=await call("/inventory/locations");

    const items=Array.isArray(data)
     ?data
     :data.locations||data.data;

    if(!Array.isArray(items)){
     throw Error("Unexpected location response");
    }

    const result=items
     .filter((item:any)=>
      item.type==="BRANCH"&&
      typeof item.id==="string"
     )
     .map((item:any)=>({
      id:item.id,
      name:String(item.name||item.code),
      code:String(item.code||"")
     }));

    if(mounted){
     setBranches(result);

     if(result.length===1){
      setLocation(result[0].id);
     }
    }

   }catch(e){
    if(mounted)setError(String(e));
   }
  }

  void initialize();

  return ()=>{mounted=false;};

 },[]);

 async function load(){

  if(!branches.some(b=>b.id===location)){
   throw Error("Select an authorized branch");
  }

  const result=await call(
   `${base}/pending?locationId=${encodeURIComponent(location)}`
  );

  if(
   result.locationId!==location||
   !Array.isArray(result.records)
  ){
   throw Error("Invalid refund discovery response");
  }

  for(const item of result.records){

   if(
    item.locationId!==location||
    item.id!==item.idempotencyKey||
    !item.returnId||
    !item.deviceId||
    !item.shiftId||
    !Number.isFinite(Number(item.amount))||
    Number(item.amount)<=0
   ){
    throw Error("Refund identity or amount mismatch");
   }
  }

  setRecords(result.records);
  setTruncated(result.truncated===true);
  setCheckedAt(
   result.fetchedAt||new Date().toISOString()
  );
  setLoaded(true);
 }

 async function run(action:()=>Promise<void>){

  if(active.current)return;

  active.current=true;
  setBusy(true);
  setError("");
  setMessage("");

  try{
   await action();
  }catch(e){
   setError(
    e instanceof Error?e.message:String(e)
   );
  }finally{
   active.current=false;
   setBusy(false);
  }
 }

 async function status(item:Refund){

  const result=await call(
   `${base}/status/${item.id}`
  );

  if(
   result.found!==true||
   result.idempotencyKey!==item.id||
   result.locationId!==location||
   result.returnId!==item.returnId||
   result.deviceId!==item.deviceId||
   result.shiftId!==item.shiftId||
   result.method!==item.method||
   Math.round(Number(result.amount)*100)!==
    Math.round(Number(item.amount)*100)
  ){
   throw Error("Authoritative refund identity mismatch");
  }

  return result;
 }

 async function recover(
  item:Refund,
  action:"CHECK"|"RESUME"|"CANCEL"
 ){

  const state=await status(item);

  if(state.status==="ACCEPTED"){

   if(
    state.integrityVerified!==true||
    state.centralAttemptVerified!==true
   ){
    throw Error("Settlement integrity is not verified");
   }

   setMessage("Existing financial settlement verified.");
   await load();
   return;
  }

  if(state.status==="RESOLVED_NO_PAYMENT"){

   setMessage("Reservation already resolved.");
   await load();
   return;
  }

  if(action==="CHECK"){

   setMessage(
    `${item.id}: ${state.status} / ${state.paymentState}`
   );

   await load();
   return;
  }

  if(action==="RESUME"){

   if(
    state.status!=="PAID"||
    state.paymentState!=="CONFIRMED"
   ){
    throw Error("Confirmed prior payment is required");
   }

   if(!window.confirm(
    "Finalize the previously paid refund? "+
    "This action does not issue another payment."
   ))return;

   await call(
    `${base}/${item.id}/resume`,
    "POST"
   );

   const result=await status(item);

   if(
    result.status!=="ACCEPTED"||
    result.integrityVerified!==true||
    result.centralAttemptVerified!==true
   ){
    throw Error("Financial settlement requires verification");
   }

   setMessage("Financial settlement completed.");

  }else{

   if(
    !item.canCancel||
    state.status!=="REGISTERED"||
    state.paymentState!=="UNCONFIRMED"
   ){
    throw Error(
     "Only unauthorized unpaid reservations may be cancelled"
    );
   }

   const reason=window.prompt(
    "Enter the cancellation reason."
   )?.trim();

   if(reason===undefined)return;

   if(reason.length<10||reason.length>500){
    throw Error("Reason must contain 10-500 characters");
   }

   const evidenceReference=window.prompt(
    "Enter the investigation or evidence reference."
   )?.trim();

   if(evidenceReference===undefined)return;

   if(
    evidenceReference.length<5||
    evidenceReference.length>200
   ){
    throw Error("Evidence must contain 5-200 characters");
   }

   if(!window.confirm(
    "Confirm that payment was never authorized "+
    "and was never issued."
   ))return;

   await call(
    `${base}/${item.id}/resolve-no-payment`,
    "POST",
    {reason,evidenceReference}
   );

   const result=await status(item);

   if(
    result.status!=="RESOLVED_NO_PAYMENT"||
    result.paymentState!=="NOT_PAID"
   ){
    throw Error("Resolution requires verification");
   }

   setMessage("Unpaid refund reservation resolved.");
  }

  await load();
 }

 const uncertain=records.filter(
  r=>r.status==="PAYMENT_AUTHORIZED"&&
     r.paymentState==="UNKNOWN"
 );

 const confirmed=records.filter(
  r=>r.status==="PAID"&&
     r.paymentState==="CONFIRMED"
 );

 const reserved=records.filter(
  r=>r.status==="REGISTERED"
 );

 const total=records.reduce(
  (sum,r)=>sum+Math.round(Number(r.amount)*100),0
 )/100;

 return (

  <section style={panel}>

   <h2 style={{color:"#104c72"}}>
    Central Refund Reconciliation
   </h2>

   <p style={{color:"#64748b"}}>
    Review unresolved refunds across authorized branches,
    including refunds from unavailable POS terminals.
   </p>

   <p style={{
    background:"#fffbeb",
    color:"#92400e",
    padding:12,
    borderRadius:8
   }}>
    Recovery records financial outcomes only.
    Never repeat a physical payment.
    Uncertain payments must remain reserved
    until independently reconciled.
   </p>

   <label style={{display:"grid",gap:8}}>
    <strong>Retail Branch</strong>

    <select
     style={field}
     value={location}
     disabled={busy}
     onChange={e=>{
      setLocation(e.target.value);
      setRecords([]);
      setLoaded(false);
      setTruncated(false);
      setMessage("");
      setError("");
      setCheckedAt("");
     }}
    >
     <option value="">Select branch</option>

     {branches.map(branch=>(
      <option key={branch.id} value={branch.id}>
       {branch.name} ({branch.code})
      </option>
     ))}
    </select>
   </label>

   <div style={{marginTop:14}}>
    <button
     type="button"
     style={button}
     disabled={busy||!location}
     onClick={()=>void run(async()=>{
      setLoaded(false);
      setRecords([]);
      await load();
     })}
    >
     {busy?"Processing...":"Load Pending Refunds"}
    </button>
   </div>

   {loaded&&(
    <>
     <div style={{
      display:"grid",
      gridTemplateColumns:
       "repeat(auto-fit,minmax(150px,1fr))",
      gap:12,
      margin:"16px 0"
     }}>

      {[
       ["Pending Records",records.length],
       ["Unauthorized",reserved.length],
       ["Uncertain Payments",uncertain.length],
       ["Confirmed Paid",confirmed.length],
       ["Returned Record Value","PKR "+total.toFixed(2)]
      ].map(([label,value])=>(
       <div key={label} style={{
        border:"1px solid #dbe3ed",
        borderRadius:8,
        padding:14
       }}>
        <div style={{
         color:"#64748b",
         fontSize:12
        }}>
         {label}
        </div>

        <strong style={{
         display:"block",
         fontSize:21,
         color:"#104c72",
         marginTop:8
        }}>
         {value}
        </strong>
       </div>
      ))}

     </div>

     <p style={{fontSize:12,color:"#64748b"}}>
      Last checked: {new Date(checkedAt).toLocaleString()}
     </p>

     {truncated&&(
      <p role="alert" style={{color:"#92400e"}}>
       Results are limited. Additional pending refunds
       may exist. Totals represent returned records only.
      </p>
     )}

     {!records.length&&(
      <p>No pending refunds found.</p>
     )}

    </>
   )}

   {records.map(item=>(
    <article key={item.id} style={{
     border:"1px solid #dbe3ed",
     borderRadius:8,
     padding:16,
     marginTop:14,
     overflowWrap:"anywhere"
    }}>

     <h3 style={{color:"#104c72",marginTop:0}}>
      PKR {Number(item.amount).toFixed(2)}
      {" - "}{item.method}
     </h3>

     <strong>
      {item.status} / {item.paymentState}
     </strong>

     <p>Refund attempt: {item.id}</p>
     <p>Return: {item.returnId}</p>
     <p>Original device: {item.deviceId}</p>
     <p>Original shift: {item.shiftId}</p>
     <p>Registered by: {item.registeredById}</p>

     <p>
      Registered: {new Date(item.createdAt).toLocaleString()}
     </p>

     <button
      type="button"
      style={button}
      disabled={busy}
      onClick={()=>void run(
       ()=>recover(item,"CHECK")
      )}
     >
      Verify Status
     </button>

     {item.canResume&&(
      <button
       type="button"
       style={button}
       disabled={busy}
       onClick={()=>void run(
        ()=>recover(item,"RESUME")
       )}
      >
       Finalize Confirmed Payment
      </button>
     )}

     {item.canCancel&&(
      <button
       type="button"
       style={{
        ...button,
        background:"#92400e"
       }}
       disabled={busy}
       onClick={()=>void run(
        ()=>recover(item,"CANCEL")
       )}
      >
       Resolve Unpaid Reservation
      </button>
     )}


     {/* R10_3D24C_HQ_REFUND_INVESTIGATION_INTEGRATION */}

     <PaymentInvestigation
      key={item.id}
      call={call}
      attemptId={item.id}
      locationId={item.locationId}
      deviceId={item.deviceId}
      shiftId={item.shiftId}
      family="REFUND"
      disabled={busy}
      onChanged={()=>run(load)}
     />

     {item.requiresReconciliation&&(
      <p role="alert" style={{
       color:"#b91c1c",
       background:"#fef2f2",
       padding:12
      }}>
       Payment outcome uncertain.
       Investigate the original operator,
       cash drawer or external payment records.
       Do not issue another payment.
      </p>
     )}

    </article>
   ))}

   {message&&(
    <p role="status" style={{color:"#166534"}}>
     {message}
    </p>
   )}

   {error&&(
    <p role="alert" style={{color:"#b91c1c"}}>
     {error}
    </p>
   )}

  </section>
 );
}