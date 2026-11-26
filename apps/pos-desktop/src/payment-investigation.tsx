import {useEffect,useRef,useState} from 'react';

// R10_3D24C_DESKTOP_INDEPENDENT_INVESTIGATION

type Kind=
 'REFUND_PAYOUT'|
 'EXCHANGE_COLLECTION'|
 'EXCHANGE_REVERSAL';

type Props={
 request:(path:string,method?:string,body?:unknown)=>Promise<any>;
 token:string;
 attemptId:string;
 locationId:string;
 deviceId:string;
 shiftId:string;
 kind:Kind;
 disabled?:boolean;
 onChanged?:()=>void|Promise<void>;
};

const outcomes:Record<Kind,[string,string]>={
 REFUND_PAYOUT:['PAID','NOT_PAID'],
 EXCHANGE_COLLECTION:['COLLECTED','NOT_COLLECTED'],
 EXCHANGE_REVERSAL:['REVERSED','NOT_REVERSED']
};

const titles:Record<Kind,string>={
 REFUND_PAYOUT:'Refund payout investigation',
 EXCHANGE_COLLECTION:'Exchange collection investigation',
 EXCHANGE_REVERSAL:'Exchange reversal investigation'
};

export default function PaymentInvestigation({
 request,
 token,
 attemptId,
 locationId,
 deviceId,
 shiftId,
 kind,
 disabled=false,
 onChanged
}:Props){

 const [snapshot,setSnapshot]=useState<any>(null);
 const [outcome,setOutcome]=useState(outcomes[kind][0]);
 const [evidence,setEvidence]=useState('');
 const [reason,setReason]=useState('');
 const [abandoned,setAbandoned]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');

 const active=useRef(false);
 const generation=useRef(0);

 const refund=kind==='REFUND_PAYOUT';

 const endpoint=refund
  ?'/pos/returns/settlements/'+
   encodeURIComponent(attemptId)+'/reconciliation'
  :'/pos/exchanges/'+
   encodeURIComponent(attemptId)+'/reconciliation';

 const negative=outcome===outcomes[kind][1];

 useEffect(()=>{

  generation.current++;
  setSnapshot(null);
  setOutcome(outcomes[kind][0]);
  setEvidence('');
  setReason('');
  setAbandoned(false);
  setMessage('');

  return ()=>{
   generation.current++;
  };

 },[token,attemptId,locationId,deviceId,shiftId,kind]);

 function verify(result:any){

  if(
   !result||
   result.idempotencyKey!==attemptId||
   result.locationId!==locationId||
   result.deviceId!==deviceId||
   result.shiftId!==shiftId||
   result.paymentExecutionAuthorized!==false||
   !Array.isArray(result.records)
  ){
   throw Error('Investigation identity could not be verified');
  }

  for(const item of result.records){

   if(
    !item.id||
    item.locationId!==locationId||
    item.deviceId!==deviceId||
    item.shiftId!==shiftId||
    (refund
     ?item.refundAttemptId!==attemptId
     :item.exchangeAttemptId!==attemptId)
   ){
    throw Error('Investigation record identity mismatch');
   }
  }

  return result;
 }

  // R10_3D24C_INVESTIGATION_OUTCOME_PERMISSIONS

 function canDeclareNegative(result:any){
  if(!result)return false;

  if(refund){
   return result.canDeclareNotPaid===true;
  }

  return result.canDeclareNegative===true;
 }

 function eligible(result:any){

   // R10_3D24C_UNIFIED_INVESTIGATION_ELIGIBILITY

  if(result?.canSubmitInvestigation!==true){
   return false;
  }

  if(
   !result||
   result.truncated===true||
   result.financialHold===true||
   result.records.some((item:any)=>item.status==='PENDING')
  ){
   return false;
  }

  if(refund){
   return (
    result.status==='PAYMENT_AUTHORIZED'&&
    result.paymentState==='UNKNOWN'
   );
  }

  if(!['REGISTERED','UNKNOWN'].includes(result.status)){
   return false;
  }

  return kind==='EXCHANGE_COLLECTION'
   ?result.paymentState==='UNCONFIRMED'&&
    result.reversalStatus==='NONE'
   :result.paymentState==='CONFIRMED'&&
    result.reversalStatus==='AUTHORIZED';
 }

 async function read(){

  return verify(await request(endpoint));
 }

 async function run(operation:(current:number)=>Promise<void>){

  if(active.current||disabled||!token)return;

  active.current=true;
  setBusy(true);
  setMessage('');

  const current=generation.current;

  try{

   await operation(current);

  }catch(error){

   if(current===generation.current){
    setSnapshot(null);
    setMessage(
     String(error)+
     '. Refresh authoritative history before continuing. '+
     'Do not repeat physical payment.'
    );
   }

  }finally{

   active.current=false;
   setBusy(false);
  }
 }

 async function refresh(current:number){

  const result=await read();

  if(current!==generation.current)return;

  setSnapshot(result);
 }

 async function submit(current:number){

  const reference=evidence.trim();
  const explanation=reason.trim();

  if(reference.length<5||reference.length>200){
   throw Error('Evidence reference must contain 5-200 characters');
  }

  if(explanation.length<10||explanation.length>500){
   throw Error('Reason must contain 10-500 characters');
  }

  if(!outcomes[kind].includes(outcome)){
   throw Error('Invalid investigation outcome');
  }

  if(negative&&(!abandoned||!canDeclareNegative(snapshot))){
   throw Error('Explicit execution abandonment is required');
  }

  const latest=await read();

  if(current!==generation.current)return;

  setSnapshot(latest);

  if(negative&&!canDeclareNegative(latest)){
   throw Error(
    'Only the original payment operator may declare non-execution'
   );
  }

  if(!eligible(latest)){
   throw Error('Current attempt is not eligible for submission');
  }

  const warning=negative
   ?'You are declaring that the original payment operation '+
    'was not completed and permanently surrendering its '+
    'ordinary execution authority. Do not execute it later, '+
    'even if HQ rejects this investigation.'
   :'You are submitting evidence of an already completed '+
    'payment operation. Do not perform another payment.';

  if(!window.confirm(
   warning+'\n\nIndependent HQ review is required.'
  ))return;

  if(current!==generation.current)return;

  const body={
   ...(refund?{}:{kind}),
   proposedOutcome:outcome,
   evidenceReference:reference,
   reason:explanation,
   executionAbandoned:negative
  };

  const submitted=await request(endpoint,'POST',body);

  if(current!==generation.current)return;

  if(
   !submitted||
   !submitted.id||
   submitted.kind!==kind||
   submitted.status!=='PENDING'||
   submitted.proposedOutcome!==outcome||
   submitted.locationId!==locationId||
   submitted.deviceId!==deviceId||
   submitted.shiftId!==shiftId||
   submitted.evidenceReference!==reference||
   submitted.reason!==explanation||
   submitted.executionAbandoned!==negative||
   submitted.paymentExecutionAuthorized!==false||
   (refund
    ?submitted.refundAttemptId!==attemptId
    :submitted.exchangeAttemptId!==attemptId)
  ){
   throw Error('Investigation acknowledgement uncertain');
  }

  const verified=await read();

  if(current!==generation.current)return;

  if(!verified.records.some(
   (item:any)=>item.id===submitted.id
  )){
   throw Error('Submitted investigation not found in history');
  }

  setSnapshot(verified);
  setEvidence('');
  setReason('');
  setAbandoned(false);

  setMessage(
   'Investigation recorded. Independent HQ review required. '+
   'No payment has been authorized.'
  );

  await onChanged?.();
 }

 const locked=busy||disabled||!token;

 const records:any[]=snapshot?.records||[];

 return (
  <details style={{
   border:'1px solid #cbd5e1',
   borderRadius:6,
   padding:10,
   marginTop:10
  }}>

   <summary>{titles[kind]}</summary>

   <p className="hint">
    Record payment evidence for independent HQ review.
    This interface never authorizes physical payment.
   </p>

   <button
    className="secondary"
    disabled={locked}
    onClick={()=>void run(refresh)}
   >
    {busy?'Processing...':'Load investigation history'}
   </button>

   {snapshot&&(
    <>

     <p>
      Central: {snapshot.status}
      {' / '}{snapshot.paymentState}
      {snapshot.reversalStatus
       ?' / '+snapshot.reversalStatus:''}
     </p>

     {snapshot.financialHold===true&&(
      <p role="alert">
       Financial hold active. Contact HQ.
       Do not collect, pay or reverse money.
      </p>
     )}

     {snapshot.truncated===true&&(
      <p role="alert">
       History is incomplete. New submissions are disabled.
      </p>
     )}

     {records.map(item=>(
      <div key={item.id} style={{
       borderTop:'1px solid #cbd5e1',
       paddingTop:8,
       marginTop:8
      }}>

       <strong>
        {item.kind}: {item.proposedOutcome}
        {' / '}{item.status}
       </strong>

       <p>Evidence: {item.evidenceReference}</p>
       <p>Reason: {item.reason}</p>
       <p>Submitted by: {item.submittedById}</p>
       <p>Submitted at: {item.submittedAt}</p>

       {item.executionAbandoned&&(
        <p role="alert">
         Original execution authority permanently surrendered.
        </p>
       )}

       {item.reviewedById&&(
        <>
         <p>Reviewer: {item.reviewedById}</p>
         <p>Reviewed at: {item.reviewedAt}</p>
         <p>Review note: {item.reviewNote}</p>
        </>
       )}

      </div>
     ))}

     {!records.length&&<p>No investigations recorded.</p>}

     {eligible(snapshot)&&(
      <div style={{display:'grid',gap:8,marginTop:12}}>

       <label>
        Proposed outcome

        <select
         value={outcome}
         disabled={locked}
         onChange={event=>{
          setOutcome(event.target.value);
          setAbandoned(false);
         }}
        >
         {outcomes[kind].map(value=>(
          <option
           key={value}
           value={value}
           disabled={
            value===outcomes[kind][1]&&
            !canDeclareNegative(snapshot)
           }
          >
           {value.replace(/_/g,' ')}
          </option>
         ))}
        </select>
       </label>

       <label>
        Evidence reference

        <input
         value={evidence}
         maxLength={200}
         disabled={locked}
         onChange={event=>setEvidence(event.target.value)}
        />
       </label>

       <label>
        Investigation reason

        <textarea
         value={reason}
         maxLength={500}
         disabled={locked}
         onChange={event=>setReason(event.target.value)}
        />
       </label>

       {negative&&(
        <label>
         <input
          type="checkbox"
          checked={abandoned}
          disabled={locked}
          onChange={event=>setAbandoned(event.target.checked)}
         />
         I permanently surrender the original execution
         authority and will not perform this payment later.
        </label>
       )}

       <button
        disabled={
         locked||
         evidence.trim().length<5||
         reason.trim().length<10||
         (negative&&(!abandoned||!canDeclareNegative(snapshot)))
        }
        onClick={()=>void run(submit)}
       >
        Submit for independent HQ review
       </button>

      </div>
     )}

    </>
   )}

   {message&&<p role="status">{message}</p>}

  </details>
 );
}