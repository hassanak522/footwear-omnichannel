# Milestone 11 — Operations reporting and reconciliation

This patch builds on Milestone 10. It adds six authenticated, SUPER_ADMIN-only, read-only operational reports and a new HQ Operations tab with CSV export. It intentionally makes **no database schema changes**, does **not** resolve stock conflicts automatically, and does **not** alter existing offline sales.

## Installation on Windows

1. Back up the project, PostgreSQL volume and Electron userData (do not delete offline sales).
2. Extract this ZIP into `G:\footwear-omnichannel`, keeping folder paths and overwriting matching files.
3. From project root, run `npm install`, `npx prisma generate --schema packages/database/prisma/schema.prisma` (only if Prisma client needs regeneration), then your existing API and web development commands.
4. Sign in to `http://localhost:3000/admin`, choose **Operations**, select a report, click **Load report**.
5. Export CSV and verify quoting, Unicode and totals against database source records.

## Reports

- `GET /api/v1/operations/inventory-health` — available/sellable/quarantined/reserved stock and optional inventory cost.
- `GET /api/v1/operations/stock-ledger` — stock movement history.
- `GET /api/v1/operations/sales-ledger` — accepted and conflicted POS sales with tender/line details.
- `GET /api/v1/operations/shift-ledger` — cash/card/expected/closing cash and variance.
- `GET /api/v1/operations/returns-ledger` — centrally approved returns.
- `GET /api/v1/operations/audit-ledger` — audit trail.

`from` inclusive, `to` exclusive, default 30 days, maximum 366 days. `limit` maximum 500 for dated reports. Stock health is a current snapshot capped at 5000.

## Important limitations

- No stock conflict is automatically accepted or deducted. Manager reconciliation remains a separate implementation task.
- Cash variance does not include petty-cash withdrawals, refunds, deposits or bank settlement.
- CSV exports contain operationally sensitive data: handle with access controls.
- Requires API and web build checks in your local environment before production use.
- If the application was modified after Milestone 10, review the two overwritten source files (`module.ts`, `admin/page.tsx`) before extracting.
