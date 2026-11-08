# Royal Step — Milestones 34 and 35 (combined)

## Scope
- Milestone 34: New `/admin/payment-reconciliation` HQ/branch manager page: manager login, branch selection, latest exceptions, open cases, evidence history and entry, manager review, and access to payment summaries.
- Milestone 35: API `GET /api/v1/payment-reports/summary` and `GET /api/v1/payment-reports/audit`, restricted to assigned branches. Summary includes accepted POS sales, recorded cash/card tenders, merchandise return values, exception statuses and opened/closed shifts. Audit includes case reviewer and evidence references. The UI downloads CSV with spreadsheet formula injection protection.
- Links to the dashboard from the HQ and branch pages.
- Reporting dates use UTC and are limited to a 31-day period; audit capped at 1,000 cases, clearly flagged when capped.

## Installation order
1. Back up your project and PostgreSQL database. Preserve the Electron POS offline userData folder and unsynced sales.
2. Install Milestone 33 and complete its Prisma migration FIRST. This patch requires `PaymentException` and `PaymentExceptionEvidence` Prisma models and the Milestone 33 controller.
3. Extract this ZIP into `G:\footwear-omnichannel`, preserving the folder structure. The included `apps/api/src/module.ts` is based on the Milestone 33 version; merge any subsequent local changes before replacing it.
4. Run in PowerShell:
   ```powershell
   cd G:\footwear-omnichannel
   npx prisma generate --schema packages/database/prisma/schema.prisma
   npx tsc -p apps/api/tsconfig.json --noEmit
   npm run build -w @footwear/api
   npm run build -w @footwear/web
   ```
5. Start API and web with your existing commands. Navigate to `/admin/payment-reconciliation` and log in as an authorized manager.
6. **No new Prisma migration** for Milestones 34–35.

## Endpoints
- `GET /api/v1/payment-reports/summary?locationId=UUID&from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/v1/payment-reports/audit?locationId=UUID&from=YYYY-MM-DD&to=YYYY-MM-DD`
- Uses existing Milestone 33 `payment-exceptions` endpoints for create, detail, evidence and review.

## Important accounting limits
- Recorded cash/card tenders are NOT confirmed bank settlements or actual cash counts.
- Approved return values are merchandise values, NOT confirmed refunds paid.
- Exception `RESOLVED` is a supervisor's administrative decision, not proof of payment.
- CSV is an audit report, NOT a bank settlement export. It contains sensitive internal notes; restrict file distribution.
- Audit is capped at 1,000 cases. Narrow the period if truncated.
- Exception register displays latest 100 per branch, independent of report date range.
- No card gateway, payout provider, bank import, payment capture or automatic refund processing.
- The ZIP was integrity checked. Full TypeScript builds and database integration were not run here.
