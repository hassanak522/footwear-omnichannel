// R10_3D24C_CENTRAL_REFUND_ORCHESTRATION

export type RefundRequest = (
 path:string,
 method?:string,
 body?:any
)=>Promise<any>;

export type RefundPayload = {
 returnId:string;
 method:'CASH'|'CARD'|'OTHER';
 amount:number;
 payoutShiftId?:string;
 reference?:string;
};

const base='/pos/returns/settlements';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertRefundIdentity(
 response:any,
 key:string
){
 if(
  !response||
  response.idempotencyKey!==key
 ){
  throw new Error(
   'Central refund identity mismatch'
  );
 }
}

export async function verifyAcceptedRefund(
 request:RefundRequest,
 key:string,
 locationId:string
){
 const result=await request(
  `${base}/status/${key}`
 );

 assertRefundIdentity(result,key);

 if(
  result.found!==true||
  result.status!=='ACCEPTED'||
  result.integrityVerified!==true||
  result.centralAttemptVerified!==true||
  result.locationId!==locationId
 ){
  throw new Error(
   'Central refund settlement is not verified'
  );
 }

 return result;
}

export async function finalizeLocalRefund(
 key:string,
 result:any
){
 const attempts=await window.pos.listRefunds();

 const attempt=attempts.find(a=>a.id===key);

 if(!attempt)return;

 // R10_3D24C_REFUND_FINALIZATION_IDENTITY

 const payload=JSON.parse(attempt.payload);

 const expectedAmount=Math.round(Number(payload.amount)*100);
 const verifiedAmount=Math.round(Number(result?.amount)*100);

 if(
  !result||
  result.found!==true||
  result.status!=='ACCEPTED'||
  result.integrityVerified!==true||
  result.centralAttemptVerified!==true||
  result.paymentState!=='CONFIRMED'||
  result.idempotencyKey!==key||
  payload.idempotencyKey!==key||
  result.locationId!==payload.locationId||
  result.returnId!==payload.returnId||
  result.deviceId!==payload.deviceId||
  result.shiftId!==payload.shiftId||
  result.method!==payload.method||
  !Number.isSafeInteger(expectedAmount)||
  !Number.isSafeInteger(verifiedAmount)||
  expectedAmount<=0||
  expectedAmount!==verifiedAmount
 ){
  throw new Error(
   'Verified settlement does not match the original local refund. '+
   'Journal preserved for reconciliation.'
  );
 }

 let state=attempt.status;

 if(state==='PREPARED'){
  await window.pos.updateRefund(
   key,'UNKNOWN'
  );
  state='UNKNOWN';
 }

 if(state==='UNKNOWN'){
  await window.pos.updateRefund(
   key,'PAID'
  );
  state='PAID';
 }

 if(state==='PAID'){
  await window.pos.updateRefund(
   key,'ACCEPTED',result
  );
 }
}

export async function executeCentralRefund(
 request:RefundRequest,
 locationId:string,
 input:RefundPayload,
 onPrepared?:(key:string)=>void
){

 const pending=await window.pos.listRefunds();

 if(pending.length){
  throw new Error(
   'An existing local refund requires reconciliation'
  );
 }

 const prepared=await window.pos.prepareRefund(
  locationId,input
 );

 const key=prepared.id;

 if(!uuid.test(key)){
  throw new Error(
   'Invalid prepared refund identity'
  );
 }

 onPrepared?.(key);

 const payload=prepared.payload as any;

 if(
  payload.idempotencyKey!==key||
  payload.locationId!==locationId||
  !uuid.test(payload.deviceId||'')||
  !uuid.test(payload.shiftId||'')
 ){
  throw new Error(
   'Prepared refund terminal identity mismatch'
  );
 }

 // Central registration does not authorize payment.
 const registration=await request(
  `${base}/register`,
  'POST',
  payload
 );

 assertRefundIdentity(registration,key);

 // R10_3D24C_REFUND_REGISTRATION_EXCLUSIVITY

 if(
  registration.duplicate!==false||
  registration.status!=='REGISTERED'||
  registration.paymentState!=='UNCONFIRMED'
 ){
  throw new Error(
   'Existing refund state requires recovery. Do not pay.'
  );
 }

 const ready=window.confirm(
  `Refund ${input.amount.toFixed(2)} by ${input.method}.\n\n`+
  'Confirm that no payment has yet been made and '+
  'you are ready to request exclusive payment authorization.'
 );

 if(!ready){
  throw new Error(
   'Refund reserved but not authorized. '+
   'HQ may cancel the unpaid reservation.'
  );
 }

 // Persist uncertainty before requesting authorization.
 await window.pos.updateRefund(
  key,'UNKNOWN'
 );

 const authorization=await request(
  `${base}/${key}/authorize-payment`,
  'POST'
 );

 assertRefundIdentity(authorization,key);

 if(
  authorization.status!=='PAYMENT_AUTHORIZED'||
  authorization.paymentState!=='UNKNOWN'||
  authorization.paymentAuthorized!==true||
  authorization.duplicate!==false
 ){
  throw new Error(
   'Exclusive payment authorization not verified. Do not pay.'
  );
 }

 const paid=window.confirm(
  `AUTHORIZED REFUND: ${input.amount.toFixed(2)}\n`+
  `Payment method: ${input.method}\n`+
  `Refund ID: ${key}\n\n`+
  'Complete the physical payout ONCE. '+
  'Select OK only after payment has actually been completed.\n\n'+
  'Select Cancel if payment was not completed or is uncertain.'
 );

 if(!paid){
  throw new Error(
   'Authorized refund requires payment reconciliation. '+
   'Do not repeat payment.'
  );
 }

 // Record the completed physical payment locally first.
 await window.pos.updateRefund(
  key,'PAID'
 );

 const confirmation=await request(
  `${base}/${key}/confirm-payment`,
  'POST'
 );

 assertRefundIdentity(confirmation,key);

 if(
  confirmation.status!=='PAID'||
  confirmation.paymentState!=='CONFIRMED'
 ){
  throw new Error(
   'Central payment confirmation requires recovery. '+
   'Do not pay again.'
  );
 }

 // The server resumes using its immutable registered payload.
 await request(
  `${base}/${key}/resume`,
  'POST'
 );

 const result=await verifyAcceptedRefund(
  request,key,locationId
 );

 await finalizeLocalRefund(
  key,result
 );

 return result;
}