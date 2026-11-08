'use client';
import {useEffect,useState} from 'react';
const API='/api/v1';
type Row=Record<string,any>;
const today=()=>new Date().toISOString().slice(0,10);
const styles:{[key:string]:React.CSSProperties}={panel:{padding:18,border:'1px solid #d7dce4',borderRadius:12,margin:'18px 0'},grid:{display:'flex',flexWrap:'wrap',gap:12},input:{padding:9,maxWidth:380},button:{padding:'10px 16px',cursor:'pointer'}};
function csvCell(v:unknown){const s=String(v??'');const safe=/^[\s]*[=+@\-]/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"';}
export default function PaymentReconciliation(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[token,setToken]=useState('');
 const [locations,setLocations]=useState<Row[]>([]),[location,setLocation]=useState('');
 const [from,setFrom]=useState(today()),[to,setTo]=useState(today());
 const [status,setStatus]=useState(''),[cases,setCases]=useState<Row[]>([]),[selected,setSelected]=useState<Row|null>(null);
 const [summary,setSummary]=useState<Row|null>(null),[audit,setAudit]=useState<Row[]>([]),[truncated,setTruncated]=useState(false);
 const [deviceId,setDeviceId]=useState(''),[localSaleId,setLocalSaleId]=useState(''),[reason,setReason]=useState('');
 const [expected,setExpected]=useState(''),[observed,setObserved]=useState('');
 const [kind,setKind]=useState('TERMINAL_RECEIPT'),[reference,setReference]=useState(''),[note,setNote]=useState('');
 const [decision,setDecision]=useState('UNDER_REVIEW'),[reviewNote,setReviewNote]=useState('');
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function req(path:string,method='GET',body?:unknown,t=token){
  const r=await fetch(API+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',},body:body?JSON.stringify(body):undefined});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(Array.isArray(d.message)?d.message.join('; '):d.message||'HTTP '+r.status);return d;
 }
 async function action(fn:()=>Promise<void>){setBusy(true);setMessage('');try{await fn()}catch(e){setMessage(String(e))}finally{setBusy(false)}}
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

 async function load(loc=location){if(!loc)return;await action(async()=>{
  const q='locationId='+encodeURIComponent(loc),period=q+'&from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to);
  const [c,s,a]=await Promise.all([req('/payment-exceptions?'+q+(status?'&status='+encodeURIComponent(status):'')),req('/payment-reports/summary?'+period),req('/payment-reports/audit?'+period)]);
  setCases(c);setSummary(s);setAudit(a.rows);setTruncated(a.truncated);setSelected(null);setMessage('Records refreshed');
 })}
 async function open(id:string){await action(async()=>setSelected(await req('/payment-exceptions/'+id)))}
 async function createCase(){await action(async()=>{
  await req('/payment-exceptions','POST',{locationId:location,deviceId,localSaleId,reason,
   ...(expected.trim()?{expectedAmount:Number(expected)}:{}),...(observed.trim()?{observedAmount:Number(observed)}:{})});
  setReason('');setMessage('Exception registered. Refresh to see the case.');
 })}
 async function addEvidence(){if(!selected)return;await action(async()=>{
  await req('/payment-exceptions/'+selected.id+'/evidence','POST',{kind,reference,note});
  setSelected(await req('/payment-exceptions/'+selected.id));setReference('');setNote('');setMessage('Evidence recorded');
 })}
 async function review(){if(!selected||!confirm('Save supervisor decision? Closed cases cannot be reopened.'))return;
  await action(async()=>{await req('/payment-exceptions/'+selected.id+'/review','PATCH',{status:decision,note:reviewNote});
   setSelected(await req('/payment-exceptions/'+selected.id));setReviewNote('');setMessage('Supervisor decision saved. Refresh the list.');
  })}
 function downloadCsv(){if(!audit.length){setMessage('No audit records to export');return;}
  const keys=['id','locationId','deviceId','localSaleId','saleId','status','reason','expectedAmount','observedAmount','reportedById','reviewedById','reviewNote','createdAt','updatedAt','resolvedAt','evidenceCount','evidenceReferences'];
  const lines=[keys.map(csvCell).join(','),...audit.map(r=>keys.map(k=>csvCell(k==='locationId'?location:k==='evidenceReferences'?(r.evidences||[]).map((e:Row)=>e.kind+': '+e.reference).join(' | '):r[k])).join(','))];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`royal-step-payment-exceptions-${from}-${to}.csv`;a.click();URL.revokeObjectURL(url);
 }
 return <main style={{maxWidth:1250,margin:'30px auto',padding:20,fontFamily:'system-ui',lineHeight:1.5}}>
  <h1>Royal Step — Payment Reconciliation</h1><p><a href="/admin">HQ console</a> · Milestones 34–35</p>
  <p>Recorded tenders and administrative exception decisions are not proof of bank settlement, refund disbursement, or cash receipt.</p>
  {!token?<p role="status">Loading your HQ session. If this persists, return to <a href="/admin/finance-login">finance sign in</a>.</p>:<>
   <section style={styles.panel}><h2>Branch and reporting period</h2><div style={styles.grid}>
    <select value={location} onChange={e=>{setLocation(e.target.value);setCases([]);setSummary(null);setAudit([]);setSelected(null)}} style={styles.input}>
     {locations.map(l=><option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
    </select><label>From (UTC) <input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
    <label>To (UTC) <input type="date" value={to} onChange={e=>setTo(e.target.value)} /></label>
    <select aria-label="Exception status" value={status} onChange={e=>setStatus(e.target.value)} style={styles.input}>
     <option value="">All statuses</option>{['OPEN','UNDER_REVIEW','RESOLVED','VOIDED'].map(s=><option key={s}>{s}</option>)}
    </select><button disabled={busy||!location} onClick={()=>load()} style={styles.button}>Load dashboard</button>
    <button disabled={!audit.length} onClick={downloadCsv} style={styles.button}>Export exception audit CSV</button>
   </div>{truncated&&<p role="alert">Audit export capped at 1,000 records; shorten the date range.</p>}</section>
   {summary&&<section style={styles.panel}><h2>POS records — {from} to {to} (UTC)</h2>
    <div style={styles.grid}>{[
     ['Accepted sales',summary.acceptedSales],['Sales total (PKR)',summary.saleTotal],['Cash recorded (PKR)',summary.cashTender],
     ['Card recorded (PKR)',summary.cardTender],['Sale vs tender difference (PKR)',summary.saleTenderDifference],
     ['Merchandise return value (PKR)',summary.approvedReturnValue],['Open exceptions',summary.exceptions?.OPEN],
     ['Under review',summary.exceptions?.UNDER_REVIEW],['Resolved',summary.exceptions?.RESOLVED]
    ].map(([k,v])=><div key={String(k)} style={{border:'1px solid #ddd',padding:12,minWidth:170}}><small>{k}</small><div style={{fontSize:22,fontWeight:700}}>{v??'—'}</div></div>)}</div>
    <p>{summary.note}</p></section>}
   <section style={styles.panel}><h2>Exception register (latest 100, selected branch)</h2><div style={{overflowX:'auto'}}><table cellPadding={8} border={1} style={{borderCollapse:'collapse',width:'100%'}}>
    <thead><tr><th>Created</th><th>Case</th><th>Status</th><th>Reason</th><th>Expected</th><th>Observed</th><th>Evidence</th><th>Action</th></tr></thead>
    <tbody>{cases.map(c=><tr key={c.id}><td>{new Date(c.createdAt).toLocaleString()}</td><td>{c.id.slice(0,8)}</td><td>{c.status}</td><td>{c.reason}</td><td>{c.expectedAmount??'—'}</td><td>{c.observedAmount??'—'}</td><td>{c._count?.evidences??0}</td><td><button disabled={busy} onClick={()=>open(c.id)}>Inspect</button></td></tr>)}</tbody>
   </table></div></section>
   <section style={styles.panel}><h2>Escalate a payment exception</h2><p>Use the device ID and local sale ID from the cashier's checkout recovery record. Do not enter full card details.</p>
    <div style={{...styles.grid,alignItems:'center'}}>
     <input style={styles.input} placeholder="POS device UUID" value={deviceId} onChange={e=>setDeviceId(e.target.value)}/>
     <input style={styles.input} placeholder="Local sale UUID" value={localSaleId} onChange={e=>setLocalSaleId(e.target.value)}/>
     <input style={styles.input} placeholder="Expected amount (optional)" type="number" min="0" step="0.01" value={expected} onChange={e=>setExpected(e.target.value)}/>
     <input style={styles.input} placeholder="Observed amount (optional)" type="number" min="0" step="0.01" value={observed} onChange={e=>setObserved(e.target.value)}/>
     <input style={styles.input} placeholder="Reason" value={reason} onChange={e=>setReason(e.target.value)}/>
     <button disabled={busy||!location||!deviceId||!localSaleId||!reason.trim()} onClick={createCase}>Open exception</button>
    </div></section>
   {selected&&<section style={styles.panel}><h2>Case {selected.id}</h2><p><b>Status:</b> {selected.status} · <b>Device:</b> {selected.deviceId} · <b>Local sale:</b> {selected.localSaleId}</p>
    <p>{selected.reason}</p><h3>Evidence history</h3><ul>{(selected.evidences||[]).map((e:Row)=><li key={e.id}>{e.kind} — {e.reference} — {e.note} ({new Date(e.createdAt).toLocaleString()})</li>)}</ul>
    {['OPEN','UNDER_REVIEW'].includes(selected.status)?<>
     <h3>Add evidence</h3><div style={styles.grid}>
      <select value={kind} onChange={e=>setKind(e.target.value)}>{['TERMINAL_RECEIPT','CASH_COUNT','BANK_REFERENCE','OTHER'].map(x=><option key={x}>{x}</option>)}</select>
      <input placeholder="Reference (not card number)" value={reference} onChange={e=>setReference(e.target.value)} style={styles.input}/>
      <input placeholder="Evidence note" value={note} onChange={e=>setNote(e.target.value)} style={styles.input}/>
      <button disabled={busy||!reference.trim()||!note.trim()} onClick={addEvidence}>Record evidence</button>
     </div><h3>Supervisor decision</h3><div style={styles.grid}>
      <select value={decision} onChange={e=>setDecision(e.target.value)}>{['UNDER_REVIEW','RESOLVED','VOIDED'].map(x=><option key={x}>{x}</option>)}</select>
      <input placeholder="Required supervisor review note" value={reviewNote} onChange={e=>setReviewNote(e.target.value)} style={styles.input}/>
      <button disabled={busy||!reviewNote.trim()} onClick={review}>Save decision</button>
     </div></>:<p>Case closed by {selected.reviewedById||'supervisor'}. Note: {selected.reviewNote||'—'}</p>}
   </section>}
  </>}
  {message&&<p role="status" style={{padding:12,background:'#f1f5f9'}}>{message}</p>}
 </main>
}
