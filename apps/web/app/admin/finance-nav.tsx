"use client";

import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";

const mainLinks = [
  {
    href:"/admin/finance-command-center",
    label:"Overview",
    paths:["/admin/finance-command-center"]
  },
  {
    href:"/admin/retail-finance",
    label:"Branches",
    paths:["/admin/retail-finance","/admin/retail"]
  },
  {
    href:"/admin/finance-reconciliation",
    label:"Payments",
    paths:["/admin/finance-reconciliation"]
  },
  {
    href:"/admin/payment-reconciliation",
    label:"Issues",
    paths:[
      "/admin/payment-reconciliation",
      "/admin/finance-casework",
      "/admin/retail-finance/cases"
    ]
  },
  {
    href:"/admin/retail-finance/historical",
    label:"Reports",
    paths:[
      "/admin/retail-finance/historical",
      "/admin/finance-operations"
    ]
  }
];

const advancedLinks = [
  {
    href:"/admin/retail",
    label:"Retail Operations"
  },
  {
    href:"/admin/finance-operations",
    label:"Finance Operations"
  },
  {
    href:"/admin/finance-casework",
    label:"Supplier Investigations"
  },
  {
    href:"/admin/retail-finance/cases",
    label:"Retail Investigations"
  },
  {
    href:"/admin/finance-controls",
    label:"Accounting Controls"
  }
];

export default function FinanceNav(){
  const pathname=usePathname();
  const router=useRouter();

  async function signOut(){
    const response=await fetch(
      "/api/admin-session/logout",
      {
        method:"POST",
        credentials:"same-origin"
      }
    );

    if(response.ok){
      router.replace("/admin/finance-login");
      router.refresh();
    }else{
      alert("Sign out failed. Please try again.");
    }
  }

  const linkStyle=(active:boolean):React.CSSProperties=>({
    display:"inline-flex",
    alignItems:"center",
    padding:"9px 13px",
    borderRadius:8,
    fontSize:13,
    fontWeight:active?700:500,
    textDecoration:"none",
    background:active?"#eaf4fb":"transparent",
    color:active?"#104c72":"#475569",
    borderBottom:active
      ?"2px solid #ef3321"
      :"2px solid transparent"
  });

  return (
    <nav
      aria-label="Royal Step Finance"
      style={{
        display:"flex",
        alignItems:"center",
        flexWrap:"wrap",
        gap:8,
        padding:"12px 20px",
        background:"#ffffff",
        borderBottom:"1px solid #e2e8f0",
        fontFamily:"system-ui"
      }}
    >
      <Link
        href="/admin"
        style={{
          fontWeight:800,
          color:"#104c72",
          textDecoration:"none",
          marginRight:15,
          fontSize:15
        }}
      >
        Royal Step HQ
      </Link>

      {mainLinks.map(item=>{
        const active=item.paths.includes(pathname);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname===item.href?"page":undefined}
            style={linkStyle(active)}
          >
            {item.label}
          </Link>
        );
      })}

      <details style={{position:"relative"}}>
        <summary style={{
          cursor:"pointer",
          padding:"9px 12px",
          color:"#64748b",
          fontSize:13
        }}>
          More tools
        </summary>

        <div style={{
          position:"absolute",
          top:"100%",
          right:0,
          zIndex:30,
          minWidth:230,
          background:"#ffffff",
          border:"1px solid #e2e8f0",
          borderRadius:10,
          padding:8,
          boxShadow:"0 8px 24px rgba(0,0,0,.1)"
        }}>
          {advancedLinks.map(item=>(
            <Link
              key={item.href}
              href={item.href}
              style={{
                display:"block",
                padding:"10px 12px",
                color:"#104c72",
                textDecoration:"none",
                fontSize:13,
                borderRadius:6
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </details>

      <button
        type="button"
        onClick={signOut}
        style={{
          marginLeft:"auto",
          background:"#ffffff",
          border:"1px solid #cbd5e1",
          borderRadius:8,
          padding:"9px 14px",
          cursor:"pointer",
          fontSize:13,
          color:"#475569"
        }}
      >
        Sign out
      </button>
    </nav>
  );
}