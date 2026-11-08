'use client';
import {useState} from 'react';
type Row=Record<string,any>;
const API=process.env.NEXT_PUBLIC_API_URL||'http://localhost:3001/api/v1';
export default function RetailOperations(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[token,setToken]=useState('');
 const [locations,setLocations]=useState<Row[]>([]),[location,setLocation]=useState('');
 const [sales,setSales]=useState<Row[]>([]),[returns,setReturns]=useState<Row[]>([]);
 const [summary,setSummary]=useState<Row|null>(null),[date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [saleId,setSaleId]=useState(''),[variantId,setVariantId]=useState(''),[quantity,setQuantity]=useState('1');
 const [reason,setReason]=useState(''),[quarantine,setQuarantine]=useState(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function req(path:string,method='GET',body?:unknown,t=token){
  const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(Array.isArray(data.message)?data.message.join(', '):data.message||'HTTP '+r.status);
  return data;
 }
 async function login(e:React.FormEvent){e.preventDefault();setBusy(true);try{
  const d=await req('/auth/login','POST',{email,password},'');
  const t=d.accessToken||d.access_token||d.token;
  if(!t)throw new Error('Login response did not include a token');
  setToken(t);
  const l=await req('/retail-ops/locations','GET',undefined,t);
  setLocations(l);setLocation(l[0]?.id||'');setMessage('Signed in');
 }catch(e){setMessage(String(e))}finally{setBusy(false)}}
 async function load(loc=location){if(!loc)return;setBusy(true);try{
  const q='?locationId='+encodeURIComponent(loc);
  const [s,r,d]=await Promise.all([req('/retail-ops/sales'+q),req('/retail-ops/returns'+q),req('/retail-ops/daily-summary'+q+'&date='+date)]);
  setSales(s);setReturns(r);setSummary(d);setMessage('Refreshed');
 }catch(e){setMessage(String(e))}finally{setBusy(false)}}
 const selected=sales.find(s=>s.id===saleId);
 const eligible=(selected?.lines||[]).filter((l:Row)=>l.quantity>l.returnedQty);
 async function processReturn(){if(!selected||!variantId||!reason.trim()||Number(quantity)<1)return;
  if(!confirm('Approve this merchandise return? Stock will increase immediately. This does NOT issue a payment refund.'))return;
  setBusy(true);try{
   const key=crypto.randomUUID();
   await req('/pos/returns','POST',{saleId,reason,idempotencyKey:key,lines:[{variantId,quantity:Number(quantity),quarantined:quarantine}]});
   setMessage('Return recorded. Process the monetary refund separately and retain proof.');
   await load();
  }catch(e){setMessage(String(e))}finally{setBusy(false)}
 }
 return <main style={{maxWidth:1150,margin:'30px auto',padding:20,fontFamily:'system-ui'}}>
  <h1>Royal Step — Retail Operations</h1><p>Milestones 22–24: sales history, manager-approved merchandise returns, and daily reconciliation.</p>
  {!token?<form onSubmit={login} style={{display:'grid',gap:10,maxWidth:360}}>
   <input required type="email" placeholder="Staff email" value={email} onChange={e=>setEmail(e.target.value)}/>
   <input required type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}/>
   <button disabled={busy}>Sign in</button></form>:<>
   <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:20}}>
    <select value={location} onChange={e=>{setLocation(e.target.value);setSales([]);setReturns([]);setSummary(null)}}>
     {locations.map(l=><option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}</select>
    <input type="date" value={date} onChange={e=>setDate(e.target.value)}/>
    <button disabled={busy||!location} onClick={()=>load()}>Load records</button>
   </div>
   {summary&&<section><h2>Daily reconciliation (UTC)</h2>
    <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
     {['acceptedSales','grossSales','approvedReturnValue','netAfterApprovedReturns','cashTender','cardTender'].map(k=><div key={k} style={{padding:12,border:'1px solid #ddd'}}><b>{k}</b><div>{summary[k]}</div></div>)}
    </div><p>{summary.note}</p></section>}
   <section><h2>Recent sales (latest 100)</h2><div style={{overflowX:'auto'}}>
    <table cellPadding={8} border={1}><thead><tr><th>Sale ID</th><th>Date</th><th>Status</th><th>Total</th><th>Lines / remaining</th></tr></thead>
     <tbody>{sales.map(s=><tr key={s.id}><td>{s.id}</td><td>{new Date(s.soldAt).toLocaleString()}</td><td>{s.status}</td><td>{s.total}</td><td>{s.lines.map((l:Row)=>`${l.variantId.slice(0,8)}: ${l.quantity-l.returnedQty}/${l.quantity}`).join('; ')}</td></tr>)}</tbody></table>
   </div></section>
   <section style={{marginTop:24,padding:16,border:'1px solid #ccc'}}>
    <h2>Approve merchandise return</h2><p>Manager only. Original sale must be accepted. A return restores stock but does not execute a refund or exchange.</p>
    <div style={{display:'grid',gap:10,maxWidth:600}}>
     <select value={saleId} onChange={e=>{setSaleId(e.target.value);setVariantId('')}}><option value="">Select accepted sale</option>
      {sales.filter(s=>s.status==='ACCEPTED'&&s.lines.some((l:Row)=>l.quantity>l.returnedQty)).map(s=><option key={s.id} value={s.id}>{s.localSaleId} — {s.total}</option>)}</select>
     <select value={variantId} onChange={e=>setVariantId(e.target.value)}><option value="">Select SKU</option>
      {eligible.map((l:Row)=><option key={l.variantId} value={l.variantId}>{l.variantId} (max {l.quantity-l.returnedQty})</option>)}</select>
     <input type="number" min="1" max={eligible.find((l:Row)=>l.variantId===variantId)?.quantity-eligible.find((l:Row)=>l.variantId===variantId)?.returnedQty||1} value={quantity} onChange={e=>setQuantity(e.target.value)}/>
     <input placeholder="Return reason (3+ characters)" value={reason} onChange={e=>setReason(e.target.value)}/>
     <label><input type="checkbox" checked={quarantine} onChange={e=>setQuarantine(e.target.checked)}/> Damaged / quarantine returned units</label>
     <button disabled={busy||!variantId||reason.trim().length<3||!Number.isInteger(Number(quantity))||Number(quantity)<1||Number(quantity)>(eligible.find((l:Row)=>l.variantId===variantId)?.quantity-eligible.find((l:Row)=>l.variantId===variantId)?.returnedQty||0)} onClick={processReturn}>Approve return and update stock</button>
    </div>
   </section>
   <section><h2>Recent approved returns</h2><div style={{overflowX:'auto'}}><table border={1} cellPadding={8}><thead><tr><th>ID</th><th>Original sale</th><th>Date</th><th>Reason</th><th>Value</th></tr></thead>
    <tbody>{returns.map(r=><tr key={r.id}><td>{r.id}</td><td>{r.saleId}</td><td>{new Date(r.createdAt).toLocaleString()}</td><td>{r.reason}</td><td>{r.amount}</td></tr>)}</tbody></table></div></section>
  </>}
  <p role="status">{message}</p>
 </main>;
}
