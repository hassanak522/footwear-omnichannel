"use client";

import {useEffect,useState} from "react";
import Link from "next/link";

type Branch={
  id:string;
  name:string;
  code:string;
};

type Overview={
  locationId:string;
  pendingRequests:{count:number;amount:string};
  approvedRequests:{count:number;amount:string};
  recordedSettlementEvidence:{count:number;amount:string};
  stagedPostingBatches:number;
  registeredPeriodLocks:number;
  warning:string;
};

type ReportRow={
  invoiceId:string;
  invoiceNumber:string;
  invoiceDate:string;
  invoiceAmount:string;
  verifiedEvidence:string;
  disputedEvidence:string;
  unreviewedEvidence:string;
  remainingAgainstVerifiedEvidence:string;
};

const panel:React.CSSProperties={
  background:"#fff",
  border:"1px solid #dbe3ed",
  borderRadius:12,
  padding:18
};

function money(value:string|number){
  const n=Number(value);
  return Number.isFinite(n)
    ?"PKR "+n.toLocaleString("en-PK",{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })
    :"Unavailable";
}

function csvCell(value:unknown){
  const s=String(value??"");
  const safe=/^[\s]*[=+@-]/.test(s)?"'"+s:s;
  return '"'+safe.replace(/"/g,'""')+'"';
}

export default function PaymentsPage(){
  const [branches,setBranches]=useState<Branch[]>([]);
  const [locationId,setLocationId]=useState("");
  const [branchesLoading,setBranchesLoading]=useState(true);
  const [overview,setOverview]=useState<Overview|null>(null);
  const [rows,setRows]=useState<ReportRow[]>([]);
  const [truncated,setTruncated]=useState(false);
  const [error,setError]=useState("");
  const [warning,setWarning]=useState("");
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    let active=true;

    async function initialize(){
      try{
        const response=await fetch(
          "/api/v1/inventory/locations",
          {credentials:"include",cache:"no-store"}
        );

        const data=await response.json().catch(()=>null);

        if(!response.ok){
          throw new Error(
            "Unable to load authorized locations."
          );
        }

        const items=Array.isArray(data)
          ?data
          :Array.isArray(data?.locations)
            ?data.locations
            :Array.isArray(data?.data)
              ?data.data
              :[];

        const list:Branch[]=items
          .filter((x:any)=>
            x &&
            typeof x.id==="string" &&
            x.active!==false &&
            (x.type==="BRANCH"||x.type==="WAREHOUSE")
          )
          .map((x:any)=>({
            id:x.id,
            name:String(x.name||x.code||"Location"),
            code:String(x.code||"")
          }));

        if(active){
          setBranches(list);
          if(list.length===1)setLocationId(list[0].id);
        }
      }catch(e){
        if(active)setError(
          e instanceof Error?e.message:String(e)
        );
      }finally{
        if(active)setBranchesLoading(false);
      }
    }

    void initialize();
    return ()=>{active=false;};
  },[]);

  async function load(){
    setError("");
    setWarning("");
    setOverview(null);
    setRows([]);
    setTruncated(false);

    if(!branches.some(b=>b.id===locationId)){
      setError("Select an authorized location.");
      return;
    }

    setLoading(true);

    try{
      const q=encodeURIComponent(locationId);

      const [a,b]=await Promise.all([
        fetch(
          "/api/v1/finance-reconciliation/hq-overview?locationId="+q,
          {credentials:"include",cache:"no-store"}
        ),
        fetch(
          "/api/v1/finance-verification/reconciliation-rows?locationId="+q,
          {credentials:"include",cache:"no-store"}
        )
      ]);

      if(!a.ok||!b.ok){
        throw new Error(
          "Unable to load payment records ("+
          a.status+"/"+b.status+")."
        );
      }

      const summary=await a.json();
      const report=await b.json();

      if(
        !summary?.pendingRequests ||
        !summary?.approvedRequests ||
        !summary?.recordedSettlementEvidence ||
        !Array.isArray(report?.rows)
      ){
        throw new Error("Unexpected payment report format.");
      }

      setOverview(summary);
      setRows(report.rows);
      setTruncated(!!report.truncated);
      setWarning(
        report.truncated
          ?"Report is limited by server row limits. It is not a complete reconciliation."
          :report.warning||""
      );
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{
      setLoading(false);
    }
  }

  function exportCsv(){
    if(!rows.length||truncated)return;

    const keys:(keyof ReportRow)[]=[
      "invoiceId","invoiceNumber","invoiceDate",
      "invoiceAmount","verifiedEvidence",
      "disputedEvidence","unreviewedEvidence",
      "remainingAgainstVerifiedEvidence"
    ];

    const csv=[
      keys.map(csvCell).join(","),
      ...rows.map(row=>
        keys.map(key=>csvCell(row[key])).join(",")
      )
    ].join("\r\n");

    const url=URL.createObjectURL(
      new Blob(["\uFEFF",csv],{
        type:"text/csv;charset=utf-8"
      })
    );

    const a=document.createElement("a");
    a.href=url;
    a.download="royal-step-supplier-payments.csv";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  const cards=overview?[
    {
      label:"Pending Payments",
      value:money(overview.pendingRequests.amount),
      detail:overview.pendingRequests.count+" requests"
    },
    {
      label:"Approved Payments",
      value:money(overview.approvedRequests.amount),
      detail:overview.approvedRequests.count+" requests"
    },
    {
      label:"Recorded Settlement Evidence",
      value:money(
        overview.recordedSettlementEvidence.amount
      ),
      detail:
        overview.recordedSettlementEvidence.count+
        " records"
    }
  ]:[];

  return (
    <main style={{
      maxWidth:1180,
      margin:"0 auto",
      padding:"28px 20px 48px",
      fontFamily:"system-ui"
    }}>
      <h1 style={{
        color:"#104c72",
        fontSize:28,
        margin:"0 0 8px"
      }}>
        Payments
      </h1>

      <p style={{
        color:"#64748b",
        fontSize:14,
        marginBottom:24
      }}>
        Review supplier payment requests,
        approvals and recorded settlement evidence.
      </p>

      <section style={{
        ...panel,
        display:"flex",
        flexWrap:"wrap",
        alignItems:"end",
        gap:14
      }}>
        <label style={{
          display:"grid",
          gap:8,
          flex:"1 1 280px"
        }}>
          <strong style={{fontSize:13}}>
            Select Location
          </strong>

          <select
            value={locationId}
            disabled={branchesLoading}
            onChange={e=>{
              setLocationId(e.target.value);
              setOverview(null);
              setRows([]);
              setError("");
            }}
            style={{
              padding:12,
              border:"1px solid #cbd5e1",
              borderRadius:8,
              background:"#fff"
            }}
          >
            <option value="">
              {branchesLoading
                ?"Loading locations..."
                :"Choose location"}
            </option>

            {branches.map(branch=>(
              <option key={branch.id} value={branch.id}>
                {branch.name} ({branch.code})
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={load}
          disabled={loading||branchesLoading||!locationId}
          style={{
            background:"#104c72",
            color:"#fff",
            padding:"12px 20px",
            border:0,
            borderRadius:8,
            cursor:"pointer"
          }}
        >
          {loading?"Loading...":"View Payments"}
        </button>
      </section>

      {error&&
        <p role="alert" style={{color:"#b91c1c"}}>
          {error}
        </p>
      }

      {!branchesLoading&&!error&&branches.length===0&&
        <p>No authorized locations available.</p>
      }

      {overview&&(
        <>
          <div style={{
            display:"grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(220px,1fr))",
            gap:12,
            margin:"22px 0"
          }}>
            {cards.map(card=>(
              <div key={card.label} style={panel}>
                <div style={{
                  color:"#64748b",
                  fontSize:13
                }}>
                  {card.label}
                </div>

                <div style={{
                  color:"#104c72",
                  fontSize:22,
                  fontWeight:700,
                  marginTop:10
                }}>
                  {card.value}
                </div>

                <p style={{
                  fontSize:12,
                  color:"#64748b"
                }}>
                  {card.detail}
                </p>
              </div>
            ))}
          </div>

          <section style={panel}>
            <div style={{
              display:"flex",
              justifyContent:"space-between",
              alignItems:"center",
              flexWrap:"wrap",
              gap:12
            }}>
              <h2 style={{
                fontSize:18,
                color:"#104c72"
              }}>
                Supplier Invoices
              </h2>

              <button
                onClick={exportCsv}
                disabled={!rows.length||truncated}
                style={{padding:"9px 14px"}}
              >
                Export CSV
              </button>
            </div>

            <div style={{overflowX:"auto"}}>
              <table style={{
                width:"100%",
                borderCollapse:"collapse",
                fontSize:13
              }}>
                <thead>
                  <tr>
                    {[
                      "Invoice","Amount","Verified Evidence",
                      "Disputed","Unreviewed","Remaining"
                    ].map(h=>(
                      <th key={h} style={{
                        padding:11,
                        textAlign:"left",
                        borderBottom:"1px solid #cbd5e1"
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {rows.map(row=>(
                    <tr key={row.invoiceId}>
                      {[
                        row.invoiceNumber,
                        money(row.invoiceAmount),
                        money(row.verifiedEvidence),
                        money(row.disputedEvidence),
                        money(row.unreviewedEvidence),
                        money(row.remainingAgainstVerifiedEvidence)
                      ].map((value,i)=>(
                        <td key={i} style={{
                          padding:11,
                          borderBottom:"1px solid #e2e8f0"
                        }}>
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {!rows.length&&
                <p style={{color:"#64748b"}}>
                  No supplier invoices returned.
                </p>
              }
            </div>
          </section>

          {(warning||overview.warning)&&
            <p role="status" style={{
              color:"#92400e",
              fontSize:12,
              marginTop:18
            }}>
              {warning} {overview.warning}
            </p>
          }

          <p style={{
            fontSize:12,
            color:"#64748b"
          }}>
            Payment and settlement evidence is
            staff-reviewed. It does not independently
            confirm bank settlement.
          </p>
        </>
      )}

      <div style={{marginTop:24}}>
        <Link href="/admin/payment-reconciliation"
          style={{color:"#104c72",fontWeight:600}}>
          Review payment exceptions
        </Link>
      </div>
    </main>
  );
}