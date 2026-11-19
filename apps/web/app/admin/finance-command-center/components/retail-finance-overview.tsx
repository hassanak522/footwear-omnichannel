"use client";

import {useEffect,useState} from "react";
import Link from "next/link";

type Branch={
  locationId:string;
  code:string;
  name:string;
  closedShifts:number;
  netShiftVariance:string;
  absoluteShiftVariance:string;
  refundDueAllTime:string;
  refundSettledAllTime:string;
  refundOutstandingAllTime:string;
  cashDrawerExceptions:number;
};

type Totals={
  closedShifts:number;
  netShiftVariance:string;
  absoluteShiftVariance:string;
  refundDueAllTime:string;
  refundSettledAllTime:string;
  refundOutstandingAllTime:string;
  cashDrawerExceptions:number;
};

type Report={
  generatedAt:string;
  currency:string;
  scope:string;
  from:string|null;
  to:string|null;
  timezone:string;
  liabilityScope:string;
  periodScope:string;
  branches:Branch[];
  totals:Totals;
  exceptionsTruncated?:boolean;
  notes?:string[];
};

function money(value:string|number|undefined){
  if(value===undefined)return "Unavailable";
  const n=Number(value);
  if(!Number.isFinite(n))return "Unavailable";
  return "PKR "+n.toLocaleString("en-PK",{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  });
}

function number(value:number|undefined){
  return typeof value==="number"&&Number.isFinite(value)
    ?value.toLocaleString("en-PK")
    :"Unavailable";
}

function Card({
  title,value,description
}:{
  title:string;
  value:string;
  description:string;
}){
  return (
    <div style={{
      padding:18,
      border:"1px solid #dbe3ed",
      borderRadius:11,
      background:"#ffffff",
      minWidth:0
    }}>
      <div style={{
        color:"#64748b",
        fontSize:12,
        marginBottom:9
      }}>{title}</div>
      <div style={{
        color:"#104c72",
        fontSize:23,
        fontWeight:750,
        overflowWrap:"anywhere"
      }}>{value}</div>
      <p style={{
        color:"#64748b",
        fontSize:11,
        lineHeight:1.6,
        margin:"9px 0 0"
      }}>{description}</p>
    </div>
  );
}

export default function RetailFinanceOverview(){
  const [report,setReport]=useState<Report|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  useEffect(()=>{
    const controller=new AbortController();

    async function load(){
      try{
        const response=await fetch(
          "/api/v1/pos/finance/historical-summary",
          {
            credentials:"include",
            cache:"no-store",
            signal:controller.signal
          }
        );

        if(!response.ok){
          throw new Error(
            "Financial report unavailable (HTTP "+
            response.status+")."
          );
        }

        const result:unknown=await response.json();

        if(
          !result||
          typeof result!=="object"||
          !("totals" in result)||
          !("branches" in result)||
          !Array.isArray(result.branches)
        ){
          throw new Error("Unexpected financial report format.");
        }

        setReport(result as Report);
      }catch(e){
        if(controller.signal.aborted)return;
        setError(
          e instanceof Error
            ?e.message
            :"Unable to load financial overview."
        );
      }finally{
        if(!controller.signal.aborted)setLoading(false);
      }
    }

    void load();
    return ()=>controller.abort();
  },[]);

  const totals=report?.totals;

  return (
    <section aria-label="Retail finance executive overview"
      style={{margin:"20px 0 26px"}}>

      <div style={{
        display:"flex",
        justifyContent:"space-between",
        alignItems:"center",
        gap:12,
        flexWrap:"wrap",
        marginBottom:15
      }}>
        <div>
          <h2 style={{
            color:"#104c72",
            fontSize:20,
            margin:"0 0 5px"
          }}>
            Retail Financial Snapshot
          </h2>
          <p style={{
            fontSize:12,
            color:"#64748b",
            margin:0
          }}>
            Existing POS finance records across authorized branches
          </p>
        </div>
        <Link
          href="/admin/retail-finance/historical"
          style={{color:"#104c72",fontSize:13,fontWeight:700}}
        >
          Detailed historical report
        </Link>
      </div>

      {loading&&<p role="status">Loading retail finance...</p>}

      {error&&(
        <p role="alert" style={{color:"#9a3412"}}>
          {error}
          {" "}
          <Link href="/admin/retail-finance/historical">
            Open detailed report
          </Link>
        </p>
      )}

      {report&&(
        <>
          <div style={{
            display:"grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(200px,1fr))",
            gap:12
          }}>
            <Card
              title="Closed POS Shifts"
              value={number(totals?.closedShifts)}
              description="Recorded shift closures in the source report."
            />
            <Card
              title="Net Cash Variance"
              value={money(totals?.netShiftVariance)}
              description="Signed difference across reported closed shifts."
            />
            <Card
              title="Outstanding Refunds"
              value={money(totals?.refundOutstandingAllTime)}
              description="All-time outstanding refund obligations."
            />
            <Card
              title="Cash Drawer Exceptions"
              value={number(totals?.cashDrawerExceptions)}
              description="Recorded cash drawer exceptions requiring review."
            />
          </div>

          <div style={{
            marginTop:18,
            background:"#ffffff",
            border:"1px solid #dbe3ed",
            borderRadius:11,
            padding:18
          }}>
            <div style={{
              display:"flex",
              justifyContent:"space-between",
              flexWrap:"wrap",
              gap:10,
              alignItems:"center",
              marginBottom:12
            }}>
              <h3 style={{
                fontSize:16,
                color:"#104c72",
                margin:0
              }}>
                Branch Financial Comparison
              </h3>
              <span style={{fontSize:12,color:"#64748b"}}>
                {report.branches.length} branches returned
              </span>
            </div>

            <div style={{overflowX:"auto"}}>
              <table style={{
                width:"100%",
                borderCollapse:"collapse",
                fontSize:12
              }}>
                <thead>
                  <tr>
                    {[
                      "Branch",
                      "Closed Shifts",
                      "Net Cash Variance",
                      "Outstanding Refunds",
                      "Drawer Exceptions"
                    ].map(label=>(
                      <th key={label} style={{
                        textAlign:"left",
                        padding:11,
                        borderBottom:"1px solid #cbd5e1",
                        whiteSpace:"nowrap"
                      }}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.branches.map(branch=>(
                    <tr key={branch.locationId}>
                      <td style={{padding:11}}>
                        <strong>{branch.name}</strong>
                        <div style={{color:"#64748b"}}>
                          {branch.code}
                        </div>
                      </td>
                      <td style={{padding:11}}>
                        {number(branch.closedShifts)}
                      </td>
                      <td style={{padding:11}}>
                        {money(branch.netShiftVariance)}
                      </td>
                      <td style={{padding:11}}>
                        {money(branch.refundOutstandingAllTime)}
                      </td>
                      <td style={{padding:11}}>
                        {number(branch.cashDrawerExceptions)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p style={{
              color:"#64748b",
              fontSize:11,
              lineHeight:1.6,
              marginBottom:0
            }}>
              Shift and variance figures follow the source
              reporting scope. Refund liabilities are
              all-time values and should not be interpreted
              as period revenue.
            </p>
          </div>

          <div style={{
            fontSize:11,
            color:"#64748b",
            marginTop:12,
            lineHeight:1.7
          }}>
            <div>Scope: {report.scope||"Not specified"}</div>
            <div>Period scope: {report.periodScope||"Not specified"}</div>
            <div>Liability scope: {report.liabilityScope||"Not specified"}</div>
            {report.exceptionsTruncated&&(
              <p role="alert">
                Exception details may be incomplete due to
                source reporting limits.
              </p>
            )}
            {report.notes?.map((note,i)=>(
              <p key={i}>{note}</p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}