import {useEffect,useRef,useState} from 'react';

type RequestFn=(
 path:string,
 method?:string,
 body?:unknown
)=>Promise<any>;

type Merchandise={
 id:string;
 barcode:string;
 sku:string;
 title:string;
 size:string;
 color:string;
 price:number;
};

type ReturnLine={
 variantId:string;
 quantity:number;
 quarantined:boolean;
};

type ReplacementLine={
 variantId:string;
 quantity:number;
};

type Quote={
 status:string;
 returnValue:string;
 replacementValue:string;
 exchangeCredit:string;
 additionalPayment:string;
 residualRefund:string;
 quotedAt:string;
 replacementLines:{
  variantId:string;
  quantity:number;
  unitPrice:string;
 }[];
};

type Props={
 request:RequestFn;
 location:string;
 deviceId:string;
 shiftId:string;
 token:string;
 originalSaleId:string;
 returnLines:ReturnLine[];
 reason:string;
 onCompleted:()=>void;
};

const currency=(value:string|number)=>
 'PKR '+Number(value).toFixed(2);

export default function ExchangePanel(props:Props){

 const {
  request,location,deviceId,shiftId,token,
  originalSaleId,returnLines,reason,onCompleted
 }=props;

 const [catalog,setCatalog]=useState<Merchandise[]>([]);
 const [search,setSearch]=useState('');
 const [replacements,setReplacements]=
  useState<ReplacementLine[]>([]);

 const [quote,setQuote]=useState<Quote|null>(null);
 const [quotedDraft,setQuotedDraft]=useState('');
 const [method,setMethod]=
  useState<'CASH'|'CARD'|'OTHER'>('CASH');

 const [reference,setReference]=useState('');
 const [cashReceived,setCashReceived]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');

 const active=useRef(false);

 const draft={
  originalSaleId,
  locationId:location,
  deviceId,
  shiftId,
  reason:reason.trim(),
  returnLines:returnLines.filter(line=>line.quantity>0),
  replacementLines:replacements
 };

 const signature=JSON.stringify(draft);

 const validQuote=
  quote&&quotedDraft===signature?quote:null;

 const ready=Boolean(
  token&&location&&deviceId&&shiftId&&originalSaleId&&
  draft.returnLines.length&&
  replacements.length&&
  reason.trim().length>=3&&
  reason.trim().length<=500
 );

 useEffect(()=>{
  let cancelled=false;

  void window.pos.listCatalog().then(items=>{
   if(!cancelled)setCatalog(items);
  }).catch(()=>{
   if(!cancelled)setMessage('Unable to load catalog');
  });

  return ()=>{cancelled=true;};
 },[location]);

 const matches=search.trim()
  ?catalog.filter(item=>
    [
     item.barcode,item.sku,item.title,
     item.size,item.color
    ].join(' ').toLowerCase().includes(
     search.trim().toLowerCase()
    )
   ).slice(0,20)
  :[];

 function addItem(item:Merchandise){
  if(active.current)return;

  setReplacements(current=>{
   const existing=current.find(
    line=>line.variantId===item.id
   );

   return existing
    ?current.map(line=>
      line.variantId===item.id
       ?{...line,quantity:Math.min(1000,line.quantity+1)}
       :line
     )
    :[...current,{variantId:item.id,quantity:1}];
  });

  setQuote(null);
  setSearch('');
 }

 function setQuantity(id:string,quantity:number){
  if(active.current)return;
  if(!Number.isSafeInteger(quantity)||quantity<0||quantity>1000)return;

  setReplacements(current=>
   quantity===0
    ?current.filter(line=>line.variantId!==id)
    :current.map(line=>
      line.variantId===id?{...line,quantity}:line
     )
  );

  setQuote(null);
 }

 async function requestQuote(){
  if(!ready||active.current)return;

  active.current=true;
  setBusy(true);
  setQuote(null);
  setMessage('');

  try{
   const response=await request(
    '/pos/exchanges/quote',
    'POST',
    {
     ...draft,
     idempotencyKey:crypto.randomUUID(),
     expectedReturnValue:0,
     expectedReplacementValue:0,
     additionalTenders:[]
    }
   );

   if(
    response?.status!=='QUOTED'||
    !Array.isArray(response.replacementLines)
   ){
    throw new Error('Invalid exchange quotation');
   }

   for(const field of [
    'returnValue',
    'replacementValue',
    'exchangeCredit',
    'additionalPayment',
    'residualRefund'
   ]){
    const value=Number(response[field]);

    if(!Number.isFinite(value)||value<0){
     throw new Error('Invalid quoted monetary value');
    }
   }

   setQuote(response);
   setQuotedDraft(signature);
   setCashReceived('');
   setReference('');

   setMessage(
    'Server quotation received. Stock and prices are '+
    'subject to revalidation at checkout.'
   );

  }catch(error){
   setMessage(
    error instanceof Error?error.message:'Quotation failed'
   );
  }finally{
   active.current=false;
   setBusy(false);
  }
 }

 const additional=Number(validQuote?.additionalPayment||0);

 const change=Math.max(
  0,Math.round((Number(cashReceived||0)-additional)*100)/100
 );

 // R10_3D23B_DURABLE_SUBMISSION
 async function completeExchange(){

  if(active.current||!validQuote||!ready)return;

  if(import.meta.env.VITE_ENABLE_EXCHANGE_CHECKOUT!=='true'){
   setMessage('Exchange checkout is disabled in this build.');
   return;
  }

  const quoteAge=Date.now()-Date.parse(validQuote.quotedAt);

  if(!Number.isFinite(quoteAge)||quoteAge>120000||quoteAge<0){
   setQuote(null);
   setMessage('Quotation expired. Calculate exchange again.');
   return;
  }

  const amountCents=Math.round(additional*100);

  if(!Number.isSafeInteger(amountCents)||amountCents<0){
   setMessage('Invalid additional payment.');
   return;
  }

  if(amountCents>0&&method==='CASH'){
   const received=Number(cashReceived);
   const receivedCents=Math.round(received*100);

   if(
    !Number.isSafeInteger(receivedCents)||
    receivedCents<amountCents||
    Math.abs(received*100-receivedCents)>0.000001
   ){
    setMessage('Enter valid cash tendered.');
    return;
   }
  }

  if(
   amountCents>0&&method!=='CASH'&&
   (!reference.trim()||reference.trim().length>100)
  ){
   setMessage('Enter external payment reference.');
   return;
  }

  if(!window.confirm(
   'Prepare this exchange for processing? '+
   'Do not collect additional payment until the transaction '+
   'has received exclusive central collection authorization.'
  ))return;

  active.current=true;
  setBusy(true);

  let attemptId:string|undefined;

  try{

   const attempts=await window.pos.listExchanges();

   if(attempts.some(a=>!['ACCEPTED','RESOLVED_NO_EXCHANGE'].includes(a.status))){
    throw Error('Existing exchange requires reconciliation');
   }

   const payload={
    ...draft,
    expectedReturnValue:Number(validQuote.returnValue),
    expectedReplacementValue:Number(validQuote.replacementValue),
    additionalTenders:amountCents>0?[
     {
      type:method,
      amount:amountCents/100,
      ...(method!=='CASH'?{reference:reference.trim()}:{})
     }
    ]:[]
   };

   const attempt=await window.pos.prepareExchange(payload);

   attemptId=attempt.id;
   // R10_3D23B_DESKTOP_CENTRAL_REGISTRATION
   const registration=await request(
    '/pos/exchanges/register',
    'POST',
    attempt.payload
   );

   if(
    !registration||
    registration.id!==attempt.id||
    registration.duplicate!==false||
    registration.status!=='REGISTERED'||
    registration.paymentState!==(
     amountCents>0?'UNCONFIRMED':'NO_PAYMENT_REQUIRED'
    )
   ){
    throw Error(
     'Central registration not confirmed. Do not collect payment.'
    );
   }


   // Persist uncertainty before any physical payment action.
   await window.pos.updateExchange(
    attempt.id,
    'UNKNOWN',
    undefined,
    'Awaiting payment confirmation and central acceptance'
   );

   // R10_3D24C_DESKTOP_COLLECTION_GATE
   if(amountCents>0){

    if(!window.confirm(
     'Request exclusive permission to collect '+
     currency(additional)+'? No payment should have been collected yet.'
    )){
     setMessage(
      'Exchange retained without payment collection authorization.'
     );
     return;
    }

    const authorization=await request(
     '/pos/exchanges/'+encodeURIComponent(attempt.id)+
     '/authorize-payment',
     'POST'
    );

    if(
     !authorization||
     authorization.id!==attempt.id||
     authorization.status!=='REGISTERED'||
     authorization.paymentState!=='UNCONFIRMED'||
     authorization.paymentAuthorized!==true||
     authorization.duplicate!==false
    ){
     throw Error(
      'Exclusive payment authorization not verified. '+
      'Do not collect payment.'
     );
    }

    window.alert(
     'ONE-TIME COLLECTION AUTHORIZED\n\n'+
     'Collect '+currency(additional)+' using '+method+
     ' exactly once.\n\n'+
     'If payment fails or its outcome is uncertain, stop and '+
     'request manager reconciliation. Do not collect again.'
    );
   }

   const instruction=amountCents>0
    ?'Confirm additional payment of '+currency(additional)+
     ' has been received exactly once.'
    :'Confirm this exchange requires no additional payment.';

   if(!window.confirm(
    instruction+
    '\n\nResidual refunds must be recorded separately.'+
    '\n\nContinue with central exchange submission?'
   )){
    setMessage(
     'Exchange retained for manager reconciliation. '+
     'Do not start another exchange for this transaction.'
    );
    return;
   }

   // R10_3D23B_DESKTOP_PAYMENT_CONFIRMATION
   const confirmation=await request(
    '/pos/exchanges/'+encodeURIComponent(attempt.id)+
    '/confirm-payment',
    'POST'
   );

   if(
    !confirmation||
    confirmation.id!==attempt.id||
    confirmation.paymentState!==(
     amountCents>0?'CONFIRMED':'NO_PAYMENT_REQUIRED'
    )||
    !['REGISTERED','UNKNOWN'].includes(confirmation.status)
   ){
    throw Error(
     'Central payment confirmation requires reconciliation'
    );
   }

await request(
    '/pos/exchanges',
    'POST',
    attempt.payload
   );

   const central=await request(
    '/pos/exchanges/status/'+encodeURIComponent(attempt.id)
   );

   await window.pos.updateExchange(
    attempt.id,'ACCEPTED',central
   );

   setQuote(null);
   setReplacements([]);
   setCashReceived('');
   setReference('');

   setMessage(
    'Exchange accepted. Receipt available in exchange history.'
   );

   onCompleted();

  }catch(error){

   if(attemptId){
    try{
     await window.pos.updateExchange(
      attemptId,'UNKNOWN',undefined,String(error)
     );
    }catch{
     // Preserve the existing durable record.
    }

    setMessage(
     'Exchange outcome uncertain: '+String(error)+
     '. Do not collect payment again. Use exchange recovery.'
    );
   }else{
    setMessage(
     'Exchange preparation failed: '+String(error)
    );
   }

  }finally{
   active.current=false;
   setBusy(false);
  }
 }

 return (
  <section className="panel">
   <h3>Merchandise exchange</h3>

   <p className="hint">
    Online manager-authorized exchange.
    Select returned items above, then add replacement merchandise.
   </p>

   <p>
    Return units: {draft.returnLines.reduce(
     (sum,line)=>sum+line.quantity,0
    )}
   </p>

   <label>
    Search replacement merchandise
    <input
     value={search}
     disabled={busy}
     onChange={e=>setSearch(e.target.value)}
     placeholder="Scan barcode or search SKU, title, size"
     onKeyDown={e=>{
      if(e.key!=='Enter')return;
      e.preventDefault();

      const exact=catalog.filter(item=>
       item.barcode.toLowerCase()===search.trim().toLowerCase()||
       item.sku.toLowerCase()===search.trim().toLowerCase()
      );

      if(exact.length===1)addItem(exact[0]);
      else if(matches.length===1)addItem(matches[0]);
     }}
    />
   </label>

   {matches.map(item=>(
    <button
     type="button"
     className="secondary"
     key={item.id}
     disabled={busy}
     onClick={()=>addItem(item)}
    >
     {item.title} | {item.sku} | {item.size} |
     {' '+item.color}
    </button>
   ))}

   <div className="tablewrap">
    <table>
     <thead>
      <tr>
       <th>Replacement item</th>
       <th>Quantity</th>
       <th>Quoted price</th>
       <th>Action</th>
      </tr>
     </thead>

     <tbody>
      {replacements.map(line=>{
       const item=catalog.find(
        value=>value.id===line.variantId
       );

       const price=validQuote?.replacementLines.find(
        value=>value.variantId===line.variantId
       )?.unitPrice;

       return (
        <tr key={line.variantId}>
         <td>
          {item
           ?`${item.title} | ${item.sku} | ${item.size} | ${item.color}`
           :line.variantId}
         </td>
         <td>
          <input
           type="number"
           min={1}
           max={1000}
           value={line.quantity}
           disabled={busy}
           onChange={e=>setQuantity(
            line.variantId,Number(e.target.value)
           )}
          />
         </td>
         <td>{price?currency(price):'Awaiting quote'}</td>
         <td>
          <button
           className="secondary"
           disabled={busy}
           onClick={()=>setQuantity(line.variantId,0)}
          >
           Remove
          </button>
         </td>
        </tr>
       );
      })}
     </tbody>
    </table>
   </div>

   <button
    disabled={!ready||busy}
    onClick={()=>void requestQuote()}
   >
    {busy?'Calculating...':'Calculate exchange'}
   </button>

   {validQuote&&(
    <div className="panel">
     <h3>Exchange quotation</h3>

     <p>Return value: {currency(validQuote.returnValue)}</p>
     <p>Replacement value: {currency(validQuote.replacementValue)}</p>
     <p>Exchange credit: {currency(validQuote.exchangeCredit)}</p>

     <h3>Additional payment: {currency(additional)}</h3>

     <p>
      Residual refund:
      {' '+currency(validQuote.residualRefund)}
     </p>

     {additional>0&&(
      <>
       <label>
        Additional payment method
        <select
         value={method}
         disabled={busy}
         onChange={e=>{
          setMethod(e.target.value as 'CASH'|'CARD'|'OTHER');
          setReference('');
          setCashReceived('');
         }}
        >
         <option value="CASH">Cash</option>
         <option value="CARD">Card</option>
         <option value="OTHER">Other</option>
        </select>
       </label>

       {method==='CASH'?(
        <>
         <label>
          Cash tendered
          <input
           type="number"
           min={additional}
           step="0.01"
           value={cashReceived}
           onChange={e=>setCashReceived(e.target.value)}
          />
         </label>

         <p>Change: {currency(change)}</p>
        </>
       ):(
        <label>
         External payment reference
         <input
          value={reference}
          maxLength={100}
          onChange={e=>setReference(e.target.value)}
         />
        </label>
       )}
      </>
     )}

     <p className="hint">
      Do not collect payment until the exchange has been
      saved locally and registered centrally. Residual refunds are recorded separately.
     </p>

     <button
      disabled={
       busy||
       import.meta.env.VITE_ENABLE_EXCHANGE_CHECKOUT!=='true'
      }
      onClick={()=>void completeExchange()}
     >
      {busy?'Processing exchange...':'Complete exchange'}
     </button>
    </div>
   )}

   {message&&<p role="status">{message}</p>}
  </section>
 );
}