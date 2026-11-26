import PaymentInvestigation from './payment-investigation';
import {useEffect,useRef,useState} from 'react';

// R10_3D24C_DESKTOP_CENTRAL_EXCHANGE_RECOVERY

type RequestFn=(
 path:string,
 method?:string,
 body?:unknown
)=>Promise<any>;

type CentralAttempt={
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
 reversalExecutionById?:string;
 reversalExecutionAt?:string;
 reversalApprovalEvidence?:string;
 reversalEvidenceReference?:string;
 canRequestReversal?:boolean;
 canClaimReversal?:boolean;
 canConfirmReversal?:boolean;
 canResume:boolean;
};

export default function CentralExchangeRecovery({
 request,token,location
}:{
 request:RequestFn;
 token:string;
 location:string;
}){

 const active=useRef(false);
 const generation=useRef(0);

 const [records,setRecords]=useState<CentralAttempt[]>([]);
 const [localIds,setLocalIds]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 const [truncated,setTruncated]=useState(false);
 const [fetchedAt,setFetchedAt]=useState('');
 const [journalAvailable,setJournalAvailable]=useState(false);

 async function refresh(){

  const current=++generation.current;

  if(!token||!location){
   setRecords([]);
   setLocalIds([]);
   setFetchedAt('');
   return;
  }

  try{

   const result=await request(
    '/pos/exchanges/pending?locationId='+
    encodeURIComponent(location)
   );

   if(
    result.locationId!==location||
    !Array.isArray(result.records)||
    result.records.some(
     (item:CentralAttempt)=>item.locationId!==location
    )
   ){
    throw Error('Central branch identity mismatch');
   }

   if(current!==generation.current)return;

   setRecords(result.records);
   setTruncated(result.truncated===true);
   setFetchedAt(result.fetchedAt||'');
   setError('');

  }catch(error){

   if(current!==generation.current)return;

   setError(
    'Central exchange recovery unavailable: '+String(error)
   );

   setFetchedAt('');
  }

  try{

   const local=await window.pos.listExchanges();

   if(current!==generation.current)return;

   setLocalIds(local.map(item=>item.id));
   setJournalAvailable(true);

  }catch{

   if(current!==generation.current)return;

   setJournalAvailable(false);
  }
 }

 useEffect(()=>{

  setRecords([]);
  setLocalIds([]);
  setFetchedAt('');
  setMessage('');
  setError('');
  setJournalAvailable(false);

  void refresh();

  const timer=setInterval(()=>{
   if(!active.current)void refresh();
  },15000);

  return ()=>{
   generation.current++;
   clearInterval(timer);
  };

 },[token,location]);

 async function resume(item:CentralAttempt){

  if(active.current||!token||!location)return;

  active.current=true;
  setBusy(true);
  setMessage('');

  try{

   const key=item.idempotencyKey;

   const base='/pos/exchanges/'+encodeURIComponent(key);


   // Always use the authoritative status endpoint.
   const status=await request(
    '/pos/exchanges/status/'+encodeURIComponent(key)
   );

   if(
    status.idempotencyKey!==key||
    status.locationId!==location||
    status.deviceId!==item.deviceId||
    status.shiftId!==item.shiftId||
    status.originalSaleId!==item.originalSaleId
   ){
    throw Error('Central exchange identity mismatch');
   }

   if(
    !['REGISTERED','UNKNOWN'].includes(status.status)||
    status.reversalStatus!=='NONE'||
    !['CONFIRMED','NO_PAYMENT_REQUIRED'].includes(
     status.paymentState
    )
   ){
    throw Error('Exchange is not eligible for safe recovery');
   }

   if(!window.confirm(
    'Resume the original centrally registered exchange? '+
    'Do not collect or reverse any additional payment.'
   ))return;

   await request(base+'/resume','POST');

   const verified=await request(
    '/pos/exchanges/status/'+encodeURIComponent(key)
   );

   if(
    verified.idempotencyKey!==key||
    verified.locationId!==location||
    verified.deviceId!==item.deviceId||
    verified.shiftId!==item.shiftId||
    verified.originalSaleId!==item.originalSaleId||
    verified.status!=='ACCEPTED'||
    verified.integrityVerified!==true
   ){
    throw Error('Central acceptance could not be verified');
   }

   const local=await window.pos.listExchanges();

   const saved=local.find(entry=>entry.id===key);

   if(saved){
    await window.pos.updateExchange(
     key,'ACCEPTED',verified
    );
   }

   setMessage(
    'Exchange accepted and centrally verified. '+
    'Transaction: '+key
   );

  }catch(error){

   setMessage(
    'Recovery requires attention: '+String(error)+
    '. Do not repeat any payment operation.'
   );

  }finally{

   await refresh();
   active.current=false;
   setBusy(false);
  }
 }

 // R10_3D24C_DESKTOP_REVERSAL_EXECUTION

 async function reverse(
  item:CentralAttempt,
  action:'REQUEST'|'CLAIM'|'CONFIRM'
 ){

  if(active.current||!token||!location||!fetchedAt)return;

  active.current=true;
  setBusy(true);
  setMessage('');

  const key=item.idempotencyKey;
  const base='/pos/exchanges/'+encodeURIComponent(key);

  function verifyIdentity(result:any){

   if(
    result.idempotencyKey!==key||
    result.locationId!==location||
    result.deviceId!==item.deviceId||
    result.shiftId!==item.shiftId
   ){
    throw Error('Central reversal identity mismatch');
   }
  }

  try{

   const central=await request(
    '/pos/exchanges/status/'+encodeURIComponent(key)
   );

   verifyIdentity(central);

   if(
    central.originalSaleId!==item.originalSaleId||
    !['REGISTERED','UNKNOWN'].includes(central.status)||
    central.paymentState!=='CONFIRMED'
   ){
    throw Error('Confirmed unresolved collection required');
   }

   if(action==='REQUEST'){

    if(
     central.canRequestReversal!==true||
     central.reversalStatus!=='NONE'
    ){
     throw Error('Original collection operator required');
    }

    const reason=window.prompt(
     'Enter the detailed reason for reversal investigation. '+
     'Stop all collection activity for this transaction. '+
     'Do not reverse any payment yet.'
    )?.trim();

    if(reason===undefined)return;

    if(reason.length<10||reason.length>500){
     throw Error('Reason must contain 10-500 characters');
    }

    await request(
     base+'/reversal/request','POST',{reason}
    );

    setMessage(
     'Investigation submitted. Independent HQ approval required.'
    );

   }else if(action==='CLAIM'){

    if(
     central.canClaimReversal!==true||
     central.reversalStatus!=='AUTHORIZED'||
     central.reversalExecutionAt||
     !central.reversalApprovalEvidence
    ){
     throw Error('Exclusive reversal claim unavailable');
    }

    const evidenceReference=window.prompt(
     'Enter the verified original payment evidence reference. '+
     'HQ approval reference: '+central.reversalApprovalEvidence+
     '. Verify the original tender amounts and payment methods.'
    )?.trim();

    if(evidenceReference===undefined)return;

    if(
     evidenceReference.length<5||
     evidenceReference.length>200
    ){
     throw Error('Evidence must contain 5-200 characters');
    }

    if(!window.confirm(
     'Obtain the one-time reversal execution claim? '+
     'This does not automatically return money. '+
     'If the response is lost, do not attempt another reversal.'
    ))return;

    const claim=await request(
     base+'/claim-reversal','POST',{evidenceReference}
    );

    verifyIdentity(claim);

    if(
     claim.paymentExecutionAuthorized!==true||
     claim.duplicate!==false||
     claim.reversalStatus!=='AUTHORIZED'||
     claim.paymentState!=='CONFIRMED'||
     claim.reversalExecutionById!==central.reversalRequestedById||
     !claim.reversalExecutionAt
    ){
     throw Error('Fresh exclusive execution claim not verified');
    }

    setMessage(
     'Exclusive execution claim recorded. '+
     'Transaction '+key+
     '. Reversal remains subject to verified original tender '+
     'amounts and the approved financial procedure. '+
     'Do not obtain another claim.'
    );

   }else{

    if(
     central.canConfirmReversal!==true||
     central.reversalStatus!=='AUTHORIZED'||
     !central.reversalExecutionAt||
     !central.reversalExecutionById
    ){
     throw Error('Verified execution claim required');
    }

    const evidenceReference=window.prompt(
     'Enter evidence of the already completed physical reversal. '+
     'Do not perform another payment operation.'
    )?.trim();

    if(evidenceReference===undefined)return;

    if(
     evidenceReference.length<5||
     evidenceReference.length>200
    ){
     throw Error('Completed reversal evidence required');
    }

    if(!window.confirm(
     'Confirm that all original additional tenders have already '+
     'been reversed exactly once and independently documented. '+
     'This records evidence only. It does not issue payment.'
    ))return;

    await request(
     base+'/reversal/confirm','POST',{evidenceReference}
    );

    const verified=await request(
     '/pos/exchanges/status/'+encodeURIComponent(key)
    );

    verifyIdentity(verified);

    if(
     verified.reversalStatus!=='CONFIRMED'||
     verified.reversalEvidenceReference!==evidenceReference||
     verified.reversalConfirmedById!==central.reversalExecutionById
    ){
     throw Error('Reversal confirmation not verified');
    }

    setMessage(
     'Completed reversal evidence recorded. '+
     'Independent HQ finalization remains required.'
    );
   }

  }catch(error){

   setMessage(
    'Reversal requires attention: '+String(error)+
    '. Do not repeat any physical payment operation. '+
    'Verify central status and contact HQ.'
   );

  }finally{

   await refresh();
   active.current=false;
   setBusy(false);
  }
 }

 if(!token||!location)return null;

 return (
  <section className="panel">

   <h3>Central exchange recovery</h3>

   <p>
    Unresolved exchanges registered centrally for this branch.
    This register remains available independently of the local
    POS transaction journal.
   </p>

   <button
    className="secondary"
    disabled={busy}
    onClick={()=>void refresh()}
   >
    Refresh central register
   </button>

   {fetchedAt&&(
    <p>Last central refresh: {fetchedAt}</p>
   )}

   {error&&<p role="alert">{error}</p>}

   {!journalAvailable&&(
    <p role="alert">
     Local journal could not be verified.
     Central recovery records remain visible.
    </p>
   )}

   {truncated&&(
    <p role="alert">
     More than 200 unresolved transactions exist.
     Contact HQ for complete reconciliation.
    </p>
   )}

   {records.length>0&&(
    <p role="alert">
     {records.length} unresolved central exchange(s).
     Do not repeat collection or reversal operations.
    </p>
   )}

   <div className="tablewrap">
    <table>
     <thead>
      <tr>
       <th>Transaction</th>
       <th>Device / shift</th>
       <th>Journal</th>
       <th>Payment status</th>
       <th>Reversal status</th>
       <th>Recovery</th>
      </tr>
     </thead>

     <tbody>
      {records.map(item=>(
       <tr key={item.idempotencyKey}>

        <td>
         {item.idempotencyKey}
         <p>{item.createdAt}</p>
        </td>

        <td>
         <p>Device: {item.deviceId}</p>
         <p>Shift: {item.shiftId}</p>
        </td>

        <td>
         {!journalAvailable
          ?'Unverified'
          :localIds.includes(item.idempotencyKey)
           ?'Local and central'
           :'Central only'}
        </td>

        <td>
         {item.status}
         <p>{item.paymentState}</p>
        </td>

        <td>
         {item.reversalStatus}

         {item.reversalStatus!=='NONE'&&(
          <p>HQ reconciliation required</p>
         )}
        </td>

        <td>
         {item.canResume&&
          item.reversalStatus==='NONE'&&(
           <button
            className="secondary"
            disabled={busy||!fetchedAt}
            onClick={()=>void resume(item)}
           >
            Resume original exchange
           </button>
         )}

          {item.canRequestReversal&&(
           <button
            className="secondary"
            disabled={busy||!fetchedAt}
            onClick={()=>void reverse(item,'REQUEST')}
           >
            Request reversal investigation
           </button>
          )}

          {item.canClaimReversal&&(
           <button
            className="secondary"
            disabled={busy||!fetchedAt}
            onClick={()=>void reverse(item,'CLAIM')}
           >
            Obtain exclusive execution claim
           </button>
          )}

          {item.reversalExecutionAt&&(
           <p role="status">
            Execution already claimed:
            {' '+item.reversalExecutionAt}.
            Do not repeat a physical reversal.
           </p>
          )}

          {item.canConfirmReversal&&(
           <button
            className="secondary"
            disabled={busy||!fetchedAt}
            onClick={()=>void reverse(item,'CONFIRM')}
           >
            Record completed reversal evidence
           </button>
          )}

          {item.reversalStatus==='CONFIRMED'&&(
           <p>Awaiting independent HQ finalization.</p>
          )}


          {/* R10_3D24C_CENTRAL_EXCHANGE_INVESTIGATION */}

          {item.paymentState==='UNCONFIRMED'&&
           item.reversalStatus==='NONE'&&(
            <PaymentInvestigation
             key={item.idempotencyKey+':collection'}
             request={request}
             token={token}
             attemptId={item.idempotencyKey}
             locationId={item.locationId}
             deviceId={item.deviceId}
             shiftId={item.shiftId}
             kind="EXCHANGE_COLLECTION"
             disabled={busy||!fetchedAt||truncated}
             onChanged={refresh}
            />
          )}

          {item.paymentState==='CONFIRMED'&&
           item.reversalStatus==='AUTHORIZED'&&
           item.reversalExecutionById&&
           item.reversalExecutionAt&&(
            <PaymentInvestigation
             key={item.idempotencyKey+':reversal'}
             request={request}
             token={token}
             attemptId={item.idempotencyKey}
             locationId={item.locationId}
             deviceId={item.deviceId}
             shiftId={item.shiftId}
             kind="EXCHANGE_REVERSAL"
             disabled={busy||!fetchedAt||truncated}
             onChanged={refresh}
            />
          )}

         {!item.canResume&&(
          <span>Requires reconciliation</span>
         )}
        </td>

       </tr>
      ))}
     </tbody>
    </table>
   </div>

   {!records.length&&fetchedAt&&!error&&(
    <p>No unresolved central exchanges.</p>
   )}

   {message&&<p role="status">{message}</p>}

  </section>
 );
}