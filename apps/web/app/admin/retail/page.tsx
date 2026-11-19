'use client';
import FinanceUnifiedNav from '../finance-unified-nav';
import {useEffect,useState} from 'react';
type Row=Record<string,any>;
const API='/api/v1';
const panel:React.CSSProperties={
 background:"#fff",
 border:"1px solid #dbe3ed",
 borderRadius:12,
 padding:20,
 marginBottom:20
};
const control:React.CSSProperties={
 padding:10,
 border:"1px solid #cbd5e1",
 borderRadius:8,
 background:"#fff",
 maxWidth:"100%"
};
const primary:React.CSSProperties={
 padding:"11px 17px",
 background:"#104c72",
 color:"#fff",
 border:0,
 borderRadius:8,
 cursor:"pointer"
};
const money=(value:unknown)=>{
 const n=Number(value);
 return Number.isFinite(n)
  ?"PKR "+n.toLocaleString("en-PK",{
    minimumFractionDigits:2,
    maximumFractionDigits:2
   })
  :String(value??"—");
};
const shortId=(value:unknown)=>{
 const text=String(value??"");
 return text.length>16?text.slice(0,12)+"…":text;
};
const summaryLabels:Record<string,string>={
 acceptedSales:"Accepted Sales",
 grossSales:"Gross Sales",
 approvedReturnValue:"Approved Returns",
 netAfterApprovedReturns:"Net After Returns",
 cashTender:"Cash Tender",
 cardTender:"Card Tender"
};
export default function RetailOperations(){
 const [token,setToken]=useState('');
 const [locations,setLocations]=useState<Row[]>([]),[location,setLocation]=useState('');
 const [sales,setSales]=useState<Row[]>([]),[returns,setReturns]=useState<Row[]>([]);
 const [summary,setSummary]=useState<Row|null>(null),[date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [saleId,setSaleId]=useState(''),[variantId,setVariantId]=useState(''),[quantity,setQuantity]=useState('1');
 const [reason,setReason]=useState(''),[quarantine,setQuarantine]=useState(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function req(path:string,method='GET',body?:unknown,t=token){
  const r=await fetch(API+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',},body:body?JSON.stringify(body):undefined});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(Array.isArray(data.message)?data.message.join(', '):data.message||'HTTP '+r.status);
  return data;
 }
 useEffect(()=>{let active=true;
  (async()=>{try{
   const r=await fetch('/api/admin-session/status',{credentials:'same-origin',cache:'no-store'});
   const session=await r.json();
   if(!session.sessionPresent){window.location.replace('/admin/finance-login?next='+encodeURIComponent(window.location.pathname));return;}
   const ls=await req('/retail-ops/locations','GET',undefined,'session');
   if(active){setToken('session');setLocations(ls);setLocation(ls[0]?.id||'');}
  }catch(e){if(active)setMessage('Unable to initialize session: '+String(e));}})();
  return ()=>{active=false};
 },[]);

 async function load(loc=location){if(!loc)return;setBusy(true);try{
  const q='?locationId='+encodeURIComponent(loc);
  const [s,r,d]=await Promise.all([req('/retail-ops/sales'+q),req('/retail-ops/returns'+q),req('/retail-ops/daily-summary'+q+'&date='+date)]);
  setSales(s);setReturns(r);setSummary(d);setMessage('Refreshed');
 }catch(e){setMessage(String(e))}finally{setBusy(false)}}
 const selected=sales.find(s=>s.id===saleId);
 const eligible=(selected?.lines||[]).filter((l:Row)=>l.quantity>l.returnedQty);
 async function processReturn(){
  const line=eligible.find((l:Row)=>l.variantId===variantId);
  const count=Number(quantity);
  const remaining=line
   ?Number(line.quantity)-Number(line.returnedQty)
   :0;

  if(
   !selected||
   selected.status!=="ACCEPTED"||
   !line||
   reason.trim().length<3||
   !Number.isInteger(count)||
   count<1||
   count>remaining
  ){
   setMessage("Select an eligible sale and SKU, enter a valid quantity and provide a return reason.");
   return;
  }
  if(!confirm(
  "Approve merchandise return for "+
  count+" unit(s)?\n\n"+
  "Stock will increase immediately unless the backend applies quarantine handling.\n"+
  "This action does NOT issue a payment refund."
 ))return;
  setBusy(true);try{
   const key=crypto.randomUUID();
   await req('/pos/returns','POST',{saleId,reason,idempotencyKey:key,lines:[{variantId,quantity:Number(quantity),quarantined:quarantine}]});
   setMessage('Return recorded. Process the monetary refund separately and retain proof.');
   await load();
  }catch(e){setMessage(String(e))}finally{setBusy(false)}
 }
 return (
  <main style={{
   maxWidth:1200,
   margin:"0 auto",
   padding:"28px 20px 48px",
   fontFamily:"system-ui",
   color:"#172b4d"
  }}>
   <FinanceUnifiedNav />

   <header style={{marginBottom:24}}>
    <div style={{
     color:"#ef3321",
     fontSize:12,
     fontWeight:700,
     letterSpacing:1
    }}>
     ROYAL STEP / RETAIL
    </div>

    <h1 style={{color:"#104c72",margin:"8px 0"}}>
     Retail Operations
    </h1>

    <p style={{color:"#64748b"}}>
     Review sales, approve merchandise returns
     and monitor daily branch reconciliation.
    </p>
   </header>

   {!token?(
    <section style={panel}>
     <p role="status">
      Loading your HQ session.
      If this persists, return to{" "}
      <a href="/admin/finance-login">
       Finance Sign In
      </a>.
     </p>
    </section>
   ):(
    <>
     <section style={panel}>
      <h2 style={{color:"#104c72"}}>
       Branch and Reporting Date
      </h2>

      <div style={{
       display:"flex",
       flexWrap:"wrap",
       alignItems:"end",
       gap:14
      }}>
       <label style={{display:"grid",gap:6}}>
        <strong>Branch</strong>
        <select
         style={control}
         value={location}
         onChange={e=>{
          setLocation(e.target.value);
          setSales([]);
          setReturns([]);
          setSummary(null);
          setSaleId("");
          setVariantId("");
         }}
        >
         {locations.map(l=>(
          <option key={l.id} value={l.id}>
           {l.name} ({l.code})
          </option>
         ))}
        </select>
       </label>

       <label style={{display:"grid",gap:6}}>
        <strong>Reporting Date (UTC)</strong>
        <input
         style={control}
         type="date"
         value={date}
         onChange={e=>setDate(e.target.value)}
        />
       </label>

       <button
        style={primary}
        disabled={busy||!location}
        onClick={()=>void load()}
       >
        {busy?"Loading…":"Load Branch Records"}
       </button>
      </div>
     </section>

     {summary&&(
      <section style={panel}>
       <h2 style={{color:"#104c72"}}>
        Daily Reconciliation
       </h2>

       <p style={{color:"#64748b"}}>
        Financial summary for the selected
        branch and UTC reporting date.
       </p>

       <div style={{
        display:"grid",
        gridTemplateColumns:
         "repeat(auto-fit,minmax(160px,1fr))",
        gap:12
       }}>
        {[
         "acceptedSales",
         "grossSales",
         "approvedReturnValue",
         "netAfterApprovedReturns",
         "cashTender",
         "cardTender"
        ].map(key=>(
         <div key={key} style={{
          padding:16,
          border:"1px solid #e2e8f0",
          background:"#f8fafc",
          borderRadius:9
         }}>
          <div style={{
           color:"#64748b",
           fontSize:12,
           marginBottom:8
          }}>
           {summaryLabels[key]}
          </div>

          <strong style={{
           color:"#104c72",
           fontSize:18
          }}>
           {key==="acceptedSales"
            ?String(summary[key]??0)
            :money(summary[key])}
          </strong>
         </div>
        ))}
       </div>

       {summary.note&&(
        <p style={{
         color:"#92400e",
         marginTop:16
        }}>
         {summary.note}
        </p>
       )}
      </section>
     )}

     <section style={panel}>
      <h2 style={{color:"#104c72"}}>
       Recent Sales
      </h2>

      <p style={{color:"#64748b"}}>
       Latest 100 sales returned by the
       selected branch's sales API.
      </p>

      <div style={{overflowX:"auto"}}>
       <table style={{
        width:"100%",
        borderCollapse:"collapse",
        textAlign:"left"
       }}>
        <thead>
         <tr>
          {[
           "Sale",
           "Date",
           "Status",
           "Total",
           "Remaining Units"
          ].map(label=>(
           <th key={label} style={{
            padding:12,
            borderBottom:"1px solid #cbd5e1"
           }}>
            {label}
           </th>
          ))}
         </tr>
        </thead>

        <tbody>
         {sales.map(s=>(
          <tr key={s.id}>
           <td style={{padding:12}}>
            {s.localSaleId||shortId(s.id)}
           </td>

           <td style={{padding:12}}>
            {new Date(s.soldAt).toLocaleString()}
           </td>

           <td style={{padding:12}}>
            {s.status}
           </td>

           <td style={{padding:12}}>
            {money(s.total)}
           </td>

           <td style={{padding:12}}>
            {(s.lines||[]).reduce(
             (total:number,line:Row)=>
              total+Math.max(
               0,
               Number(line.quantity)-
               Number(line.returnedQty)
              ),
             0
            )}
           </td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>

      {sales.length===0&&(
       <p style={{color:"#64748b"}}>
        No sales loaded for this branch.
       </p>
      )}
     </section>

     <section style={panel}>
      <h2 style={{color:"#104c72"}}>
       Approve Merchandise Return
      </h2>

      <p style={{
       background:"#fffbeb",
       color:"#92400e",
       padding:12,
       borderRadius:8
      }}>
       Manager authorization is required.
       An approved return changes inventory.
       It does not automatically refund the customer.
      </p>

      <div style={{
       display:"grid",
       gridTemplateColumns:
        "repeat(auto-fit,minmax(240px,1fr))",
       gap:16,
       marginBottom:16
      }}>
       <label style={{display:"grid",gap:6}}>
        <strong>Accepted Sale</strong>
        <select
         style={control}
         value={saleId}
         onChange={e=>{
          setSaleId(e.target.value);
          setVariantId("");
         }}
        >
         <option value="">
          Select an accepted sale
         </option>

         {sales.filter(s=>
          s.status==="ACCEPTED"&&
          (s.lines||[]).some(
           (l:Row)=>l.quantity>l.returnedQty
          )
         ).map(s=>(
          <option key={s.id} value={s.id}>
           {s.localSaleId||shortId(s.id)}
           {" — "}
           {money(s.total)}
          </option>
         ))}
        </select>
       </label>

       <label style={{display:"grid",gap:6}}>
        <strong>Product / SKU</strong>
        <select
         style={control}
         value={variantId}
         onChange={e=>setVariantId(e.target.value)}
        >
         <option value="">Select SKU</option>

         {eligible.map((l:Row)=>(
          <option
           key={l.variantId}
           value={l.variantId}
          >
           {shortId(l.variantId)}
           {" — "}
           {l.quantity-l.returnedQty}
           {" available to return"}
          </option>
         ))}
        </select>
       </label>

       <label style={{display:"grid",gap:6}}>
        <strong>Return Quantity</strong>
        <input
         style={control}
         type="number"
         min="1"
         max={
          eligible.find(
           (l:Row)=>l.variantId===variantId
          )?.quantity-
          eligible.find(
           (l:Row)=>l.variantId===variantId
          )?.returnedQty||1
         }
         value={quantity}
         onChange={e=>setQuantity(e.target.value)}
        />
       </label>

       <label style={{display:"grid",gap:6}}>
        <strong>Return Reason</strong>
        <input
         style={control}
         maxLength={500}
         placeholder="Minimum 3 characters"
         value={reason}
         onChange={e=>setReason(e.target.value)}
        />
       </label>
      </div>

      <label style={{
       display:"flex",
       alignItems:"center",
       gap:9,
       marginBottom:18
      }}>
       <input
        type="checkbox"
        checked={quarantine}
        onChange={e=>setQuarantine(e.target.checked)}
       />
       Mark returned units as damaged / quarantine
      </label>

      <button
       style={{
        ...primary,
        background:"#ef3321",
        opacity:busy?0.6:1
       }}
       disabled={
        busy||
        !selected||
        selected.status!=="ACCEPTED"||
        !variantId||
        reason.trim().length<3||
        !Number.isInteger(Number(quantity))||
        Number(quantity)<1||
        Number(quantity)>(
         eligible.find(
          (l:Row)=>l.variantId===variantId
         )?.quantity-
         eligible.find(
          (l:Row)=>l.variantId===variantId
         )?.returnedQty||0
        )
       }
       onClick={()=>void processReturn()}
      >
       Approve Return and Update Stock
      </button>
     </section>

     <section style={panel}>
      <h2 style={{color:"#104c72"}}>
       Recent Approved Returns
      </h2>

      <div style={{overflowX:"auto"}}>
       <table style={{
        width:"100%",
        borderCollapse:"collapse",
        textAlign:"left"
       }}>
        <thead>
         <tr>
          {[
           "Return",
           "Original Sale",
           "Date",
           "Reason",
           "Value"
          ].map(label=>(
           <th key={label} style={{
            padding:12,
            borderBottom:"1px solid #cbd5e1"
           }}>
            {label}
           </th>
          ))}
         </tr>
        </thead>

        <tbody>
         {returns.map(r=>(
          <tr key={r.id}>
           <td style={{padding:12}}>
            <span title={r.id}>
             {shortId(r.id)}
            </span>
           </td>

           <td style={{padding:12}}>
            <span title={r.saleId}>
             {shortId(r.saleId)}
            </span>
           </td>

           <td style={{padding:12}}>
            {new Date(r.createdAt).toLocaleString()}
           </td>

           <td style={{padding:12}}>
            {r.reason}
           </td>

           <td style={{padding:12}}>
            {money(r.amount)}
           </td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>

      {returns.length===0&&(
       <p style={{color:"#64748b"}}>
        No approved returns loaded.
       </p>
      )}
     </section>
    </>
   )}

   {message&&(
    <p
     role="status"
     style={{
      padding:14,
      border:"1px solid #dbe3ed",
      borderRadius:8,
      background:"#f8fafc",
      overflowWrap:"anywhere"
     }}
    >
     {message}
    </p>
   )}
  </main>
 );
}