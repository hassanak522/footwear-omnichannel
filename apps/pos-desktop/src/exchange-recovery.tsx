import {useEffect,useRef,useState} from 'react';

type RequestFn=(
 path:string,
 method?:string,
 body?:unknown
)=>Promise<any>;

type Attempt={
 id:string;
 payload:string;
 status:string;
 created_at:string;
 server_response:string|null;
 error:string|null;
};

export default function ExchangeRecovery({
 request,token,location
}:{
 request:RequestFn;
 token:string;
 location:string;
}){

 const active=useRef(false);
 const [centralStates,setCentralStates]=useState<Record<string,any>>({});
const [attempts,setAttempts]=useState<Attempt[]>([]);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');

 async function refresh(){
  try{
   setAttempts(await window.pos.listExchanges());
  }catch(error){
   setMessage('Exchange journal unavailable: '+String(error));
  }
 }

 useEffect(()=>{
  void refresh();

  const timer=setInterval(()=>{
   void refresh();
  },3000);

  return ()=>clearInterval(timer);
 },[token,location]);


 // R10_3D23B_RECOVERY_ACTIONS

 async function checkCentral(attempt:Attempt){

  const payload=JSON.parse(attempt.payload);

  if(payload.locationId!==location){
   throw Error('Exchange belongs to another branch');
  }

  const result=await request(
   '/pos/exchanges/status/'+encodeURIComponent(attempt.id)
  );

  if(result.idempotencyKey!==attempt.id){
   throw Error('Central transaction identity mismatch');
  }

  if(
   result.status!=='NOT_FOUND'&&
   result.locationId!==location
  ){
   throw Error('Central branch identity mismatch');
  }

  setCentralStates(current=>({
   ...current,[attempt.id]:result
  }));

  if(result.status==='ACCEPTED'){

   await window.pos.updateExchange(
    attempt.id,'ACCEPTED',result
   );

  }else if(result.status==='RESOLVED_NO_EXCHANGE'){

   await window.pos.resolveExchange(attempt.id,result);

  }else if(
   !['ACCEPTED','RESOLVED_NO_EXCHANGE'].includes(attempt.status)
  ){

   await window.pos.updateExchange(
    attempt.id,'UNKNOWN',undefined,
    'Central status: '+result.status
   );
  }

  return result;
 }

 async function perform(
  attempt:Attempt,
  action:'CHECK'|'RESUME'|'REGISTER'|'CONFIRM'|'RESOLVE'
 ){

  if(active.current||!token)return;

  active.current=true;
  setBusy(true);
  setMessage('');

  try{

   let central=await checkCentral(attempt);

   if(
    ['ACCEPTED','RESOLVED_NO_EXCHANGE'].includes(central.status)
   ){
    setMessage('Central terminal outcome verified: '+central.status);
    return;
   }

   const base='/pos/exchanges/'+encodeURIComponent(attempt.id);

   if(action==='REGISTER'){

    if(central.status!=='NOT_FOUND'){
     throw Error('Exchange already registered');
    }

    if(!window.confirm(
     'Register the original saved transaction? '+
     'This does not authorize collecting payment.'
    ))return;

    await request(
     '/pos/exchanges/register',
     'POST',
     JSON.parse(attempt.payload)
    );
   }

   if(action==='CONFIRM'){

    if(
     !['REGISTERED','UNKNOWN'].includes(central.status)||
     central.paymentState!=='UNCONFIRMED'
    ){
     throw Error('Payment confirmation is not eligible');
    }

    const payload=JSON.parse(attempt.payload);

    const amount=payload.additionalTenders.reduce(
     (sum:number,tender:any)=>sum+Number(tender.amount),0
    );

    if(!window.confirm(
     'Confirm only after checking the original payment evidence. '+
     'PKR '+amount.toFixed(2)+' was already collected exactly once. '+
     'Do not collect any additional payment.'
    ))return;

    await request(base+'/confirm-payment','POST');
   }

   if(action==='RESUME'){

    if(
     !['REGISTERED','UNKNOWN'].includes(central.status)||
     !['CONFIRMED','NO_PAYMENT_REQUIRED'].includes(
      central.paymentState
     )
    ){
     throw Error('Exchange is not eligible for safe retry');
    }

    if(!window.confirm(
     'Resume the original transaction using its existing identity? '+
     'No additional payment should be collected.'
    ))return;

    await request(base+'/resume','POST');
   }

   if(action==='RESOLVE'){

    if(!['REGISTERED','UNKNOWN'].includes(central.status)){
     throw Error('Central registration required before resolution');
    }

    let paymentState:string;

    if(central.paymentState==='NO_PAYMENT_REQUIRED'){
     paymentState='NO_PAYMENT_REQUIRED';
    }else{

     const answer=window.prompt(
      'HQ authorization required. Enter NOT_COLLECTED or REVERSED '+
      'after independently verifying the physical payment outcome.'
     );

     if(answer===null)return;

     paymentState=answer.trim().toUpperCase();

     if(!['NOT_COLLECTED','REVERSED'].includes(paymentState)){
      throw Error('Invalid resolution payment state');
     }
    }

    if(
     central.paymentState==='CONFIRMED'&&
     paymentState!=='REVERSED'
    ){
     throw Error('Confirmed payment must be reversed');
    }

    const reason=window.prompt(
     'Enter a detailed resolution reason (10-500 characters).'
    );

    if(reason===null)return;

    if(reason.trim().length<10||reason.trim().length>500){
     throw Error('Detailed resolution reason required');
    }

    let evidenceReference:string|undefined;

    if(paymentState==='REVERSED'){

     const evidence=window.prompt(
      'Enter the completed payment reversal evidence reference.'
     );

     if(evidence===null)return;

     if(evidence.trim().length<5||evidence.trim().length>200){
      throw Error('Valid reversal evidence required');
     }

     evidenceReference=evidence.trim();
    }

    if(!window.confirm(
     'Resolve without completing the exchange? '+
     'Confirm that merchandise and payment have been reconciled. '+
     'This action is permanently audited.'
    ))return;

    await request(base+'/resolve','POST',{
     paymentState,
     reason:reason.trim(),
     evidenceReference
    });
   }

   central=await checkCentral(attempt);

   setMessage(
    'Central status: '+central.status+
    (central.paymentState?' | '+central.paymentState:'')+
    '. Do not collect payment again.'
   );

  }catch(error){

   setMessage(
    'Recovery requires attention: '+String(error)+
    '. Do not collect payment again or release merchandise '+
    'without verified central acceptance.'
   );

  }finally{

   await refresh();
   active.current=false;
   setBusy(false);
  }
 }
 // R10_3D23B_PRINT_ACTION

 async function printExchange(attempt:Attempt){

  if(active.current||!token)return;

  active.current=true;
  setBusy(true);
  setMessage('');

  try{

   const central=await checkCentral(attempt);

   if(
    central.status!=='ACCEPTED'||
    central.integrityVerified!==true
   ){
    throw Error('Central exchange integrity not verified');
   }

   const result=await window.pos.printExchange(attempt.id);

   setMessage(
    result.success
     ?'Exchange receipt submitted to printer.'
     :'Receipt printing not completed: '+(result.reason||'Cancelled')
   );

  }catch(error){

   setMessage('Receipt printing unavailable: '+String(error));

  }finally{

   await refresh();
   active.current=false;
   setBusy(false);

  }
 }

function downloadReceipt(attempt:Attempt){

  if(attempt.status!=='ACCEPTED'||!attempt.server_response)return;

  const r=JSON.parse(attempt.server_response);

  const text=[
   'ROYAL STEP',
   'MERCHANDISE EXCHANGE RECEIPT',
   '',
   'Exchange: '+r.id,
   'Transaction: '+attempt.id,
   'Original sale: '+r.originalSaleId,
   'Return: '+r.returnId,
   'Replacement sale: '+r.replacementSaleId,
   'Branch: '+r.locationId,
   'Recorded: '+r.createdAt,
   '',
   'Return value: PKR '+r.returnValue,
   'Replacement value: PKR '+r.replacementValue,
   'Exchange credit: PKR '+r.exchangeCredit,
   'Additional payment: PKR '+r.additionalPayment,
   'Residual refund due: PKR '+r.residualRefund,
   'Residual refund recorded: PKR '+r.residualRefundPaid,
   'Residual outstanding: PKR '+r.residualRefundOutstanding,
   '',
   'Status: ACCEPTED',
   'Residual refund information is as of last reconciliation.',
   'This receipt does not authorize an additional refund.',
   'Thank you for shopping at Royal Step.'
  ].join('\n');

  const url=URL.createObjectURL(
   new Blob([text],{type:'text/plain;charset=utf-8'})
  );

  const link=document.createElement('a');
  link.href=url;
  link.download='Royal-Step-Exchange-'+attempt.id+'.txt';
  link.click();

  setTimeout(()=>URL.revokeObjectURL(url),1000);
 }

 const visible=attempts.filter(attempt=>{
  try{
   return JSON.parse(attempt.payload).locationId===location;
  }catch{
   return false;
  }
 });

 const unresolved=attempts.filter(
  attempt=>!['ACCEPTED','RESOLVED_NO_EXCHANGE'].includes(attempt.status)
 );

 return (
  <section className="panel">
   <h3>Exchange transaction history and recovery</h3>

   {unresolved.length>0&&(
    <p role="alert">
     {unresolved.length} unresolved exchange transaction(s)
     on this terminal. New exchanges and shift closing
     must remain blocked until reconciled.
    </p>
   )}

   <button
    className="secondary"
    disabled={busy}
    onClick={()=>void refresh()}
   >
    Refresh exchange history
   </button>

   <div className="tablewrap">
    <table>
     <thead>
      <tr>
       <th>Transaction</th>
       <th>Created</th>
       <th>Status</th>
       <th>Actions</th>
      </tr>
     </thead>

     <tbody>
      {visible.map(attempt=>(
       <tr key={attempt.id}>
        <td>{attempt.id}</td>
        <td>{attempt.created_at}</td>
        <td>
         {attempt.status}
         {attempt.error&&<p>{attempt.error}</p>}
        </td>
        <td>
         <button
          className="secondary"
          disabled={busy||!token}
          onClick={()=>void perform(attempt,'CHECK')}
         >
          Check central status
         </button>

         {centralStates[attempt.id]&&(
           <p>
            Central: {centralStates[attempt.id].status}
            {' '+(centralStates[attempt.id].paymentState||'')}
           </p>
          )}

          {!['ACCEPTED','RESOLVED_NO_EXCHANGE'].includes(attempt.status)&&(
           <>
            {centralStates[attempt.id]?.status==='NOT_FOUND'&&(
             <button
              className="secondary"
              disabled={busy||!token}
              onClick={()=>void perform(attempt,'REGISTER')}
             >
              Register saved transaction
             </button>
            )}

            {['REGISTERED','UNKNOWN'].includes(
             centralStates[attempt.id]?.status
            )&&(
             <>
              {centralStates[attempt.id]?.paymentState==='UNCONFIRMED'&&(
               <button
                className="secondary"
                disabled={busy||!token}
                onClick={()=>void perform(attempt,'CONFIRM')}
               >
                Confirm previously collected payment
               </button>
              )}

              {['CONFIRMED','NO_PAYMENT_REQUIRED'].includes(
               centralStates[attempt.id]?.paymentState
              )&&(
               <button
                className="secondary"
                disabled={busy||!token}
                onClick={()=>void perform(attempt,'RESUME')}
               >
                Resume original exchange
               </button>
              )}

              <button
               className="secondary"
               disabled={busy||!token}
               onClick={()=>void perform(attempt,'RESOLVE')}
              >
               HQ: Resolve without exchange
              </button>
             </>
            )}
           </>
          )}

{attempt.status==='ACCEPTED'&&(
          <>
           <button
            className="secondary"
            disabled={busy||!token}
            onClick={()=>void printExchange(attempt)}
           >
            Print exchange receipt
           </button>

           <button
            className="secondary"
            disabled={busy}
            onClick={()=>downloadReceipt(attempt)}
           >
            Download receipt
           </button>
          </>
         )}
        </td>
       </tr>
      ))}
     </tbody>
    </table>
   </div>

   {!visible.length&&<p>No exchange transactions recorded.</p>}

   {message&&<p role="status">{message}</p>}
  </section>
 );
}