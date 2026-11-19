"use client";

import {useEffect,useState} from "react";
import Link from "next/link";

type Branch={
  id:string;
  code:string;
  name:string;
};

type Shift={
  shiftId:string;
  closedAt:string;
  expectedCash:string;
  countedCash:string;
  variance:string;
  acceptedSales:number;
};

type Refund={
  returnId:string;
  createdAt:string;
  refundDue:string;
  refundSettled:string;
  refundOutstanding:string;
  settlementStatus:string;
};

type Settlement={
  settlementId:string;
  settledAt:string;
  method:string;
  amount:string;
  drawerLinkStatus:string;
};

type Reconciliation={
  id:string;
  submittedAt:string;
  status:string;
  variance:string;
};

type Report={
  locationId:string;
  generatedAt:string;
  anyTruncated:boolean;
  rowLimit:number;
  warning:string;
  note:string;
  summary:{
    closedShifts:number;
    netShiftVariance:string;
    refundOutstanding:string;
    cashDrawerLinksRequiringReview:number;
  };
  shifts:Shift[];
  returns:Refund[];
  settlements:Settlement[];
  reconciliations:Reconciliation[];
};

const panel:React.CSSProperties={
  background:"#fff",
  border:"1px solid #dbe3ed",
  borderRadius:12,
  padding:18
};

const money=(value:string|number)=>{
  const n=Number(value);
  return Number.isFinite(n)
    ?"PKR "+n.toLocaleString("en-PK",{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })
    :"Unavailable";
};

const date=(value:string)=>
  value?new Date(value).toLocaleString():"—";

const short=(value:string)=>
  value.length>16
    ?value.slice(0,8)+"…"
    :value;

function Table({
  headers,rows
}:{
  headers:string[];
  rows:(string|number)[][];
}){
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{
        width:"100%",
        borderCollapse:"collapse",
        fontSize:13
      }}>
        <thead>
          <tr>
            {headers.map(h=>(
              <th key={h} style={{
                padding:11,
                textAlign:"left",
                background:"#f1f5f9",
                borderBottom:"1px solid #cbd5e1",
                whiteSpace:"nowrap"
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row,i)=>(
            <tr key={i}>
              {row.map((value,j)=>(
                <td key={j} style={{
                  padding:11,
                  borderBottom:"1px solid #e2e8f0"
                }}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length&&
        <p style={{color:"#64748b"}}>
          No records found.
        </p>
      }
    </div>
  );
}

export default function BranchFinance(){
  const [branches,setBranches]=useState<Branch[]>([]);
  const [locationId,setLocationId]=useState("");
  const [branchesLoading,setBranchesLoading]=useState(true);
  const [scopeError,setScopeError]=useState("");
  const [report,setReport]=useState<Report|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    let active=true;

    async function loadBranches(){
      try{
        const response=await fetch(
          "/api/v1/inventory/locations",
          {credentials:"include",cache:"no-store"}
        );

        const data=await response.json().catch(()=>null);

        if(!response.ok){
          throw new Error(
            "Unable to load authorized branches (HTTP "+
            response.status+")."
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
          .filter((item:any)=>
            item &&
            item.type==="BRANCH" &&
            item.active!==false &&
            typeof item.id==="string"
          )
          .map((item:any)=>({
            id:item.id,
            code:String(item.code||""),
            name:String(item.name||item.code||"Branch")
          }));

        if(active){
          setBranches(list);

          if(list.length===1){
            setLocationId(list[0].id);
          }
        }
      }catch(e){
        if(active){
          setScopeError(
            e instanceof Error?e.message:String(e)
          );
        }
      }finally{
        if(active)setBranchesLoading(false);
      }
    }

    void loadBranches();

    return ()=>{active=false;};
  },[]);

  async function load(){
    setError("");
    setReport(null);

    if(!branches.some(b=>b.id===locationId)){
      setError("Please select an authorized branch.");
      return;
    }

    setLoading(true);

    try{
      const response=await fetch(
        "/api/v1/pos/finance/retail-summary?locationId="+
        encodeURIComponent(locationId),
        {credentials:"include",cache:"no-store"}
      );

      const data=await response.json().catch(()=>null);

      if(!response.ok){
        const message=Array.isArray(data?.message)
          ?data.message.join(", ")
          :data?.message;

        throw new Error(
          message||"Unable to load branch finance."
        );
      }

      if(
        !data?.summary ||
        !Array.isArray(data.shifts) ||
        !Array.isArray(data.returns) ||
        !Array.isArray(data.settlements) ||
        !Array.isArray(data.reconciliations)
      ){
        throw new Error("Unexpected finance report format.");
      }

      setReport(data as Report);
    }catch(e){
      setError(e instanceof Error?e.message:String(e));
    }finally{
      setLoading(false);
    }
  }

  const metrics=report?[
    {
      label:"Closed Shifts",
      value:String(report.summary.closedShifts)
    },
    {
      label:"Cash Difference",
      value:money(report.summary.netShiftVariance)
    },
    {
      label:"Refunds Pending",
      value:money(report.summary.refundOutstanding)
    },
    {
      label:"Cash Issues",
      value:String(
        report.summary.cashDrawerLinksRequiringReview
      )
    }
  ]:[];

  const selectedBranch=branches.find(
    b=>b.id===locationId
  );

  return (
    <main style={{
      maxWidth:1200,
      margin:"0 auto",
      padding:"28px 20px 48px",
      fontFamily:"system-ui"
    }}>
      <h1 style={{
        color:"#104c72",
        fontSize:28,
        margin:"0 0 8px"
      }}>
        Branch Finance
      </h1>

      <p style={{
        color:"#64748b",
        fontSize:14,
        marginBottom:24
      }}>
        Review branch cash, refunds and shift closings.
      </p>

      <section style={{
        ...panel,
        display:"flex",
        gap:14,
        flexWrap:"wrap",
        alignItems:"end",
        marginBottom:20
      }}>
        <label style={{
          display:"grid",
          gap:8,
          flex:"1 1 280px"
        }}>
          <strong style={{fontSize:13}}>
            Select Branch
          </strong>

          <select
            value={locationId}
            disabled={branchesLoading}
            onChange={e=>{
              setLocationId(e.target.value);
              setReport(null);
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
                ?"Loading branches..."
                :"Choose a branch"}
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
          disabled={loading||branchesLoading||!locationId}
          onClick={load}
          style={{
            background:"#104c72",
            color:"#fff",
            border:0,
            borderRadius:8,
            padding:"12px 20px",
            cursor:"pointer"
          }}
        >
          {loading?"Loading...":"View Finance"}
        </button>
      </section>

      {scopeError&&
        <p role="alert" style={{color:"#b91c1c"}}>
          {scopeError}
        </p>
      }

      {!branchesLoading&&!scopeError&&branches.length===0&&
        <p role="status">
          No authorized retail branches are available.
        </p>
      }

      {error&&
        <p role="alert" style={{color:"#b91c1c"}}>
          {error}
        </p>
      }

      {report&&(
        <>
          <h2 style={{
            color:"#104c72",
            fontSize:19
          }}>
            {selectedBranch?.name||"Branch"} Overview
          </h2>

          <div style={{
            display:"grid",
            gridTemplateColumns:
              "repeat(auto-fit,minmax(210px,1fr))",
            gap:12,
            marginBottom:22
          }}>
            {metrics.map(item=>(
              <div key={item.label} style={panel}>
                <div style={{
                  color:"#64748b",
                  fontSize:13
                }}>
                  {item.label}
                </div>

                <div style={{
                  color:"#104c72",
                  fontSize:23,
                  fontWeight:700,
                  marginTop:10
                }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {report.anyTruncated&&
            <p role="alert" style={{color:"#b45309"}}>
              Some records are limited. These figures
              should not be treated as complete balances.
            </p>
          }

          <p style={{
            color:"#64748b",
            fontSize:12
          }}>
            Recent operational records only.
            Not a complete historical accounting report.
          </p>

          <section style={panel}>
            <h2 style={{
              fontSize:18,
              color:"#104c72",
              marginTop:0
            }}>
              Detailed Records
            </h2>

            <details style={{marginBottom:14}}>
              <summary style={{
                cursor:"pointer",
                padding:10,
                fontWeight:600
              }}>
                Shift Closings ({report.shifts.length})
              </summary>

              <Table
                headers={[
                  "Shift","Closed","Expected Cash",
                  "Counted Cash","Difference"
                ]}
                rows={report.shifts.map(s=>[
                  short(s.shiftId),
                  date(s.closedAt),
                  money(s.expectedCash),
                  money(s.countedCash),
                  money(s.variance)
                ])}
              />
            </details>

            <details style={{marginBottom:14}}>
              <summary style={{
                cursor:"pointer",
                padding:10,
                fontWeight:600
              }}>
                Customer Refunds ({report.returns.length})
              </summary>

              <Table
                headers={[
                  "Return","Date","Due",
                  "Paid","Pending","Status"
                ]}
                rows={report.returns.map(r=>[
                  short(r.returnId),
                  date(r.createdAt),
                  money(r.refundDue),
                  money(r.refundSettled),
                  money(r.refundOutstanding),
                  r.settlementStatus
                ])}
              />
            </details>

            <details style={{marginBottom:14}}>
              <summary style={{
                cursor:"pointer",
                padding:10,
                fontWeight:600
              }}>
                Refund Settlements ({report.settlements.length})
              </summary>

              <Table
                headers={[
                  "Settlement","Date","Method",
                  "Amount","Drawer Status"
                ]}
                rows={report.settlements.map(s=>[
                  short(s.settlementId),
                  date(s.settledAt),
                  s.method,
                  money(s.amount),
                  s.drawerLinkStatus
                ])}
              />
            </details>

            <details>
              <summary style={{
                cursor:"pointer",
                padding:10,
                fontWeight:600
              }}>
                Cash Reconciliations ({report.reconciliations.length})
              </summary>

              <Table
                headers={[
                  "Date","Status","Cash Difference"
                ]}
                rows={report.reconciliations.map(r=>[
                  date(r.submittedAt),
                  r.status,
                  money(r.variance)
                ])}
              />
            </details>
          </section>

          <p style={{
            marginTop:18,
            fontSize:12,
            color:"#64748b"
          }}>
            {report.warning} {report.note}
          </p>
        </>
      )}

      <div style={{marginTop:24}}>
        <Link
          href="/admin/retail-finance/historical"
          style={{color:"#104c72",fontWeight:600}}
        >
          View historical branch reports
        </Link>
      </div>
    </main>
  );
}