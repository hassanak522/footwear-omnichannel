// R10_3D24C_AUTOMATIC_FINANCIAL_JOURNAL_SYNC

import {finalizeLocalRefund} from './refund-payment';

type Request = (
 path:string,
 method?:string,
 body?:unknown
)=>Promise<any>;

type Context = {
 request:Request;
 locationId:string;
 deviceId:string;
 isCurrent:()=>boolean;
};

type Summary = {
 checked:number;
 refundsFinalized:number;
 exchangesFinalized:number;
 unresolved:number;
 discrepancies:string[];
};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cents(value:unknown):number{
 const amount=Number(value);
 const result=Math.round(amount*100);

 if(
  value===null||
  value===undefined||
  !Number.isFinite(amount)||
  !Number.isSafeInteger(result)||
  Math.abs(amount*100-result)>0.000001||
  result<0
 ){
  throw Error('Invalid financial amount');
 }

 return result;
}

function assertCurrent(ctx:Context){
 if(!ctx.isCurrent()){
  throw Error('Financial synchronization context changed');
 }
}

function assertIdentity(
 ctx:Context,
 key:string,
 payload:any,
 result:any
){
 if(
  !uuid.test(key)||
  payload.idempotencyKey!==key||
  payload.locationId!==ctx.locationId||
  payload.deviceId!==ctx.deviceId||
  !uuid.test(payload.shiftId||'')||
  result?.idempotencyKey!==key
 ){
  throw Error('Financial journal identity mismatch');
 }

 if(result.status==='NOT_FOUND'){
  if(result.found!==false){
   throw Error('Invalid missing transaction response');
  }
  return;
 }

 if(
  result.found!==true||
  result.locationId!==payload.locationId||
  result.deviceId!==payload.deviceId||
  result.shiftId!==payload.shiftId
 ){
  throw Error('Central financial identity mismatch');
 }
}

function assertResolution(result:any){
 if(
  !uuid.test(result.resolvedById||'')||
  !Number.isFinite(Date.parse(result.resolvedAt))||
  typeof result.resolutionReason!=='string'||
  result.resolutionReason.trim().length<10
 ){
  throw Error('Central resolution evidence is incomplete');
 }
}

function unauthorized(error:unknown){
 return /HTTP 401|Unauthorized/i.test(String(error));
}

export async function synchronizeFinancialJournal(
 ctx:Context
):Promise<Summary>{

 const summary:Summary={
  checked:0,
  refundsFinalized:0,
  exchangesFinalized:0,
  unresolved:0,
  discrepancies:[]
 };

 if(
  !uuid.test(ctx.locationId)||
  !uuid.test(ctx.deviceId)
 ){
  return summary;
 }

 assertCurrent(ctx);

 const refunds=await window.pos.listRefunds();

 for(const attempt of refunds){

  assertCurrent(ctx);

  try{

   const payload=JSON.parse(attempt.payload);

   if(
    payload.locationId!==ctx.locationId||
    payload.deviceId!==ctx.deviceId
   ){
    summary.unresolved++;
    summary.discrepancies.push(
     'Refund '+attempt.id+': terminal identity differs'
    );
    continue;
   }

   const result=await ctx.request(
    '/pos/returns/settlements/status/'+
    encodeURIComponent(attempt.id),
    'GET'
   );

   assertCurrent(ctx);

   assertIdentity(ctx,attempt.id,payload,result);

   summary.checked++;

   if(result.status==='NOT_FOUND'){
    summary.unresolved++;
    continue;
   }

   if(
    result.returnId!==payload.returnId||
    result.method!==payload.method||
    cents(result.amount)!==cents(payload.amount)
   ){
    throw Error('Refund financial identity mismatch');
   }

   if(result.status==='ACCEPTED'){

    if(
     result.integrityVerified!==true||
     result.centralAttemptVerified!==true||
     result.paymentState!=='CONFIRMED'
    ){
     throw Error('Refund acceptance is not verified');
    }

    assertCurrent(ctx);

    await finalizeLocalRefund(attempt.id,result);

    summary.refundsFinalized++;
    continue;
   }

   if(result.status==='RESOLVED_NO_PAYMENT'){

    assertResolution(result);

    if(result.paymentState!=='NOT_PAID'){
     throw Error('Invalid unpaid refund resolution');
    }

    const current=(await window.pos.listRefunds())
     .find(item=>item.id===attempt.id);

    if(!current)continue;

    if(current.status==='PAID'){
     throw Error(
      'Local PAID evidence conflicts with central unpaid resolution. '+
      'Independent financial correction required.'
     );
    }

    if(!['PREPARED','UNKNOWN'].includes(current.status)){
     throw Error('Unexpected local refund state');
    }

    assertCurrent(ctx);

    await window.pos.resolveRefund(attempt.id,result);

    summary.refundsFinalized++;
    continue;
   }

   // Never register, authorize, confirm or resume automatically.
   summary.unresolved++;

  }catch(error){

   if(unauthorized(error)||!ctx.isCurrent()){
    throw error;
   }

   summary.unresolved++;

   summary.discrepancies.push(
    'Refund '+attempt.id+': '+String(error)
   );
  }
 }

 const exchanges=await window.pos.listExchanges();

 for(const attempt of exchanges){

  assertCurrent(ctx);

  if(
   ['ACCEPTED','RESOLVED_NO_EXCHANGE']
    .includes(attempt.status)
  ){
   continue;
  }

  try{

   const payload=JSON.parse(attempt.payload);

   if(
    payload.locationId!==ctx.locationId||
    payload.deviceId!==ctx.deviceId
   ){
    summary.unresolved++;
    summary.discrepancies.push(
     'Exchange '+attempt.id+': terminal identity differs'
    );
    continue;
   }

   const result=await ctx.request(
    '/pos/exchanges/status/'+
    encodeURIComponent(attempt.id),
    'GET'
   );

   assertCurrent(ctx);

   assertIdentity(ctx,attempt.id,payload,result);

   summary.checked++;

   if(result.status==='NOT_FOUND'){
    summary.unresolved++;
    continue;
   }

   if(
    result.centralAttemptVerified!==true||
    result.originalSaleId!==payload.originalSaleId||
    result.paymentExecutionAuthorized!==false
   ){
    throw Error('Exchange financial identity mismatch');
   }

   if(result.status==='ACCEPTED'){

    if(
     result.integrityVerified!==true||
     result.reversalStatus!=='NONE'||
     !['CONFIRMED','NO_PAYMENT_REQUIRED']
      .includes(result.paymentState)
    ){
     throw Error('Exchange acceptance is not verified');
    }

    if(!Array.isArray(payload.additionalTenders)){
     throw Error('Original exchange tenders unavailable');
    }

    const additional=payload.additionalTenders.reduce(
     (total:number,tender:any)=>total+cents(tender.amount),
     0
    );

    if(
     !Number.isSafeInteger(additional)||
     cents(result.additionalPayment)!==additional||
     cents(result.returnValue)!==cents(payload.expectedReturnValue)||
     cents(result.replacementValue)!==cents(payload.expectedReplacementValue)
    ){
     throw Error('Exchange monetary values differ');
    }

    assertCurrent(ctx);

    await window.pos.updateExchange(
     attempt.id,'ACCEPTED',result
    );

    summary.exchangesFinalized++;
    continue;
   }

   if(result.status==='RESOLVED_NO_EXCHANGE'){

    assertResolution(result);

    if(
     !['REVERSED','NOT_COLLECTED','NO_PAYMENT_REQUIRED']
      .includes(result.paymentState)
    ){
     throw Error('Invalid exchange resolution');
    }

    if(
     result.paymentState==='REVERSED'&&
     (
      result.reversalStatus!=='CONFIRMED'||
      !result.reversalConfirmedById||
      !result.reversalConfirmedAt||
      !result.reversalEvidenceReference
     )
    ){
     throw Error('Exchange reversal evidence is incomplete');
    }

    if(
     result.paymentState!=='REVERSED'&&
     result.reversalStatus!=='NONE'
    ){
     throw Error('Unexpected exchange reversal state');
    }

    assertCurrent(ctx);

    await window.pos.resolveExchange(attempt.id,result);

    summary.exchangesFinalized++;
    continue;
   }

   // Pending investigations and financial holds remain untouched.
   summary.unresolved++;

  }catch(error){

   if(unauthorized(error)||!ctx.isCurrent()){
    throw error;
   }

   summary.unresolved++;

   summary.discrepancies.push(
    'Exchange '+attempt.id+': '+String(error)
   );
  }
 }

 return summary;
}