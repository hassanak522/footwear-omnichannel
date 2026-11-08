# Royal Step — Milestones 48–50

## Included
- **48 — Invoice posting staging:** two balanced debit/credit staging lines for each REVIEWED supplier invoice; unique source and idempotency key. This does **not** automatically post to a general ledger.
- **49 — Supplier payment controls:** request, approve/reject, no self-approval, duplicate prevention. Approval does **not** transfer funds or prove bank settlement. Current implementation caps each individual request to invoice face value, **not aggregate outstanding balance**; don't use as final payment authorization without aggregate controls.
- **50 — HQ reporting foundation:** a location-scoped endpoint returning up to 30 manually entered finance snapshots, pending approval count/amount, and staged posting count. Not a cross-branch consolidated P&L.

## Installation
1. Back up your project, database, and Electron POS local userData before changes.
2. Extract the ZIP to `G:\royal-m48-50-patch` (separate from project).
3. PowerShell: `cd G:\royal-m48-50-patch` then `.\INSTALL_M48_50.ps1 -Root "G:\footwear-omnichannel"`.
4. `cd G:\footwear-omnichannel`
5. `npx prisma validate --schema packages/database/prisma/schema.prisma`
6. `npx prisma migrate dev --name finance_posting_stage_payment_approvals --schema packages/database/prisma/schema.prisma`
7. `npx prisma generate --schema packages/database/prisma/schema.prisma`
8. `npx tsc -p apps/api/tsconfig.json --noEmit`
9. `npm run build -w @footwear/api`

**Stop at the first failed command.** Never use `prisma migrate reset` to resolve drift. If schema validation fails, fix it before migrating. Original schema and module are timestamp-backed up by the installer.

## Routes (JWT + SUPER_ADMIN / BRANCH_MANAGER and location assertion)
- POST `/api/v1/finance-controls-v2/stage-invoice/:invoiceId`: `{idempotencyKey,expenseAccountCode,payableAccountCode,memo}`
- POST `/api/v1/finance-controls-v2/payment-requests`: `{invoiceId,amount,reference,idempotencyKey,note}`
- POST `/api/v1/finance-controls-v2/payment-requests/:id/decision`: `{decision:"APPROVED"|"REJECTED",note}`
- GET `/api/v1/finance-controls-v2/hq-summary?locationId=...`

## QA caveats
Source ZIP integrity checked; this package was **not compiled or integration-tested against your current local source**. The controller relies on earlier Db/auth contracts and Prisma model names. Verify authorization, concurrent payment approvals, account mapping, bank settlement, and aggregate outstanding-balance checks before any production finance use. No existing POS, checkout, or inventory workflow is modified by this package.
