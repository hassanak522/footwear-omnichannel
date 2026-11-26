import PaymentInvestigation from './payment-investigation';
// R10_3D24C_AUTHORITATIVE_DESKTOP_RECOVERY

import {useEffect,useRef,useState} from 'react';

import {
 assertRefundIdentity,
 verifyAcceptedRefund,
 finalizeLocalRefund
} from './refund-payment';

type Attempt=Awaited<
 ReturnType<typeof window.pos.listRefunds>
>[number];

type Props={
 request:(path:string,method?:string,body?:unknown)=>Promise<any>;
 token:string;
 location:string;
 onCompleted:()=>void;
 payoutBusy?:boolean;
};

const base='/pos/returns/settlements';

export default function RefundRecovery({
 request,token,location,onCompleted,payoutBusy=false
}:Props){

 const [attempts,setAttempts]=useState<Attempt[]>([]);
 const [central,setCentral]=useState<Record<string,any>>({});
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const active=useRef(false);

 async function refresh(){
  try{
   setAttempts(await window.pos.listRefunds());
  }catch(error){
   setMessage(String(error));
  }
 }

 useEffect(()=>{
  void refresh();

  const timer=window.setInterval(
   ()=>void refresh(),3000
  );

  return ()=>window.clearInterval(timer);
 },[]);

 useEffect(()=>{
  setCentral({});
  setMessage('');
 },[location,token]);

 async function recover(
  attempt:Attempt,
  action:'CHECK'|'CONFIRM'|'RESUME'
 ){

  if(
   active.current||
   payoutBusy||
   !token||
   attempt.location_id!==location
  )return;

  active.current=true;
  setBusy(true);
  setMessage('');

  try{

   const key=attempt.id;

   const payload=JSON.parse(attempt.payload);

   const check=async()=>{

    const result=await request(
     `${base}/status/${key}`
    );

    assertRefundIdentity(result,key);

    if(result.found===true){

     if(
      result.locationId!==location||
      result.returnId!==payload.returnId||
      result.method!==payload.method||
      Math.round(Number(result.amount)*100)!==
       Math.round(Number(payload.amount)*100)||
      (payload.deviceId&&result.deviceId!==payload.deviceId)||
      (payload.shiftId&&result.shiftId!==payload.shiftId)
     ){
      throw Error('Central refund identity mismatch');
     }
    }

    setCentral(previous=>({
     ...previous,[key]:result
    }));

    return result;
   };

   let result=await check();

   if(result.status==='RESOLVED_NO_PAYMENT'){

    // R10_3D24C_CONTRADICTORY_REFUND_EVIDENCE

    const latestLocal=(await window.pos.listRefunds())
     .find(item=>item.id===key);

    if(latestLocal?.status==='PAID'){

     throw Error(
      'FINANCIAL DISCREPANCY: The local journal records a completed '+
      'payout, but HQ resolved the attempt as unpaid. '+
      'Local payment evidence has been preserved. '+
      'An independent corrective financial transaction is required.'
     );
    }

    await window.pos.resolveRefund(key,result);

    setMessage(
     'Central unpaid resolution verified. Local journal closed.'
    );

    onCompleted();
    return;
   }

   if(result.status==='ACCEPTED'){

    const verified=await verifyAcceptedRefund(
     request,key,location
    );

    await finalizeLocalRefund(key,verified);

    setMessage('Existing refund settlement verified.');

    onCompleted();
    return;
   }

   if(result.status==='NOT_FOUND'){

    setMessage(
     'No central registration found. Do not issue payment. '+
     'The original local record requires investigation.'
    );

    return;
   }

   if(action==='CHECK'){

    setMessage(
     'Central refund state: '+result.status+
     ' / '+result.paymentState+
     '. Do not repeat physical payment.'
    );

    return;
   }

   if(action==='CONFIRM'){

     // R10_3D24C_REFUND_PERMISSION_INTERFACE

     if(result.canConfirmPayment!==true){
      throw Error(
       'Ordinary confirmation is unavailable. '+
       'Independent payment investigation is required.'
      );
     }

    if(
     result.status!=='PAYMENT_AUTHORIZED'||
     result.paymentState!=='UNKNOWN'
    ){
     throw Error(
      'Central refund is not awaiting payment confirmation'
     );
    }

    if(!window.confirm(
     'Confirm ONLY if the original refund was already paid.\n\n'+
     'Refund: '+key+'\n'+
     'Amount: PKR '+Number(payload.amount).toFixed(2)+'\n'+
     'Method: '+payload.method+'\n\n'+
     'Verify the physical payment evidence first. '+
     'Do not issue another payment.'
    ))return;

     // R10_3D24C_CENTRAL_FIRST_REFUND_CONFIRMATION

     const current=(await window.pos.listRefunds())
      .find(item=>item.id===key);

     if(!current){
      throw Error('Local refund record unavailable');
     }

     if(!['PREPARED','UNKNOWN','PAID'].includes(current.status)){
      throw Error('Unexpected local refund state');
     }

     if(current.status==='PREPARED'){
      await window.pos.updateRefund(key,'UNKNOWN');
     }

     await request(
      `${base}/${key}/confirm-payment`,
      'POST'
     );

     result=await check();

     if(
      result.found!==true||
      result.status!=='PAID'||
      result.paymentState!=='CONFIRMED'
     ){
      throw Error(
       'Central confirmation not verified. '+
       'Local payment remains unresolved.'
      );
     }

     const confirmedLocal=(await window.pos.listRefunds())
      .find(item=>item.id===key);

     if(!confirmedLocal){
      throw Error('Local refund journal unavailable');
     }

     if(confirmedLocal.status==='UNKNOWN'){
      await window.pos.updateRefund(key,'PAID');
     }else if(confirmedLocal.status!=='PAID'){
      throw Error('Unexpected local confirmation state');
     }
   }

   if(
    result.status!=='PAID'||
    result.paymentState!=='CONFIRMED'
   ){
    throw Error(
     'Central payment confirmation is required before settlement'
    );
   }

   await request(
    `${base}/${key}/resume`,
    'POST'
   );

   const verified=await verifyAcceptedRefund(
    request,key,location
   );

   await finalizeLocalRefund(key,verified);

   setMessage(
    'Refund recovered successfully without repeating payment.'
   );

   onCompleted();

  }catch(error){

   setMessage(
    String(error)+
    ' Do not repeat physical payment. '+
    'The original refund identity remains preserved.'
   );

  }finally{

   active.current=false;
   setBusy(false);
   await refresh();
  }
 }

 const visible=attempts.filter(
  item=>item.location_id===location
 );

 if(!attempts.length&&!message)return null;

 return (
  <div className="panel">

   <h3>Refund payment recovery</h3>

   <p className="hint">
    Reconcile interrupted refunds without issuing another
    payment. Always check the authoritative central state.
   </p>

   {attempts.length!==visible.length&&(
    <p role="alert">
     This terminal has unresolved refunds from another branch.
    </p>
   )}

   {visible.map(attempt=>{

    const payload=JSON.parse(attempt.payload);
    const state=central[attempt.id];
    const disabled=busy||payoutBusy||!token;

    return (
     <div key={attempt.id} style={{
      border:'1px solid #d1d5db',
      padding:12,
      marginBottom:12,
      borderRadius:6
     }}>

      <strong>Local: {attempt.status}</strong>

      <p>
       Central: {state?.status||'Not checked'}
       {state?.paymentState
        ?' / '+state.paymentState:''}
      </p>

      <p>Refund ID: {attempt.id}</p>
      {attempt.status==='PAID'&&
       state?.status==='RESOLVED_NO_PAYMENT'&&(
        <div role="alert" className="notice">
         <strong>Financial discrepancy - manager action required</strong>
         <p>
          The local journal records a completed payout,
          but the central attempt was resolved as unpaid.
          Do not repeat payment or discard the original journal.
         </p>
        </div>
      )}


       {/* R10_3D24C_LOCAL_REFUND_INVESTIGATION */}

       {state?.found===true&&
        state.status==='PAYMENT_AUTHORIZED'&&
        state.paymentState==='UNKNOWN'&&
        state.locationId===location&&
        state.deviceId&&state.shiftId&&(
         <PaymentInvestigation
          key={attempt.id+':refund'}
          request={request}
          token={token}
          attemptId={attempt.id}
          locationId={location}
          deviceId={state.deviceId}
          shiftId={state.shiftId}
          kind="REFUND_PAYOUT"
          disabled={disabled}
          onChanged={()=>recover(attempt,'CHECK')}
         />
       )}


      <p>Return ID: {payload.returnId}</p>

      <p>
       PKR {Number(payload.amount).toFixed(2)}
       {' | '}{payload.method}
      </p>

      <p>
       Prepared: {new Date(
        attempt.created_at
       ).toLocaleString()}
      </p>

      <button
       className="secondary"
       disabled={disabled}
       onClick={()=>void recover(attempt,'CHECK')}
      >
       Check central refund
      </button>

      {state?.status==='PAYMENT_AUTHORIZED'&&
        state.canConfirmPayment===true&&
        state.paymentState==='UNKNOWN'&&(
        <button
         disabled={disabled}
         onClick={()=>void recover(attempt,'CONFIRM')}
        >
         Confirm previously completed payment
        </button>
      )}

      {state?.investigationPending===true&&(
        <p role="alert">
         Independent investigation pending.
         Ordinary payment confirmation is suspended.
        </p>
       )}

       {state?.executionAbandoned===true&&(
        <p role="alert">
         Original execution authority permanently surrendered.
         Do not issue or repeat payment.
        </p>
       )}

       {state?.status==='PAYMENT_AUTHORIZED'&&
        state.canConfirmPayment!==true&&(
         <p className="hint">
          Use independent investigation to reconcile
          the original payment evidence.
         </p>
       )}

{state?.status==='PAID'&&
       state.paymentState==='CONFIRMED'&&(
        <button
         disabled={disabled}
         onClick={()=>void recover(attempt,'RESUME')}
        >
         Resume financial settlement
        </button>
      )}

      {state?.status==='REGISTERED'&&(
       <p role="alert">
        Payment was not authorized. HQ can review
        and cancel this reservation.
       </p>
      )}

      {state?.status==='PAYMENT_AUTHORIZED'&&(
       <p role="alert">
        Payment authorization was issued. Verify the
        actual payout before confirming payment.
       </p>
      )}

      {state?.status==='NOT_FOUND'&&(
       <p role="alert">
        Missing central registration requires investigation.
        Do not pay or discard the local record.
       </p>
      )}

     </div>
    );
   })}

   {message&&<p role="status">{message}</p>}

  </div>
 );
}