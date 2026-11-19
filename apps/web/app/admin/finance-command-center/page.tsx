import Link from "next/link";
import RetailFinanceOverview from "./components/retail-finance-overview";

const actions = [
  {
    title: "Branch Finance",
    description: "Cash closings, refunds and branch records.",
    href: "/admin/retail-finance"
  },
  {
    title: "Payments",
    description: "Supplier invoices and payment reconciliation.",
    href: "/admin/finance-reconciliation"
  },
  {
    title: "Issues",
    description: "Review payment exceptions and investigations.",
    href: "/admin/payment-reconciliation"
  },
  {
    title: "Reports",
    description: "Historical branch comparisons and reports.",
    href: "/admin/retail-finance/historical"
  }
];

export default function FinanceCommandCenter() {
  return (
    <main style={{
      maxWidth:1180,
      margin:"0 auto",
      padding:"28px 20px 48px",
      fontFamily:"system-ui"
    }}>
      <header style={{marginBottom:24}}>
        <div style={{
          color:"#ef3321",
          fontSize:12,
          fontWeight:700,
          letterSpacing:1
        }}>
          ROYAL STEP / FINANCE
        </div>

        <h1 style={{
          color:"#104c72",
          fontSize:28,
          margin:"8px 0"
        }}>
          Finance Overview
        </h1>

        <p style={{
          color:"#64748b",
          fontSize:14,
          margin:0
        }}>
          Financial activity across your retail branches.
        </p>
      </header>

      <RetailFinanceOverview />

      <section style={{marginTop:28}}>
        <h2 style={{
          color:"#104c72",
          fontSize:19,
          marginBottom:15
        }}>
          Finance Activities
        </h2>

        <div style={{
          display:"grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(220px,1fr))",
          gap:14
        }}>
          {actions.map(action=>(
            <Link
              key={action.href}
              href={action.href}
              style={{
                display:"block",
                padding:20,
                border:"1px solid #dbe3ed",
                borderRadius:12,
                background:"#ffffff",
                textDecoration:"none"
              }}
            >
              <strong style={{
                display:"block",
                color:"#104c72",
                fontSize:15,
                marginBottom:8
              }}>
                {action.title}
              </strong>

              <span style={{
                color:"#64748b",
                fontSize:12,
                lineHeight:1.6
              }}>
                {action.description}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <p style={{
        marginTop:24,
        color:"#64748b",
        fontSize:12
      }}>
        Detailed accounting and investigation tools
        are available under More tools in the finance menu.
      </p>
    </main>
  );
}