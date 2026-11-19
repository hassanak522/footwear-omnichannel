"use client";

import { useEffect, useState } from "react";

type Location = {
  id: string;
  code: string;
  name: string;
  type?: string;
};

type Compare = {
  from: string;
  to: string;
  truncated: boolean;
  rows: Array<{
    locationId: string;
    snapshotDate: string | null;
    pendingCount: number;
    pendingAmount: string;
    approvedCount: number;
    approvedAmount: string;
    recordedSettlementAmount: string;
  }>;
  warning: string;
};

type Exception = {
  type: string;
  id: string;
  invoiceId: string;
  amount: string;
  note: string;
};

type Statement = {
  invoice: {
    invoiceNumber: string;
    totalAmount: string;
  };
  verifiedEvidenceAmount: string;
  remainingAgainstVerifiedEvidence: string;
  truncated: boolean;
  warning: string;
  requests: unknown[];
  settlements: unknown[];
};

const panel: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #dbe3ed",
  borderRadius: 12,
  padding: 20,
  marginBottom: 20
};

const input: React.CSSProperties = {
  padding: 10,
  border: "1px solid #cbd5e1",
  borderRadius: 7,
  background: "#fff",
  maxWidth: "100%"
};

const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? "PKR " + n.toLocaleString("en-PK", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    : String(value ?? "—");
};

const csv = (value: unknown) => {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};

function download(
  filename: string,
  headers: string[],
  rows: unknown[][]
) {
  const content = [
    headers.map(csv).join(","),
    ...rows.map(row => row.map(csv).join(","))
  ].join("\r\n");

  const url = URL.createObjectURL(
    new Blob(["\uFEFF", content], {
      type: "text/csv;charset=utf-8"
    })
  );

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FinanceOperations() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationsError, setLocationsError] = useState("");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [showInvoice, setShowInvoice] = useState(false);

  const [compare, setCompare] = useState<Compare | null>(null);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [exceptionWarning, setExceptionWarning] = useState("");
  const [statement, setStatement] = useState<Statement | null>(null);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function get(url: string) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store"
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const message = Array.isArray(data?.message)
        ? data.message.join(", ")
        : data?.message;

      throw new Error(
        message || `Request failed (${response.status}).`
      );
    }

    return data;
  }

  useEffect(() => {
    let active = true;

    async function loadLocations() {
      try {
        const raw = await get("/api/v1/inventory/locations");

        const items = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.locations)
            ? raw.locations
            : Array.isArray(raw?.data)
              ? raw.data
              : [];

        const authorized = items
          .filter((item: any) =>
            item &&
            typeof item.id === "string" &&
            item.active !== false &&
            (item.type === "BRANCH" || item.type === "WAREHOUSE")
          )
          .map((item: any) => ({
            id: item.id,
            code: String(item.code || ""),
            name: String(item.name || item.code || "Location"),
            type: item.type
          })) as Location[];

        if (active) {
          setLocations(authorized);
        }
      } catch (e) {
        if (active) {
          setLocationsError(
            e instanceof Error ? e.message : String(e)
          );
        }
      } finally {
        if (active) setLocationsLoading(false);
      }
    }

    void loadLocations();

    return () => {
      active = false;
    };
  }, []);

  function toggleLocation(id: string) {
    setSelected(previous =>
      previous.includes(id)
        ? previous.filter(x => x !== id)
        : previous.length < 10
          ? [...previous, id]
          : previous
    );
  }

  function locationName(id: string) {
    const location = locations.find(x => x.id === id);
    return location
      ? `${location.code} — ${location.name}`
      : id;
  }

  async function run() {
    setError("");
    setCompare(null);
    setExceptions([]);
    setExceptionWarning("");
    setStatement(null);

    if (locationsLoading || locationsError) {
      setError(locationsError || "Locations are still loading.");
      return;
    }

    if (!selected.length || selected.length > 10) {
      setError("Select between 1 and 10 locations.");
      return;
    }

    if (selected.some(id => !locations.some(x => x.id === id))) {
      setError("An unauthorized location was selected.");
      return;
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to)
    ) {
      setError("Select both reporting dates.");
      return;
    }

    if (from > to) {
      setError("Start date cannot exceed end date.");
      return;
    }

    setLoading(true);

    try {
      const query = new URLSearchParams({
        locationIds: selected.join(","),
        from,
        to
      });

      const result = await get(
        `/api/v1/finance-operations/compare?${query.toString()}`
      );

      setCompare(result as Compare);

      if (selected.length === 1) {
        const id = selected[0];

        const exceptionResult = await get(
          `/api/v1/finance-operations/exceptions?locationId=${encodeURIComponent(id)}`
        );

        setExceptions(exceptionResult.items ?? []);
        setExceptionWarning(
          exceptionResult.truncated
            ? "Exception results truncated."
            : exceptionResult.warning ?? ""
        );
      }

      if (invoiceId.trim()) {
        const result = await get(
          `/api/v1/finance-operations/invoice-statement?invoiceId=${encodeURIComponent(invoiceId.trim())}`
        );

        setStatement(result as Statement);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load reports."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      maxWidth: 1200,
      margin: "0 auto",
      padding: "28px 20px 48px",
      fontFamily: "system-ui",
      color: "#172b4d"
    }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{
          color: "#ef3321",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1
        }}>
          ROYAL STEP / FINANCE
        </div>

        <h1 style={{
          color: "#104c72",
          margin: "8px 0"
        }}>
          Finance Operations
        </h1>

        <p style={{ color: "#64748b" }}>
          Compare branches, review financial exceptions
          and retrieve invoice statements.
          Recorded settlement evidence is not bank confirmation.
        </p>
      </header>

      <section style={panel}>
        <h2 style={{ color: "#104c72" }}>
          Reporting Filters
        </h2>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 18
        }}>
          <div>
            <strong>Select Locations</strong>

            <p style={{
              color: "#64748b",
              fontSize: 12
            }}>
              Choose up to 10 locations.
              Select one to include financial exceptions.
            </p>

            <div style={{
              maxHeight: 220,
              overflowY: "auto",
              border: "1px solid #dbe3ed",
              borderRadius: 8,
              padding: 10
            }}>
              {locationsLoading && <p>Loading locations…</p>}

              {locations.map(location => (
                <label key={location.id} style={{
                  display: "flex",
                  gap: 8,
                  padding: "7px 4px",
                  cursor: "pointer"
                }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(location.id)}
                    disabled={
                      loading ||
                      (!selected.includes(location.id) &&
                       selected.length >= 10)
                    }
                    onChange={() => toggleLocation(location.id)}
                  />
                  <span>
                    {location.code} — {location.name}
                  </span>
                </label>
              ))}
            </div>

            <p style={{ fontSize: 12 }}>
              {selected.length} selected
            </p>

            {locationsError && (
              <p role="alert" style={{ color: "#b91c1c" }}>
                {locationsError}
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <strong>From Date</strong>
              <input
                type="date"
                style={input}
                value={from}
                onChange={e => setFrom(e.target.value)}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <strong>To Date</strong>
              <input
                type="date"
                style={input}
                value={to}
                onChange={e => setTo(e.target.value)}
              />
            </label>
          </div>
        </div>

        <details
          style={{ marginTop: 18 }}
          open={showInvoice}
          onToggle={e => setShowInvoice(e.currentTarget.open)}
        >
          <summary style={{
            cursor: "pointer",
            fontWeight: 600
          }}>
            Invoice Statement Lookup (Optional)
          </summary>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              Invoice ID
              <input
                style={input}
                placeholder="Enter invoice ID"
                value={invoiceId}
                onChange={e => setInvoiceId(e.target.value)}
              />
            </label>
          </div>
        </details>

        <button
          type="button"
          disabled={loading || locationsLoading || !!locationsError}
          onClick={() => void run()}
          style={{
            marginTop: 18,
            background: "#104c72",
            color: "#fff",
            border: 0,
            borderRadius: 8,
            padding: "12px 20px",
            cursor: "pointer"
          }}
        >
          {loading ? "Loading…" : "Generate Finance Report"}
        </button>
      </section>

      {error && (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {compare && (
        <section style={panel}>
          <h2 style={{ color: "#104c72" }}>
            Branch Financial Comparison
          </h2>

          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse"
            }}>
              <thead>
                <tr>
                  {[
                    "Location",
                    "Snapshot",
                    "Pending",
                    "Approved",
                    "Recorded Evidence"
                  ].map(heading => (
                    <th key={heading} style={{
                      padding: 12,
                      textAlign: "left",
                      borderBottom: "1px solid #dbe3ed"
                    }}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {compare.rows.map(row => (
                  <tr key={row.locationId}>
                    <td style={{ padding: 12 }}>
                      {locationName(row.locationId)}
                    </td>
                    <td style={{ padding: 12 }}>
                      {row.snapshotDate ?? "No snapshot"}
                    </td>
                    <td style={{ padding: 12 }}>
                      {row.pendingCount}
                      <div>{money(row.pendingAmount)}</div>
                    </td>
                    <td style={{ padding: 12 }}>
                      {row.approvedCount}
                      <div>{money(row.approvedAmount)}</div>
                    </td>
                    <td style={{ padding: 12 }}>
                      {money(row.recordedSettlementAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(compare.warning || compare.truncated) && (
            <p role="alert" style={{ color: "#b45309" }}>
              {compare.warning}
              {compare.truncated && " Results truncated."}
            </p>
          )}

          <button
            disabled={compare.truncated}
            onClick={() => download(
              "royal-step-branch-comparison.csv",
              [
                "Location",
                "Snapshot date",
                "Pending count",
                "Pending amount",
                "Approved count",
                "Approved amount",
                "Recorded evidence"
              ],
              compare.rows.map(row => [
                locationName(row.locationId),
                row.snapshotDate,
                row.pendingCount,
                row.pendingAmount,
                row.approvedCount,
                row.approvedAmount,
                row.recordedSettlementAmount
              ])
            )}
          >
            Export Comparison CSV
          </button>
        </section>
      )}

      {statement && (
        <section style={panel}>
          <h2 style={{ color: "#104c72" }}>
            Invoice Statement: {statement.invoice.invoiceNumber}
          </h2>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
            gap: 12
          }}>
            {[
              ["Invoice Total", statement.invoice.totalAmount],
              ["Verified Staff Evidence", statement.verifiedEvidenceAmount],
              ["Remaining Against Evidence", statement.remainingAgainstVerifiedEvidence]
            ].map(([label, value]) => (
              <div key={label} style={{
                padding: 16,
                background: "#f8fafc",
                borderRadius: 8
              }}>
                <div style={{
                  fontSize: 12,
                  color: "#64748b"
                }}>
                  {label}
                </div>
                <strong>{money(value)}</strong>
              </div>
            ))}
          </div>

          {(statement.warning || statement.truncated) && (
            <p role="alert" style={{ color: "#b45309" }}>
              {statement.warning}
              {statement.truncated && " Statement truncated."}
            </p>
          )}
        </section>
      )}

      {(exceptions.length > 0 || exceptionWarning) && (
        <section style={panel}>
          <h2 style={{ color: "#104c72" }}>
            Financial Exceptions ({exceptions.length})
          </h2>

          {exceptions.map(item => (
            <div key={item.type + item.id} style={{
              padding: 12,
              borderBottom: "1px solid #e2e8f0"
            }}>
              <strong>{item.type}</strong>
              <div>Invoice: {item.invoiceId}</div>
              <div>Amount: {money(item.amount)}</div>
              <div style={{ color: "#64748b" }}>
                {item.note}
              </div>
            </div>
          ))}

          {exceptionWarning && (
            <p role="alert" style={{ color: "#b45309" }}>
              {exceptionWarning}
            </p>
          )}

          <button
            disabled={
              exceptionWarning.toLowerCase().includes("truncated")
            }
            onClick={() => download(
              "royal-step-finance-exceptions.csv",
              ["Type", "Record ID", "Invoice ID", "Amount", "Note"],
              exceptions.map(item => [
                item.type,
                item.id,
                item.invoiceId,
                item.amount,
                item.note
              ])
            )}
          >
            Export Exceptions CSV
          </button>
        </section>
      )}
    </main>
  );
}