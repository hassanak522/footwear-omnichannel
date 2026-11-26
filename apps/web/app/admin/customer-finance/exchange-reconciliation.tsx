"use client";

import {useEffect,useRef,useState} from "react";
import PaymentInvestigation from "./payment-investigation";

// R10_3D24C_HQ_EXCHANGE_RECONCILIATION

type CallFn=(
 path:string,
 method?:string,
 body?:unknown
)=>Promise<any>;

type Location={
 id:string;
 name:string;
 code?:string;
 type?:string;
};

type Attempt={
 idempotencyKey:string;
 originalSaleId:string;
 locationId:string;
 deviceId:string;
 shiftId:string;
 status:string;
 paymentState:string;
 reversalStatus:string;
 reversalRequestedById?:string;
 reversalApprovedById?:string;
 reversalConfirmedById?:string;
 createdAt:string;
 // R10_3D24C_HQ_EXECUTION_OVERSIGHT
 paymentAuthorizedById?:string;
 paymentAuthorizedAt?:string;
 reversalExecutionById?:string;
 reversalExecutionAt?:string;
 reversalApprovalEvidence?:string;
 reversalEvidenceReference?:string;
 canResume:boolean;
 canRequestReversal?:boolean;
 canAuthorizeReversal?:boolean;
 canConfirmReversal?:boolean;
 canFinalizeReversal?:boolean;
};

const panel:React.CSSProperties={
 background:"#fff",
 border:"1px solid #dbe3ed",
 borderRadius:12,
 padding:22,
 marginBottom:20
};

const button:React.CSSProperties={
 background:"#104c72",
 color:"#fff",
 padding:"9px 14px",
 border:0,
 borderRadius:7,
 cursor:"pointer",
 margin:3
};

const cell:React.CSSProperties={
 padding:10,
 textAlign:"left",
 borderBottom:"1px solid #e2e8f0",
 verticalAlign:"top",
 overflowWrap:"anywhere"
};

export default function ExchangeReconciliation({
 call
}:{call:CallFn}){

 const active=useRef(false);
 const generation=useRef(0);

 const [locations,setLocations]=useState<Location[]>([]);
 const [location,setLocation]=useState("");
 const [records,setRecords]=useState<Attempt[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 const [fetchedAt,setFetchedAt]=useState("");
 const [truncated,setTruncated]=useState(false);
 const [selected,setSelected]=useState<any>(null);

 useEffect(()=>{

  let cancelled=false;

  void call("/inventory/locations").then(result=>{

   const list=Array.isArray(result)
    ?result
    :result.locations;

   if(!Array.isArray(list)){
    throw Error("Invalid location response");
   }

   if(!cancelled){
    setLocations(
     list.filter((item:Location)=>
      !item.type||item.type==="BRANCH"
     )
    );
   }

  }).catch(error=>{
   if(!cancelled)setError(String(error));
  });

  return ()=>{
   cancelled=true;
   generation.current++;
  };

 },[]);

 async function refresh(branch:string){

  const current=++generation.current;

  setFetchedAt("");
  setSelected(null);

  if(!branch){
   setRecords([]);
   setTruncated(false);
   return;
  }

  try{

   const response=await call(
    "/pos/exchanges/pending?locationId="+
    encodeURIComponent(branch)
   );

   if(
    response.locationId!==branch||
    !Array.isArray(response.records)||
    response.records.some(
     (item:Attempt)=>
      item.locationId!==branch||
      !item.idempotencyKey||
      !item.originalSaleId||
      !item.deviceId||
      !item.shiftId
    )
   ){
    throw Error("Central exchange register identity mismatch");
   }

   if(current!==generation.current)return;

   setRecords(response.records);
   setTruncated(response.truncated===true);
   setFetchedAt(response.fetchedAt||new Date().toISOString());
   setError("");

  }catch(error){

   if(current!==generation.current)return;

   setRecords([]);
   setTruncated(false);
   setError(String(error));
  }
 }

 useEffect(()=>{

  setRecords([]);
  setSelected(null);
  setMessage("");
  setError("");

  void refresh(location);

  return ()=>{generation.current++;};

 },[location]);

 async function status(item:Attempt){

  const result=await call(
   "/pos/exchanges/status/"+
   encodeURIComponent(item.idempotencyKey)
  );

  if(
   result.idempotencyKey!==item.idempotencyKey||
   result.locationId!==location||
   result.originalSaleId!==item.originalSaleId||
   result.deviceId!==item.deviceId||
   result.shiftId!==item.shiftId
  ){
   throw Error("Central exchange identity mismatch");
  }

  return result;
 }

 async function perform(
  item:Attempt,
  action:"CHECK"|"RESUME"
 ){

  if(active.current||!location||!fetchedAt)return;

  active.current=true;
  setBusy(true);
  setMessage("");
  setError("");

  try{

   const central=await status(item);

   setSelected(central);

   if(action==="CHECK"){

    if(
     central.status==="ACCEPTED"&&
     central.integrityVerified!==true
    ){
     throw Error("Accepted exchange integrity not verified");
    }

    setMessage(
     "Central status verified: "+central.status+
     " | "+central.paymentState
    );

    return;
   }

   if(
    !["REGISTERED","UNKNOWN"].includes(central.status)||
    central.reversalStatus!=="NONE"||
    !["CONFIRMED","NO_PAYMENT_REQUIRED"].includes(
     central.paymentState
    )
   ){
    throw Error("Exchange is not eligible for safe resumption");
   }

   if(!window.confirm(
    "Resume the original centrally registered exchange? "+
    "Do not collect or reverse any additional payment."
   ))return;

   await call(
    "/pos/exchanges/"+
    encodeURIComponent(item.idempotencyKey)+"/resume",
    "POST"
   );

   const verified=await status(item);

   if(
    verified.status!=="ACCEPTED"||
    verified.integrityVerified!==true
   ){
    throw Error("Central exchange acceptance not verified");
   }

   await refresh(location);

   setSelected(verified);

   setMessage(
    "Exchange accepted and centrally verified: "+
    item.idempotencyKey
   );

  }catch(error){

   setError(
    String(error)+
    ". Do not repeat any physical payment operation."
   );

  }finally{

   active.current=false;
   setBusy(false);
  }
 }

 // R10_3D24C_HQ_REVERSAL_ACTIONS
 async function investigate(
  item:Attempt,
  action:"REQUEST"|"AUTHORIZE"|"FINALIZE"
 ){

  if(active.current||!location||!fetchedAt)return;

  active.current=true;
  setBusy(true);
  setError("");
  setMessage("");

  try{

   const central=await status(item);

   if(!["REGISTERED","UNKNOWN"].includes(central.status)){
    throw Error("Exchange is already finalized");
   }

   const base="/pos/exchanges/"+
    encodeURIComponent(item.idempotencyKey);

   let expected="";

   if(action==="REQUEST"){

    if(
     !item.canRequestReversal||central.canRequestReversal!==true||
     central.reversalStatus!=="NONE"||
     central.paymentState!=="CONFIRMED"
    ){
     throw Error("Reversal investigation is not eligible");
    }

    const reason=window.prompt(
     "Enter the reason for investigating this exchange. "+
     "This does not authorize a physical reversal."
    )?.trim();

    if(reason===undefined)return;

    if(reason.length<10||reason.length>500){
     throw Error("Reason must contain 10-500 characters");
    }

    await call(base+"/reversal/request","POST",{reason});

    expected="REQUESTED";

   }else if(action==="AUTHORIZE"){

    if(
     !item.canAuthorizeReversal||
     central.reversalStatus!=="REQUESTED"||
     central.paymentState!=="CONFIRMED"
    ){
     throw Error(
      "Confirmed payment and independent approval required. "+
      "Uncertain collections must be investigated separately."
     );
    }

    const evidenceReference=window.prompt(
     "Enter independently verified payment evidence reference."
    )?.trim();

    if(evidenceReference===undefined)return;

    if(
     evidenceReference.length<5||
     evidenceReference.length>200
    ){
     throw Error("Evidence must contain 5-200 characters");
    }

    if(!window.confirm(
     "Record independent approval of the reversal investigation? "+
     "This action does not execute or authorize a physical payout."
    ))return;

    await call(
     base+"/reversal/authorize",
     "POST",
     {evidenceReference}
    );

    expected="AUTHORIZED";

   }else{

    if(
     !item.canFinalizeReversal||
     central.reversalStatus!=="CONFIRMED"||
      !central.reversalExecutionAt||
      !central.reversalExecutionById||
      !central.reversalApprovalEvidence||
      /* R10_3D24C_HQ_INDEPENDENT_REVERSAL_FINALIZATION */
      !central.reversalConfirmedById||
      !central.reversalEvidenceReference
    ){
     throw Error("Confirmed reversal evidence required");
    }

    const reason=window.prompt(
     "Enter the final independent reconciliation decision."
    )?.trim();

    if(reason===undefined)return;

    if(reason.length<10||reason.length>500){
     throw Error("Reason must contain 10-500 characters");
    }

    if(!window.confirm(
     "Finalize the documented reversal without creating an exchange? "+
     "No physical payment should be repeated."
    ))return;

    await call(base+"/resolve","POST",{
     reason,
     paymentState:"REVERSED",
     evidenceReference:central.reversalEvidenceReference
    });

    expected="RESOLVED_NO_EXCHANGE";
   }

   const verified=await status(item);

   if(action==="FINALIZE"){

    if(
     verified.status!==expected||
     verified.paymentState!=="REVERSED"
    ){
     throw Error("Final resolution not verified");
    }

   }else if(verified.reversalStatus!==expected){

    throw Error("Reversal transition not verified");
   }

   await refresh(location);

   setSelected(verified);
   setMessage("Central reconciliation updated: "+expected);

  }catch(error){

   setError(
    String(error)+
    ". Refresh central status before retrying. "+
    "Do not repeat any physical payment operation."
   );

  }finally{

   active.current=false;
   setBusy(false);
  }
 }

 const investigations=records.filter(
  item=>item.reversalStatus!=="NONE"
 ).length;

 const recoverable=records.filter(
  item=>item.canResume&&item.reversalStatus==="NONE"
 ).length;

 const awaitingExecution=records.filter(
  item=>item.reversalStatus==="AUTHORIZED"&&
  !item.reversalExecutionAt
 ).length;

 const executionClaimed=records.filter(
  item=>item.reversalStatus==="AUTHORIZED"&&
  !!item.reversalExecutionAt
 ).length;

 const awaitingFinalization=records.filter(
  item=>item.reversalStatus==="CONFIRMED"
 ).length;

 const uncertain=records.filter(
  item=>item.paymentState==="UNCONFIRMED"
 ).length;

 return (
  <section style={panel}>

   <h2 style={{color:"#104c72"}}>
    Central Exchange Reconciliation
   </h2>

   <p style={{color:"#64748b"}}>
    Monitor unresolved merchandise exchanges independently
    of individual POS terminal journals.
   </p>

   <label>
    Branch
    <select
     value={location}
     disabled={busy}
     onChange={event=>setLocation(event.target.value)}
     style={{
      display:"block",
      padding:10,
      width:"100%",
      marginTop:6,
      marginBottom:12
     }}
    >
     <option value="">Select branch</option>
     {locations.map(item=>(
      <option key={item.id} value={item.id}>
       {item.name} {item.code?"("+item.code+")":""}
      </option>
     ))}
    </select>
   </label>

   <button
    style={button}
    disabled={busy||!location}
    onClick={()=>void refresh(location)}
   >
    Refresh exchange register
   </button>

   {fetchedAt&&(
    <p>Last refreshed: {fetchedAt}</p>
   )}

   {location&&fetchedAt&&(
    <div style={{
     display:"grid",
     gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",
     gap:12,
     margin:"16px 0"
    }}>
     {[
      ["Unresolved exchanges",records.length],
      ["Payment unconfirmed",uncertain],
      ["Reversal investigations",investigations],
             ["Eligible for recovery",recoverable],
       ["Awaiting execution claim",awaitingExecution],
       ["Execution claimed",executionClaimed],
       ["Awaiting finalization",awaitingFinalization]
     ].map(([label,value])=>(
      <div key={label} style={{
       border:"1px solid #dbe3ed",
       borderRadius:8,
       padding:14
      }}>
       <small>{label}</small>
       <h2 style={{color:"#104c72",margin:"8px 0"}}>
        {value}
       </h2>
      </div>
     ))}
    </div>
   )}

   {truncated&&(
    <p role="alert">
     Results are limited to 200 unresolved exchanges.
     Counts represent displayed records only.
    </p>
   )}

   {error&&(
    <p role="alert" style={{color:"#b91c1c"}}>
     {error}
    </p>
   )}

   {message&&(
    <p role="status" style={{color:"#166534"}}>
     {message}
    </p>
   )}

   <div style={{overflowX:"auto"}}>
    <table style={{
     width:"100%",
     borderCollapse:"collapse",
     minWidth:850
    }}>
     <thead>
      <tr>
       {[
        "Transaction",
        "Terminal",
        "Payment",
        "Reversal",
        "Accountability",
        "Actions"
       ].map(label=>(
        <th key={label} style={cell}>{label}</th>
       ))}
      </tr>
     </thead>

     <tbody>
      {records.map(item=>(
       <tr key={item.idempotencyKey}>

        <td style={cell}>
         {item.idempotencyKey}
         <p>Original sale: {item.originalSaleId}</p>
         <small>{item.createdAt}</small>
        </td>

        <td style={cell}>
         Device: {item.deviceId}
         <p>Shift: {item.shiftId}</p>
        </td>

        <td style={cell}>
         <strong>{item.status}</strong>
         <p>{item.paymentState}</p>
        </td>

        <td style={cell}>
         <strong>{item.reversalStatus}</strong>
         {item.reversalStatus!=="NONE"&&(
          <p style={{color:"#b45309"}}>
           Recovery restricted
          </p>
         )}
        </td>

        <td style={cell}>
         <p>Requester: {item.reversalRequestedById||"-"}</p>
         <p>Approver: {item.reversalApprovedById||"-"}</p>
          <p>Collection operator: {item.paymentAuthorizedById||"-"}</p>
          <p>Executor: {item.reversalExecutionById||"-"}</p>
          <p>Execution claim: {item.reversalExecutionAt||"-"}</p>
          <p>Confirmer: {item.reversalConfirmedById||"-"}</p>
        </td>

        <td style={cell}>

         <button
          style={button}
          disabled={busy||!fetchedAt}
          onClick={()=>void perform(item,"CHECK")}
         >
          Verify status
         </button>

         {item.canResume&&item.reversalStatus==="NONE"&&(
          <button
           style={button}
           disabled={busy||!fetchedAt}
           onClick={()=>void perform(item,"RESUME")}
          >
           Resume exchange
          </button>
         )}

         {item.canRequestReversal&&(
          <button
           style={button}
           disabled={busy||!fetchedAt}
           onClick={()=>void investigate(item,"REQUEST")}
          >
           Request investigation
          </button>
         )}

         {item.canAuthorizeReversal&&
          item.paymentState==="CONFIRMED"&&(
          <button
           style={button}
           disabled={busy||!fetchedAt}
           onClick={()=>void investigate(item,"AUTHORIZE")}
          >
           Approve investigation
          </button>
         )}

         {item.canFinalizeReversal&&(
          <button
           style={button}
           disabled={busy||!fetchedAt}
           onClick={()=>void investigate(item,"FINALIZE")}
          >
           Finalize documented reversal
          </button>
         )}

                   {item.reversalStatus==="AUTHORIZED"&&(
           <p style={{color:"#b45309"}}>
            {item.reversalExecutionAt
             ?"Execution claimed. Awaiting completed reversal evidence."
             :"Approved. Awaiting original collection operator."}
            {" "}Do not repeat physical payment operations.
           </p>
          )}

          {item.reversalStatus!=="NONE"&&(
           <p>Controlled reversal workflow required.</p>
          )}


         {/* R10_3D24C_HQ_EXCHANGE_INVESTIGATION_INTEGRATION */}

         <PaymentInvestigation
          key={item.idempotencyKey}
          call={call}
          attemptId={item.idempotencyKey}
          locationId={item.locationId}
          deviceId={item.deviceId}
          shiftId={item.shiftId}
          family="EXCHANGE"
          disabled={busy}
          onChanged={()=>refresh(location)}
         />

         {item.paymentState==="UNCONFIRMED"&&(
          <p style={{color:"#b45309"}}>
           Verify whether payment was actually collected.
           Do not initiate a physical reversal.
          </p>
         )}

        </td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>

   {location&&fetchedAt&&!records.length&&!error&&(
    <p>No unresolved central exchanges for this branch.</p>
   )}

   {selected&&(
    <div style={{
     border:"1px solid #dbe3ed",
     padding:14,
     borderRadius:8,
     marginTop:18
    }}>
     <h3>Verified transaction details</h3>

     {[
      ["Transaction",selected.idempotencyKey],
      ["Status",selected.status],
      ["Payment state",selected.paymentState],
      ["Reversal state",selected.reversalStatus],
      ["Original sale",selected.originalSaleId],
      ["Return value",selected.returnValue],
      ["Replacement value",selected.replacementValue],
      ["Additional payment",selected.additionalPayment],
      ["Residual refund",selected.residualRefund],
      ["Reversal reason",selected.reversalRequestReason],
             ["Collection operator",selected.paymentAuthorizedById],
       ["Collection authorization",selected.paymentAuthorizedAt],
       ["Approval evidence",selected.reversalApprovalEvidence],
       ["Execution operator",selected.reversalExecutionById],
       ["Execution claim",selected.reversalExecutionAt],
       ["Evidence",selected.reversalEvidenceReference]
     ].map(([label,value])=>(
      <p key={label}>
       <strong>{label}: </strong>
       {value===undefined||value===null?"-":String(value)}
      </p>
     ))}
    </div>
   )}

  </section>
 );
}