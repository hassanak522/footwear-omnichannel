"use client";

import {useRef,useState} from "react";

// R10_3D24C_HQ_INDEPENDENT_PAYMENT_INVESTIGATION

type Kind=
 "REFUND_PAYOUT"|
 "EXCHANGE_COLLECTION"|
 "EXCHANGE_REVERSAL";

type CallFn=(
 path:string,
 method?:string,
 body?:unknown
)=>Promise<any>;

type Props={
 call:CallFn;
 attemptId:string;
 locationId:string;
 deviceId:string;
 shiftId:string;
 family:"REFUND"|"EXCHANGE";
 disabled?:boolean;
 onChanged:()=>Promise<void>;
};

type Investigation={
 canReview?:boolean;
 payloadHash?:string;
 id:string;
 kind:Kind;
 refundAttemptId?:string;
 exchangeAttemptId?:string;
 locationId:string;
 deviceId:string;
 shiftId:string;
 paymentOperatorId:string;
 amount:string;
 originalStatus:string;
 originalPaymentState:string;
 originalReversalStatus?:string;
 proposedOutcome:string;
 evidenceReference:string;
 reason:string;
 executionAbandoned:boolean;
 status:string;
 submittedById:string;
 submittedAt:string;
 reviewedById?:string;
 reviewedAt?:string;
 reviewNote?:string;
};

const button:React.CSSProperties={
 padding:"9px 13px",
 background:"#104c72",
 color:"#fff",
 border:0,
 borderRadius:7,
 cursor:"pointer",
 marginRight:8,
 marginBottom:8
};

const field:React.CSSProperties={
 width:"100%",
 boxSizing:"border-box",
 padding:10,
 border:"1px solid #cbd5e1",
 borderRadius:7
};

export default function PaymentInvestigation({
 call,
 attemptId,
 locationId,
 deviceId,
 shiftId,
 family,
 disabled,
 onChanged
}:Props){

 const active=useRef(false);

 const [expanded,setExpanded]=useState(false);
 // R10_3D24C_HQ_AUTHORITATIVE_INVESTIGATION_STATE
 const [loaded,setLoaded]=useState(false);

 // R10_3D24C_HQ_FRESH_INVESTIGATION_PERMISSIONS

 const [submissionAllowed,setSubmissionAllowed]=
  useState(false);
 const [financialHold,setFinancialHold]=useState(false);
 const [truncated,setTruncated]=useState(false);
 const [attemptStatus,setAttemptStatus]=useState("");
 const [paymentState,setPaymentState]=useState("");
 const [reversalStatus,setReversalStatus]=useState("");
 const [authorizedById,setAuthorizedById]=useState("");
 const [busy,setBusy]=useState(false);
 const [records,setRecords]=useState<Investigation[]>([]);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");

 const [kind,setKind]=useState<Kind>(
  family==="REFUND"
   ?"REFUND_PAYOUT"
   :"EXCHANGE_COLLECTION"
 );

 const [evidence,setEvidence]=useState("");
 const [reason,setReason]=useState("");

 const [reviewNotes,setReviewNotes]=
  useState<Record<string,string>>({});

 const base=family==="REFUND"
  ?"/pos/returns/settlements"
  :"/pos/exchanges";

 const endpoint=
  `${base}/${encodeURIComponent(attemptId)}/reconciliation`;

 const pending=records.some(
  item=>item.status==="PENDING"
 );

 const abandoned=records.some(
  item=>item.executionAbandoned
 );

 // R10_3D24C_HQ_EXCEPTIONAL_HOLD_RESOLUTION

 const held=financialHold;

 const [exceptionalAllowed,setExceptionalAllowed]=
  useState(false);

 const exceptional=
  held&&
  exceptionalAllowed&&
  family!=="REFUND"&&
  kind==="EXCHANGE_REVERSAL";

 const eligible=
  family==="REFUND"
   ?attemptStatus==="PAYMENT_AUTHORIZED"&&
    paymentState==="UNKNOWN"&&
    !!authorizedById
   :["REGISTERED","UNKNOWN"].includes(attemptStatus)&&
    (
     kind==="EXCHANGE_COLLECTION"
      ?paymentState==="UNCONFIRMED"&&reversalStatus==="NONE"
      :paymentState==="CONFIRMED"&&reversalStatus==="AUTHORIZED"
    );

 async function run(action:()=>Promise<unknown>){

  if(active.current||disabled)return;

  active.current=true;
  setBusy(true);
  setError("");
  setMessage("");

  try{
   await action();
  }catch(e){
   setError(e instanceof Error?e.message:String(e));
  }finally{
   active.current=false;
   setBusy(false);
  }
 }

 async function load(){

  setLoaded(false);
  setSubmissionAllowed(false);
  setExceptionalAllowed(false);

  const result=await call(endpoint);

  if(
   !result||
   result.idempotencyKey!==attemptId||
   result.locationId!==locationId||
   result.paymentExecutionAuthorized!==false||
   (result.deviceId!==deviceId||
    result.shiftId!==shiftId)
  ){
   throw Error("Authoritative investigation identity mismatch");
  }

  const items=Array.isArray(result)
   ?result
   :result.records??result.cases??result.investigations;

  if(!Array.isArray(items)){
   throw Error("Invalid investigation history response");
  }

  for(const item of items){

   const identity=family==="REFUND"
    ?item.refundAttemptId
    :item.exchangeAttemptId;

   if(
    identity!==attemptId||
    item.locationId!==locationId||
    item.deviceId!==deviceId||
    item.shiftId!==shiftId||
    !item.id||
    !item.paymentOperatorId||
    !Number.isFinite(Number(item.amount))||
    Number(item.amount)<=0||
    !["PENDING","APPROVED","REJECTED"].includes(item.status)||
    (family==="REFUND"&&item.kind!=="REFUND_PAYOUT")||
    (family==="EXCHANGE"&&
     !["EXCHANGE_COLLECTION","EXCHANGE_REVERSAL"].includes(item.kind))
   ){
    throw Error("Investigation identity or amount mismatch");
   }
  }

  setSubmissionAllowed(
   result.canSubmitInvestigation===true
  );

  if(family==="EXCHANGE"){

   if(
    result.paymentState==="CONFIRMED"&&
    result.reversalStatus==="AUTHORIZED"
   ){
    setKind("EXCHANGE_REVERSAL");
   }else{
    setKind("EXCHANGE_COLLECTION");
   }

  }else{
   setKind("REFUND_PAYOUT");
  }

  setFinancialHold(result.financialHold===true);
  setExceptionalAllowed(
   result.canSubmitExceptionalResolution===true
  );
  setTruncated(result.truncated===true);
  setAttemptStatus(result.status||"");
  setPaymentState(result.paymentState||"");
  setReversalStatus(result.reversalStatus||"");
  setAuthorizedById(result.authorizedById||"");

  setRecords(items);
  setLoaded(true);

  return items as Investigation[];
 }

 async function submit(){

  if(
   !loaded||
   pending||
   (held&&!exceptional)||
   truncated||
   !eligible||
   (!submissionAllowed&&!exceptional)
  ){
   throw Error("Refresh investigation history before proceeding");
  }

  const reference=evidence.trim();
  const explanation=reason.trim();

  if(reference.length<5||reference.length>200){
   throw Error("Evidence reference must contain 5-200 characters");
  }

  if(explanation.length<10||explanation.length>500){
   throw Error("Investigation reason must contain 10-500 characters");
  }

  const proposedOutcome=
   kind==="REFUND_PAYOUT"
    ?"PAID"
    :kind==="EXCHANGE_COLLECTION"
     ?"COLLECTED"
     :"REVERSED";

  if(!window.confirm(
   "Submit evidence of an operation that already occurred? "+
   "This does not authorize any new physical payment. "+
   "Another eligible HQ reviewer must review the evidence."
  ))return;

  const fresh=await call(endpoint);

  if(
   !fresh||
   fresh.idempotencyKey!==attemptId||
   fresh.locationId!==locationId||
   fresh.deviceId!==deviceId||
   fresh.shiftId!==shiftId||
   fresh.paymentExecutionAuthorized!==false||
   fresh.truncated!==false||
   !Array.isArray(fresh.records)
  ){
   setLoaded(false);
   throw Error(
    "Unable to verify authoritative investigation permissions"
   );
  }

  if(
   fresh.records.some(
    (record:Investigation)=>record.status==="PENDING"
   )
  ){
   setLoaded(false);
   throw Error("An investigation is already pending");
  }

  const freshKind:Kind=
   family==="REFUND"
    ?"REFUND_PAYOUT"
    :fresh.paymentState==="CONFIRMED"&&
     fresh.reversalStatus==="AUTHORIZED"
     ?"EXCHANGE_REVERSAL"
     :"EXCHANGE_COLLECTION";

  const freshEligible=
   family==="REFUND"
    ?fresh.status==="PAYMENT_AUTHORIZED"&&
     fresh.paymentState==="UNKNOWN"
    :["REGISTERED","UNKNOWN"].includes(fresh.status)&&
     (
      kind==="EXCHANGE_COLLECTION"
       ?fresh.paymentState==="UNCONFIRMED"&&
        fresh.reversalStatus==="NONE"
       :fresh.paymentState==="CONFIRMED"&&
        fresh.reversalStatus==="AUTHORIZED"
     );

  const freshExceptional=
   family==="EXCHANGE"&&
   kind==="EXCHANGE_REVERSAL"&&
   fresh.financialHold===true&&
   fresh.canSubmitExceptionalResolution===true;

  if(
   freshKind!==kind||
   !freshEligible||
   fresh.status!==attemptStatus||
   fresh.paymentState!==paymentState||
   (
    family==="EXCHANGE"&&
    fresh.reversalStatus!==reversalStatus
   )||
   (
    fresh.financialHold===true
     ?!freshExceptional
     :fresh.canSubmitInvestigation!==true
   )||
   exceptional!==freshExceptional
  ){
   setLoaded(false);
   throw Error(
    "Investigation permissions changed. Refresh before submitting."
   );
  }

  const submitted=await call(endpoint,"POST",{
   kind,
   proposedOutcome,
   evidenceReference:reference,
   reason:explanation,
   executionAbandoned:false
  });

  // R10_3D24C_HQ_VERIFIED_INVESTIGATION_ACK
  if(
   !submitted||
   !submitted.id||
   submitted.status!=="PENDING"||
   submitted.kind!==kind||
   submitted.proposedOutcome!==proposedOutcome||
   submitted.locationId!==locationId||
   submitted.deviceId!==deviceId||
   submitted.shiftId!==shiftId||
   submitted.evidenceReference!==reference||
   submitted.reason!==explanation||
   submitted.executionAbandoned!==false||
   submitted.paymentExecutionAuthorized!==false||
   (family==="REFUND"
    ?submitted.refundAttemptId!==attemptId
    :submitted.exchangeAttemptId!==attemptId)
  ){
   setLoaded(false);
   throw Error(
    "Submission acknowledgement uncertain. "+
    "Refresh investigation history before any further action."
   );
  }

  setEvidence("");
  setReason("");

  const persisted=await load();

  if(!persisted.some(item=>
   item.id===submitted.id&&
   item.kind===kind&&
   item.proposedOutcome===proposedOutcome&&
   item.evidenceReference===reference&&
   item.reason===explanation&&
   item.executionAbandoned===false
  )){
   setLoaded(false);
   throw Error(
    "Submission persistence could not be verified. "+
    "Refresh investigation history before continuing."
   );
  }

  setMessage(
   "Investigation submitted. Independent review required."
  );

  await onChanged();
 }

 async function review(
  item:Investigation,
  decision:"APPROVED"|"REJECTED"
 ){

  if(!loaded||item.status!=="PENDING"||item.canReview!==true){
   throw Error("Investigation is not pending");
  }

  const reviewNote=(reviewNotes[item.id]||"").trim();

  if(reviewNote.length<10||reviewNote.length>1000){
   throw Error("Review note must contain 10-1000 characters");
  }

  const latest=await call(endpoint);

  if(
   !latest||
   latest.idempotencyKey!==attemptId||
   latest.locationId!==locationId||
   latest.paymentExecutionAuthorized!==false||
   (latest.deviceId!==deviceId||
    latest.shiftId!==shiftId)
  ){
   throw Error("Investigation review identity mismatch");
  }

  const items=Array.isArray(latest)
   ?latest
   :latest.records??latest.cases??latest.investigations;

  if(!Array.isArray(items)){
   throw Error("Unable to verify current investigation");
  }

  const current=items.find(
   (record:Investigation)=>record.id===item.id
  );

  if(
   !current||
   current.status!=="PENDING"||
   current.canReview!==true||
   current.executionAbandoned!==item.executionAbandoned||
   current.payloadHash!==item.payloadHash||
   current.originalStatus!==item.originalStatus||
   current.originalPaymentState!==item.originalPaymentState||
   current.originalReversalStatus!==item.originalReversalStatus||
   current.locationId!==locationId||
   current.deviceId!==deviceId||
   current.shiftId!==shiftId||
   current.kind!==item.kind||
   current.proposedOutcome!==item.proposedOutcome||
   current.paymentOperatorId!==item.paymentOperatorId||
   current.submittedById!==item.submittedById||
   current.evidenceReference!==item.evidenceReference||
   current.reason!==item.reason||
   Number(current.amount)!==Number(item.amount)||
   (family==="REFUND"
    ?current.refundAttemptId!==attemptId
    :current.exchangeAttemptId!==attemptId)
  ){
   throw Error("Investigation changed. Refresh before reviewing.");
  }

  if(!window.confirm(
   `${decision} investigation ${item.id}?\n`+
   `Outcome: ${item.proposedOutcome}\n`+
   `Amount: PKR ${Number(item.amount).toFixed(2)}\n`+
   "Review must be based on independently verified evidence. "+
   "Do not execute another physical payment."
  ))return;

  const reviewed=await call(
   `${endpoint}/${encodeURIComponent(item.id)}/review`,
   "POST",
   {decision,reviewNote}
  );

  if(
   !reviewed||
   reviewed.idempotencyKey!==attemptId||
   reviewed.investigationId!==item.id||
   reviewed.decision!==decision||
   reviewed.proposedOutcome!==item.proposedOutcome||
   reviewed.locationId!==locationId||
   !reviewed.reviewedById||
   !reviewed.reviewedAt||
   reviewed.paymentExecutionAuthorized!==false
  ){
   setLoaded(false);
   throw Error(
    "Review acknowledgement uncertain. "+
    "Refresh authoritative investigation history."
   );
  }

  await load();

  setMessage(
   "Independent review recorded. Recovery register refreshed."
  );

  await onChanged();
 }

 return(
  <div style={{
   border:"1px solid #cbd5e1",
   padding:14,
   borderRadius:8,
   marginTop:12,
   background:"#f8fafc",
   overflowWrap:"anywhere"
  }}>

   <button
    type="button"
    style={button}
    disabled={busy||disabled}
    onClick={()=>{

     if(expanded){
      setExpanded(false);
      return;
     }

     setExpanded(true);
     void run(load);

    }}
   >
    {expanded
     ?"Hide independent investigation"
     :"Independent payment investigation"}
   </button>

   {expanded&&(
    <>

     <h4>Evidence and independent review</h4>

     <p style={{color:"#92400e"}}>
      This workflow records verified historical outcomes.
      It never authorizes another physical payment.
     </p>

     <button
      type="button"
      style={button}
      disabled={busy||disabled}
      onClick={()=>void run(load)}
     >
      Refresh investigation history
     </button>

     {truncated&&(
      <p role="alert" style={{color:"#92400e"}}>
       Investigation history exceeds the displayed limit.
       New submissions are disabled until HQ reviews the
       complete financial record.
      </p>
     )}

     {pending&&(
      <p role="alert" style={{color:"#b91c1c"}}>
       Independent investigation pending.
       Ordinary payment confirmation is blocked.
      </p>
     )}

     {abandoned&&(
      <p role="alert" style={{color:"#b91c1c"}}>
       Original execution authorization was abandoned.
       Rejection of an investigation does not restore it.
      </p>
     )}

     {held&&(
      <p role="alert" style={{
       color:"#991b1b",
       background:"#fee2e2",
       padding:12
      }}>
       Approved NOT_REVERSED outcome.
       Financial hold remains active. Authorized HQ users may submit independent evidence of an already completed reversal.
       Do not resume the exchange or repeat the reversal.
      </p>
     )}

     {loaded&&!records.length&&(
      <p>No independent investigations recorded.</p>
     )}

     {records.map(item=>(
      <article key={item.id} style={{
       background:"#fff",
       border:"1px solid #dbe3ed",
       borderRadius:8,
       padding:14,
       marginTop:12
      }}>

       <strong>
        {item.kind} - {item.proposedOutcome}
       </strong>

       <p>
        <strong>Status: </strong>
        {item.status}
       </p>

       {[
        ["Investigation",item.id],
        ["Amount","PKR "+Number(item.amount).toFixed(2)],
        ["Original status",item.originalStatus],
        ["Original payment",item.originalPaymentState],
        ["Original reversal",item.originalReversalStatus],
        ["Payment operator",item.paymentOperatorId],
        ["Submitted by",item.submittedById],
        ["Submitted at",item.submittedAt],
        ["Evidence",item.evidenceReference],
        ["Reason",item.reason],
        ["Execution abandoned",item.executionAbandoned?"Yes":"No"],
        ["Reviewed by",item.reviewedById],
        ["Reviewed at",item.reviewedAt],
        ["Review note",item.reviewNote]
       ].map(([label,value])=>(
        <p key={label} style={{fontSize:13}}>
         <strong>{label}: </strong>
         {value||"-"}
        </p>
       ))}

       {loaded&&item.status==="PENDING"&&item.canReview===true&&(
        <>

         <label style={{display:"grid",gap:6}}>
          Independent review note

          <textarea
           style={field}
           rows={3}
           maxLength={1000}
           disabled={busy||disabled}
           value={reviewNotes[item.id]||""}
           onChange={e=>setReviewNotes(previous=>({
            ...previous,
            [item.id]:e.target.value
           }))}
          />
         </label>

         <p style={{fontSize:12,color:"#64748b"}}>
          The original operator and investigation submitter
          cannot review this case. The server enforces
          reviewer eligibility.
         </p>

         <button
          type="button"
          style={{...button,background:"#166534"}}
          disabled={busy||disabled}
          onClick={()=>void run(
           ()=>review(item,"APPROVED")
          )}
         >
          Approve verified outcome
         </button>

         <button
          type="button"
          style={{...button,background:"#991b1b"}}
          disabled={busy||disabled}
          onClick={()=>void run(
           ()=>review(item,"REJECTED")
          )}
         >
          Reject investigation
         </button>

        </>
       )}

      </article>
     ))}

     {loaded&&!pending&&(!held||exceptional)&&!truncated&&(submissionAllowed||exceptional)&&(
      <div style={{
       display:"grid",
       gap:10,
       marginTop:16
      }}>

       <strong>Submit historical payment evidence</strong>

       {family==="EXCHANGE"&&(
        <label>
         Investigation type

         <select
          style={field}
          value={kind}
          disabled={busy||disabled||held}
          onChange={e=>setKind(e.target.value as Kind)}
         >
          <option value="EXCHANGE_COLLECTION">
           Completed collection
          </option>

          <option value="EXCHANGE_REVERSAL">
           Completed reversal
          </option>
         </select>
        </label>
       )}

       <label>
        Evidence reference

        <input
         style={field}
         value={evidence}
         maxLength={200}
         disabled={busy||disabled}
         onChange={e=>setEvidence(e.target.value)}
        />
       </label>

       <label>
        Investigation reason

        <textarea
         style={field}
         rows={3}
         value={reason}
         maxLength={500}
         disabled={busy||disabled}
         onChange={e=>setReason(e.target.value)}
        />
       </label>

       <button
        type="button"
        style={button}
        disabled={busy||disabled||!eligible||(!submissionAllowed&&!exceptional)}
        onClick={()=>void run(submit)}
       >
        Submit for independent review
       </button>

       {!eligible&&(
        <p role="status" style={{color:"#92400e"}}>
         The current financial attempt is not eligible
         for the selected investigation type.
        </p>
       )}

       <small>
        Negative outcome declarations require the original
        payment operator's abandonment attestation.
        They must not be submitted on another operator's behalf.
       </small>

      </div>
     )}

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

    </>
   )}

  </div>
 );
}