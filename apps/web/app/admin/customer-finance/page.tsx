'use client';
import {useState} from 'react';
const BASE=process.env.NEXT_PUBLIC_API_URL||'http://localhost:3001/api/v1';
export default function CustomerFinance(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[token,setToken]=useState('');
 const [customerId,setCustomerId]=useState(''),[saleId,setSaleId]=useState('');
 const [returnId,setReturnId]=useState(''),[method,setMethod]=useState('CASH');
 const [refundId,setRefundId]=useState(''),[reference,setReference]=useState('');
 const [code,setCode]=useState(''),[title,setTitle]=useState(''),[type,setType]=useState('PERCENT'),[value,setValue]=useState('10');
 const [start,setStart]=useState(''),[end,setEnd]=useState('');
 const [result,setResult]=useState(''),[busy,setBusy]=useState(false);
 async function call(path:string,method='GET',body?:unknown,t=token){
  const r=await fetch(BASE+path,{method,headers:{'Content-Type':'application/json',...(t?{Authorization:'Bearer '+t}:{})},body:body?JSON.stringify(body):undefined});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(Array.isArray(j.message)?j.message.join(', '):j.message||'HTTP '+r.status);
  return j;
 }
 async function run(f:()=>Promise<unknown>){setBusy(true);try{setResult(JSON.stringify(await f(),null,2))}catch(e){setResult(String(e))}finally{setBusy(false)}}
 const field=(label:string,el:React.ReactNode)=><label style={{display:'grid',gap:4}}>{label}{el}</label>;
 const btn=(label:string,action:()=>Promise<unknown>)=><button disabled={busy} onClick={()=>run(action)}>{label}</button>;
 return <main style={{maxWidth:960,margin:'24px auto',padding:20,fontFamily:'system-ui'}}>
  <h1>Royal Step — Customer & Finance</h1>
  <p>Milestones 25–27: customer sale linking, manual refund register, draft promotions. Refunds are not automatically paid; promotions are not applied to checkout.</p>
  {!token?<section style={{display:'grid',gap:8,maxWidth:380}}>
   {field('Email',<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/>)}
   {field('Password',<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/>)}
   {btn('Sign in',async()=>{const r=await call('/auth/login','POST',{email,password},'');const t=r.accessToken||r.access_token||r.token;if(!t)throw Error('No token');setToken(t);return {signedIn:true}})}
  </section>:<>
   <section style={{borderTop:'1px solid #ddd',paddingTop:15,marginTop:20}}>
    <h2>25 · Link an accepted sale to a customer</h2>
    <div style={{display:'grid',gap:8,maxWidth:550}}>
     {field('Customer UUID',<input value={customerId} onChange={e=>setCustomerId(e.target.value)}/>)}
     {field('Accepted sale UUID',<input value={saleId} onChange={e=>setSaleId(e.target.value)}/>)}
     {btn('Link customer to sale',()=>call('/customer-finance/sale-customer','POST',{customerId,saleId}))}
     {btn('View customer sales',()=>call('/customer-finance/customer-sales?customerId='+encodeURIComponent(customerId)))}
    </div>
   </section>
   <section style={{borderTop:'1px solid #ddd',paddingTop:15,marginTop:20}}>
    <h2>26 · Manual refund register</h2>
    <div style={{display:'grid',gap:8,maxWidth:550}}>
     {field('Approved return UUID',<input value={returnId} onChange={e=>setReturnId(e.target.value)}/>)}
     {field('Proposed refund method',<select value={method} onChange={e=>setMethod(e.target.value)}>{['CASH','CARD','BANK','OTHER'].map(v=><option key={v}>{v}</option>)}</select>)}
     {btn('Request refund approval',()=>call('/customer-finance/refunds','POST',{returnId,method}))}
     {btn('List refund requests',()=>call('/customer-finance/refunds'))}
     {field('Refund UUID for approval / settlement',<input value={refundId} onChange={e=>setRefundId(e.target.value)}/>)}
     {btn('Approve refund (HQ admin)',()=>call('/customer-finance/refunds/'+encodeURIComponent(refundId)+'/approve','POST'))}
     {field('External payment receipt/reference',<input value={reference} onChange={e=>setReference(e.target.value)}/>)}
     {btn('Record manually paid refund (HQ admin)',async()=>{if(!confirm('Confirm funds were ALREADY paid externally? This only records settlement.'))throw Error('Cancelled');return call('/customer-finance/refunds/'+encodeURIComponent(refundId)+'/mark-paid','POST',{reference})})}
    </div>
   </section>
   <section style={{borderTop:'1px solid #ddd',paddingTop:15,marginTop:20}}>
    <h2>27 · Promotion definitions (draft only)</h2>
    <div style={{display:'grid',gap:8,maxWidth:550}}>
     {field('Promotion code',<input value={code} onChange={e=>setCode(e.target.value)}/>)}
     {field('Title',<input value={title} onChange={e=>setTitle(e.target.value)}/>)}
     {field('Type',<select value={type} onChange={e=>setType(e.target.value)}><option>PERCENT</option><option>FIXED</option></select>)}
     {field('Value',<input type="number" min="0.01" step="0.01" value={value} onChange={e=>setValue(e.target.value)}/>)}
     {field('Start (local browser time)',<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/>)}
     {field('End (local browser time)',<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/>)}
     {btn('Save draft (HQ admin)',()=>call('/customer-finance/promotions','POST',{code,title,type,value:Number(value),startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString()}))}
     {btn('List promotions',()=>call('/customer-finance/promotions'))}
    </div>
   </section>
  </>}
  <h2>Response</h2><pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',padding:12,background:'#eee',color:'#111'}}>{result}</pre>
 </main>;
}
