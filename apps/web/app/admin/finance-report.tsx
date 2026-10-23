'use client';
import {useState} from 'react';
type Row={locationId:string;acceptedSales:number;stockConflicts:number;gross:string;cash:string;card:string};
type Report={period:{from:string;to:string};byLocation:Row[];truncated:boolean;note:string};
export default function FinanceReport({api,token}:{api:string;token:string}){
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[report,setReport]=useState<Report|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){setBusy(true);setError('');try{
  const p=new URLSearchParams();
  if(from)p.set('from',new Date(from+'T00:00:00Z').toISOString());
  if(to){const d=new Date(to+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);p.set('to',d.toISOString());}
  const res=await fetch(api+'/hq/sales-analytics?'+p.toString(),{headers:{Authorization:'Bearer '+token}});
  const body=await res.json();if(!res.ok)throw Error(body.message||'Report request failed');
  setReport(body);
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 function exportCsv(){if(!report)return;const cols=['locationId','acceptedSales','stockConflicts','gross','cash','card'] as const;const csv=[cols.join(','),...report.byLocation.map(r=>cols.map(k=>JSON.stringify(String(r[k]??''))).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='royal-step-pos-sales.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="card stack"><h2>Finance &amp; sales analytics</h2><p className="muted">Accepted POS sales, gross value and tender totals. Not a profit-and-loss statement: returns, refunds, tax, costs, card settlements and unsynced sales are not netted.</p><div className="grid"><label>From (UTC)<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through (UTC, inclusive)<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div><button disabled={busy||!!(from&&to&&from>to)} onClick={load}>{busy?'Loading…':'Generate report'}</button>{error&&<p role="alert" className="error">{error}</p>}{report&&<><p className="muted">From {new Date(report.period.from).toLocaleDateString()} to {new Date(report.period.to).toLocaleDateString()} (exclusive)</p><div className="tablewrap"><table><thead><tr><th>Location</th><th>Sales</th><th>Conflicts</th><th>Gross PKR</th><th>Cash PKR</th><th>Card PKR</th></tr></thead><tbody>{report.byLocation.map(r=><tr key={r.locationId}><td>{r.locationId}</td><td>{r.acceptedSales}</td><td>{r.stockConflicts}</td><td>{r.gross}</td><td>{r.cash}</td><td>{r.card}</td></tr>)}</tbody></table></div>{report.truncated&&<p className="error" role="alert">Result truncated at 5,000 sales. Narrow the date range before exporting.</p>}<p className="muted">{report.note}</p><button className="secondary" disabled={report.truncated} onClick={exportCsv}>Export CSV</button></>}</section>;
}
