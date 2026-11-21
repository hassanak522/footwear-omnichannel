'use client';

// R8_01G_4B16_FINANCE_AUDIT
import {useEffect,useState} from 'react';

type Evidence={
 kind:string;
 reference:string;
 note:string;
 createdById:string;
 createdAt:string;
};

type AuditRow={
 id:string;
 deviceId:string;
 localSaleId:string;
 saleId:string|null;
 status:string;
 reason:string;
 expectedAmount:string|null;
 observedAmount:string|null;
 reportedById:string;
 reviewedById:string|null;
 reviewNote:string|null;
 createdAt:string;
 updatedAt:string;
 resolvedAt:string|null;
 evidenceCount:number;
 evidences:Evidence[];
};

type AuditReport={
 locationId:string;
 from:string;
 to:string;
 timezone:string;
 truncated:boolean;
 rows:AuditRow[];
};

type Props={
 locationId:string;
 from:string;
 to:string;
};

const utc=(value:string|null)=>
 value?new Date(value).toLocaleString('en-PK',{
  timeZone:'UTC',
  year:'numeric',
  month:'short',
  day:'2-digit',
  hour:'2-digit',
  minute:'2-digit'
 })+' UTC':'—';

const csvCell=(value:unknown)=>{
 const raw=String(value??'');
 // Prevent spreadsheet formula execution on CSV import.
 const safe=/^[\s]*[=+\-@]/.test(raw)?"'"+raw:raw;
 return '"'+safe.replace(/"/g,'""')+'"';
};

export default function ClearanceFinanceAudit({
 locationId,from,to
}:Props){
 const [report,setReport]=useState<AuditReport|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [status,setStatus]=useState('ALL');
 const [selected,setSelected]=useState<AuditRow|null>(null);

 useEffect(()=>{
  setReport(null);
  setSelected(null);
  setError('');
 },[locationId,from,to]);

 async function load(){
  if(!locationId)return;

  setLoading(true);
  setError('');
  setReport(null);
  setSelected(null);

  try{
   const query=new URLSearchParams({locationId,from,to});
   const response=await fetch(
    '/api/v1/payment-reports/audit?'+query.toString(),
    {credentials:'same-origin',cache:'no-store'}
   );

   const result=await response.json().catch(()=>({}));

   if(!response.ok){
    throw new Error(
     Array.isArray(result.message)
      ?result.message.join('; ')
      :result.message||'HTTP '+response.status
    );
   }

   setReport(result as AuditReport);
  }catch(e){
   setError(String(e));
  }finally{
   setLoading(false);
  }
 }

 const rows=(report?.rows||[]).filter(r=>
  status==='ALL'||r.status===status
 );

 const counts={
  OPEN:report?.rows.filter(r=>r.status==='OPEN').length||0,
  UNDER_REVIEW:report?.rows.filter(
   r=>r.status==='UNDER_REVIEW'
  ).length||0,
  RESOLVED:report?.rows.filter(
   r=>r.status==='RESOLVED'
  ).length||0,
  VOIDED:report?.rows.filter(
   r=>r.status==='VOIDED'
  ).length||0
 };

 function exportCsv(){
  if(!report)return;

  const headers=[
   'Case ID','Device ID','Local Sale ID','Sale ID',
   'Status','Reason','Expected Amount','Observed Amount',
   'Reported By','Reviewed By','Review Note',
   'Created UTC','Updated UTC','Resolved UTC',
   'Evidence Count','Evidence References'
  ];

  const data=rows.map(r=>[
   r.id,r.deviceId,r.localSaleId,r.saleId,r.status,
   r.reason,r.expectedAmount,r.observedAmount,
   r.reportedById,r.reviewedById,r.reviewNote,
   r.createdAt,r.updatedAt,r.resolvedAt,
   r.evidenceCount,
   r.evidences.map(e=>e.kind+': '+e.reference).join('; ')
  ]);

  const content=[headers,...data]
   .map(line=>line.map(csvCell).join(','))
   .join('\r\n');

  const blob=new Blob(['\uFEFF'+content],{
   type:'text/csv;charset=utf-8'
  });

  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download='payment-case-audit-'+from+'-'+to+'.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
 }

 return (
  <div className="card stack">
   <h3>Finance casework audit history</h3>

   <p className="muted">
    Historical payment-exception cases for the selected
    branch and UTC period. Includes clearance and other
    payment cases. The date filter uses case creation date.
   </p>

   <div className="row">
    <button
     onClick={load}
     disabled={loading||!locationId}
    >
     {loading?'Loading...':'Load audit history'}
    </button>

    <label>
     Case status
     <select
      value={status}
      onChange={e=>setStatus(e.target.value)}
     >
      <option value="ALL">All</option>
      <option value="OPEN">Open</option>
      <option value="UNDER_REVIEW">Under review</option>
      <option value="RESOLVED">Resolved</option>
      <option value="VOIDED">Voided</option>
     </select>
    </label>

    <button
     className="secondary"
     disabled={!report}
     onClick={exportCsv}
    >
     Export CSV
    </button>
   </div>

   {error&&<p role="alert">{error}</p>}

   {report&&(
    <>
     {report.truncated&&(
      <p role="alert">
       Audit results reached the 1,000-case limit.
       Narrow the reporting period for a complete export.
      </p>
     )}

     <p>
      <strong>Cases:</strong> {report.rows.length}
      {' | '}
      Open: {counts.OPEN}
      {' | '}
      Under review: {counts.UNDER_REVIEW}
      {' | '}
      Resolved: {counts.RESOLVED}
      {' | '}
      Voided: {counts.VOIDED}
     </p>

     <div style={{overflowX:'auto'}}>
      <table>
       <thead>
        <tr>
         <th>Created UTC</th>
         <th>Case</th>
         <th>Status</th>
         <th>Evidence</th>
         <th>Reviewer</th>
         <th>Action</th>
        </tr>
       </thead>
       <tbody>
        {rows.map(r=>(
         <tr key={r.id}>
          <td>{utc(r.createdAt)}</td>
          <td>{r.id.slice(0,8)}</td>
          <td>{r.status}</td>
          <td>{r.evidenceCount}</td>
          <td>{r.reviewedById?.slice(0,8)||'—'}</td>
          <td>
           <button
            className="secondary"
            onClick={()=>setSelected(r)}
           >
            Details
           </button>
          </td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>

     {rows.length===0&&(
      <p>No cases match the selected filters.</p>
     )}

     {selected&&(
      <div className="card stack">
       <div className="row">
        <h4>Audit case details</h4>
        <button
         className="secondary"
         onClick={()=>setSelected(null)}
        >
         Close
        </button>
       </div>

       <p><strong>Case ID:</strong> {selected.id}</p>
       <p><strong>Device ID:</strong> {selected.deviceId}</p>
       <p><strong>Local sale:</strong> {selected.localSaleId}</p>
       <p><strong>Sale ID:</strong> {selected.saleId||'—'}</p>
       <p><strong>Status:</strong> {selected.status}</p>
       <p><strong>Reason:</strong> {selected.reason}</p>
       <p><strong>Expected:</strong> {selected.expectedAmount??'—'}</p>
       <p><strong>Observed:</strong> {selected.observedAmount??'—'}</p>
       <p><strong>Reported by:</strong> {selected.reportedById}</p>
       <p><strong>Reviewed by:</strong> {selected.reviewedById||'—'}</p>
       <p><strong>Review note:</strong> {selected.reviewNote||'—'}</p>
       <p><strong>Resolved:</strong> {utc(selected.resolvedAt)}</p>

       <h4>Evidence history</h4>

       {selected.evidences.map((e,i)=>(
        <div key={i} className="card">
         <p><strong>Type:</strong> {e.kind}</p>
         <p><strong>Reference:</strong> {e.reference}</p>
         <p><strong>Note:</strong> {e.note}</p>
         <p><strong>Recorded by:</strong> {e.createdById}</p>
         <p><strong>Recorded:</strong> {utc(e.createdAt)}</p>
        </div>
       ))}

       {selected.evidences.length===0&&(
        <p>No evidence records attached.</p>
       )}
      </div>
     )}

     <p className="muted">
      Case status and attached evidence are administrative
      records, not independent confirmation of cash deposits
      or external payment settlement.
     </p>
    </>
   )}
  </div>
 );
}
