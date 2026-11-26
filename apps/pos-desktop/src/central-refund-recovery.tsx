import PaymentInvestigation from './payment-investigation';
// R10_3D24C_CENTRAL_DESKTOP_DISCOVERY

import {useEffect,useRef,useState} from 'react';
import {
 assertRefundIdentity,
 verifyAcceptedRefund
} from './refund-payment';

type Props={
 request:(path:string,method?:string,body?:unknown)=>Promise<any>;
 token:string;
 location:string;
 payoutBusy?:boolean;
 onCompleted:()=>void;
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
 requiresReconciliation:boolean;
 canResume:boolean;
 canCancel:boolean;
};

const base='/pos/returns/settlements';

export default function CentralRefundRecovery({
 request,
 token,
 location,
 payoutBusy=false,
 onCompleted
}:Props){

 const [records,setRecords]=useState<Refund[]>([]);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [truncated,setTruncated]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [checkedAt,setCheckedAt]=useState('');
 const active=useRef(false);
 const generation=useRef(0);

 useEffect(()=>{
  generation.current++;
  setRecords([]);
  setMessage('');
  setLoaded(false);
  setTruncated(false);
  setCheckedAt('');

  return ()=>{
   generation.current++;
  };
 },[location,token]);

 async function load(){

  if(!token||!location)return;

  const current=generation.current;

  const result=await request(
   `${base}/pending?locationId=${encodeURIComponent(location)}`
  );

  if(
   result.locationId!==location||
   !Array.isArray(result.records)
  ){
   throw Error('Invalid central refund discovery response');
  }

  const local=await window.pos.listRefunds();
  const localIds=new Set(local.map(item=>item.id));

  const discovered:Refund[]=result.records;

  for(const item of discovered){

   if(
    item.locationId!==location||
    item.id!==item.idempotencyKey||
    !item.returnId||
    !item.deviceId||
    !item.shiftId||
    !Number.isFinite(Number(item.amount))||
    Number(item.amount)<=0
   ){
    throw Error('Invalid central refund record');
   }
  }

  if(current!==generation.current)return;

  setRecords(
   discovered.filter(item=>!localIds.has(item.id))
  );

  setTruncated(result.truncated===true);
  setCheckedAt(result.fetchedAt||new Date().toISOString());
  setLoaded(true);
 }

 async function refresh(){

  if(active.current||payoutBusy||!token)return;

  active.current=true;
  setBusy(true);
  setMessage('');

  try{
   await load();
  }catch(error){
   setLoaded(false);
   setRecords([]);
   setMessage(String(error));
  }finally{
   active.current=false;
   setBusy(false);
  }
 }

 async function recover(
  item:Refund,
  action:'CHECK'|'RESUME'|'CANCEL'
 ){

  if(
   active.current||
   payoutBusy||
   !token||
   item.locationId!==location
  )return;

  active.current=true;
  setBusy(true);
  setMessage('');

  const current=generation.current;

  try{

   const key=item.idempotencyKey;

   const check=async()=>{

    const state=await request(`${base}/status/${key}`);

    assertRefundIdentity(state,key);

    if(
     state.found!==true||
     state.locationId!==location||
     state.returnId!==item.returnId||
     state.deviceId!==item.deviceId||
     state.shiftId!==item.shiftId||
     state.method!==item.method||
     Math.round(Number(state.amount)*100)!==
      Math.round(Number(item.amount)*100)
    ){
     throw Error('Central refund identity mismatch');
    }

    if(current!==generation.current){
     throw Error('Session or branch changed');
    }

    return state;
   };

   const state=await check();

   if(state.status==='ACCEPTED'){

    await verifyAcceptedRefund(request,key,location);

    setMessage('Existing settlement verified.');
    onCompleted();

   }else if(state.status==='RESOLVED_NO_PAYMENT'){

    setMessage('Refund already resolved without payment.');
    onCompleted();

   }else if(action==='CHECK'){

    setMessage(
     `Refund ${key}: ${state.status} / ${state.paymentState}`
    );

   }else if(action==='RESUME'){

    if(
     state.status!=='PAID'||
     state.paymentState!=='CONFIRMED'
    ){
     throw Error('Confirmed payment is required');
    }

    if(!window.confirm(
     'Resume financial settlement for this previously paid refund?\n\n'+
     'Do not issue any additional physical payment.'
    ))return;

    await request(`${base}/${key}/resume`,'POST');

    await verifyAcceptedRefund(request,key,location);

    setMessage(
     'Central settlement completed without additional payment.'
    );

    onCompleted();

   }else if(action==='CANCEL'){

    if(
     !item.canCancel||
     state.status!=='REGISTERED'||
     state.paymentState!=='UNCONFIRMED'
    ){
     throw Error('Refund is not eligible for unpaid cancellation');
    }

    const reason=window.prompt(
     'Enter the reason for cancelling this unpaid refund.'
    )?.trim();

    if(reason===undefined)return;

    if(reason.length<10||reason.length>500){
     throw Error('Reason must contain 10-500 characters');
    }

    const evidenceReference=window.prompt(
     'Enter the supporting evidence or investigation reference.'
    )?.trim();

    if(evidenceReference===undefined)return;

    if(
     evidenceReference.length<5||
     evidenceReference.length>200
    ){
     throw Error('Evidence reference must contain 5-200 characters');
    }

    if(!window.confirm(
     'Confirm that payment was never authorized or issued.\n\n'+
     'This action closes the central refund reservation.'
    ))return;

    await request(
     `${base}/${key}/resolve-no-payment`,
     'POST',
     {reason,evidenceReference}
    );

    const resolved=await check();

    if(
     resolved.status!=='RESOLVED_NO_PAYMENT'||
     resolved.paymentState!=='NOT_PAID'
    ){
     throw Error('Central resolution could not be verified');
    }

    setMessage('Unpaid refund reservation resolved.');
    onCompleted();
   }

   await load();

  }catch(error){

   setMessage(
    String(error)+
    ' Do not issue another physical payment.'
   );

  }finally{
   active.current=false;
   setBusy(false);
  }
 }

 const disabled=busy||payoutBusy||!token||!location;

 return (
  <div className="panel">

   <h3>Central refund recovery</h3>

   <p className="hint">
    Discover interrupted refunds from other terminals
    or from a lost local POS journal.
    Never repeat a physical payment during recovery.
   </p>

   <button
    className="secondary"
    disabled={disabled}
    onClick={()=>void refresh()}
   >
    {busy?'Processing...':'Discover central refunds'}
   </button>

   {checkedAt&&(
    <p className="hint">
     Last checked: {new Date(checkedAt).toLocaleString()}
    </p>
   )}

   {truncated&&(
    <p role="alert">
     Results are limited to 200 records.
     Additional unresolved refunds may exist.
    </p>
   )}

   {loaded&&!records.length&&(
    <p>
     No additional pending central refunds found
     in the returned records.
    </p>
   )}

   {records.map(item=>(
    <div key={item.id} style={{
     border:'1px solid #d1d5db',
     borderRadius:6,
     padding:12,
     marginTop:12
    }}>

     <strong>{item.status} / {item.paymentState}</strong>

     <p>
      PKR {Number(item.amount).toFixed(2)}
      {' | '}{item.method}
     </p>

     <p>Refund: {item.id}</p>
     <p>Return: {item.returnId}</p>
     <p>Original device: {item.deviceId}</p>
     <p>Original shift: {item.shiftId}</p>
     <p>Registered by: {item.registeredById}</p>

     <p>
      Registered: {new Date(item.createdAt).toLocaleString()}
     </p>

     <button
      className="secondary"
      disabled={disabled}
      onClick={()=>void recover(item,'CHECK')}
     >
      Check authoritative status
     </button>

     {item.canResume&&(
      <button
       disabled={disabled}
       onClick={()=>void recover(item,'RESUME')}
      >
       Resume financial settlement
      </button>
     )}

     {item.canCancel&&(
      <button
       className="secondary"
       disabled={disabled}
       onClick={()=>void recover(item,'CANCEL')}
      >
       Resolve unpaid reservation
      </button>
     )}

     {/* R10_3D24C_CENTRAL_REFUND_INVESTIGATION */}

     {item.status==='PAYMENT_AUTHORIZED'&&
      item.paymentState==='UNKNOWN'&&(
       <PaymentInvestigation
        key={item.id+':refund'}
        request={request}
        token={token}
        attemptId={item.id}
        locationId={item.locationId}
        deviceId={item.deviceId}
        shiftId={item.shiftId}
        kind="REFUND_PAYOUT"
        disabled={disabled||!loaded||truncated}
        onChanged={refresh}
       />
     )}

     {item.requiresReconciliation&&(
      <p role="alert">
       Physical payment outcome is uncertain.
       HQ must reconcile the original payment evidence.
       Do not pay again or cancel this refund.
      </p>
     )}

    </div>
   ))}

   {message&&<p role="status">{message}</p>}

  </div>
 );
}