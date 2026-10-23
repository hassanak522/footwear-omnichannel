'use client';
import {useState} from 'react';
type Line={variantId:string;maximum:number;label:string};
type Props={title:string;lines:Line[];busy?:boolean;onSubmit:(lines:{variantId:string;quantity:number;damaged:number}[])=>void;kind:'purchase'|'transfer'};
export default function ReceiptEditor({title,lines,busy,onSubmit,kind}:Props){
 const [counts,setCounts]=useState<Record<string,{good:string;damaged:string}>>({});
 const parsed=lines.map(line=>{const raw=counts[line.variantId];const good=raw?Number(raw.good):line.maximum;const damaged=raw?Number(raw.damaged):0;return {...line,good,damaged};});
 const valid=parsed.length>0&&parsed.every(l=>Number.isSafeInteger(l.good)&&Number.isSafeInteger(l.damaged)&&l.good>=0&&l.damaged>=0&&l.good+l.damaged<=l.maximum);
 return <form className="stack" onSubmit={e=>{e.preventDefault();if(!valid||busy)return;if(!window.confirm('Post this receipt? Inventory will change and this action cannot be undone.'))return;onSubmit(parsed.map(l=>({variantId:l.variantId,quantity:l.good,damaged:l.damaged})));}}>
  <h3>{title}</h3><p className="muted">Enter quantities physically received. Damaged units are quarantined; missing units are not added to stock.</p>
  {parsed.map(l=><div className="grid" key={l.variantId}><div><strong>{l.label}</strong><div className="muted">Dispatched / ordered: {l.maximum}</div></div><label>Good units<input type="number" min="0" max={l.maximum} step="1" value={counts[l.variantId]?.good??String(l.maximum)} onChange={e=>setCounts(old=>({...old,[l.variantId]:{good:e.target.value,damaged:old[l.variantId]?.damaged??'0'}}))}/></label><label>Damaged units<input type="number" min="0" max={l.maximum} step="1" value={counts[l.variantId]?.damaged??'0'} onChange={e=>setCounts(old=>({...old,[l.variantId]:{good:old[l.variantId]?.good??String(l.maximum),damaged:e.target.value}}))}/></label></div>)}
  {!valid&&<p className="error" role="alert">Each quantity must be a whole number, and good plus damaged cannot exceed the dispatched / ordered quantity.</p>}
  <button type="submit" disabled={!valid||busy}>{busy?'Processing…':kind==='purchase'?'Post supplier receipt':'Confirm stock receipt'}</button>
 </form>;
}
