# Royal Step — Milestones 51–53 (read-only financial audit & HQ rollup)

## Features
- **51** Supplier invoice exposure report: totals of PENDING and APPROVED payment requests and any over-requested balance. Diagnostic only; does **not** prevent over-approval or confirm bank payments.
- **52** Staged accounting batch integrity report: verifies balanced debit and credit lines and flags structurally invalid batches. Does **not** post to the general ledger.
- **53** HQ snapshot rollup: sums the latest manually recorded finance snapshots across 1–25 locations that the authenticated user is authorized to access. **Dates may differ**; not an audited or period-aligned financial statement.

## Installation
1. Back up the project. Preserve PostgreSQL and offline POS userData.
2. Extract the ZIP into `G:\royal-m51-53-patch` (not over your project).
3. Run `cd G:\royal-m51-53-patch` then `.\INSTALL_M51_53.ps1 -Root "G:\footwear-omnichannel"`.
4. Run `cd G:\footwear-omnichannel` then `npx tsc -p apps/api/tsconfig.json --noEmit` and `npm run build -w @footwear/api`.

**No Prisma migration is required.** This patch only adds a NestJS controller and registers it in module.ts. It assumes Milestones 45–50 Prisma models and Client are already installed. Stop if compilation fails. Do not reset your database.

## Authenticated routes
- `GET /api/v1/finance-audit/invoice-exposure?invoiceId=<uuid>`
- `GET /api/v1/finance-audit/posting-integrity?locationId=<uuid>`
- `GET /api/v1/finance-audit/hq-snapshot-rollup?locationIds=<uuid>,<uuid>`

## Safety / limits
- Read-only API, JWT plus SUPER_ADMIN/BRANCH_MANAGER role and location assertions.
- Does not replace the Milestone 49 payment approval route; **aggregate payment limits are not enforced**. Do not use current approvals to authorize actual money transfers without stronger controls.
- No local project compilation or integration testing was possible without the latest merged source and database.
