# Royal Step — Milestones 28–30 foundation (not full checkout implementation)

This patch introduces schema tables for **promotion redemption** and **loyalty point ledger** and read-only endpoints for customer lookup, loyalty balance/history, active promotion listing, and sale redemption inspection. It does **not** yet implement offline POS customer selection, applying discounts to sales, awarding/redeeming points, or online checkout integration.

## Why checkout integration is deferred
The full latest repository, especially the current POS `main.tsx`, Electron local persistence, IPC types, and NestJS `pos.ts`, is required to safely change the offline sale payload, hash, stock deduction, and idempotent sync in a single consistent release. Editing those from an older patch could corrupt accepted sales or double-award rewards.

## Installation
1. Back up project, PostgreSQL, and Electron local POS database.
2. Merge the two **new models only** into your current `packages/database/prisma/schema.prisma`; the supplied full schema is a reference based on Milestone 25–27 and may overwrite later local edits.
3. Merge `CheckoutFoundationController` import and registration into your current `apps/api/src/module.ts`, or use supplied module only if unchanged since M25–27.
4. Copy `apps/api/src/checkout-foundation.ts` into your project.
5. `cd G:\footwear-omnichannel`
6. `npx prisma validate --schema packages/database/prisma/schema.prisma`
7. `cd packages\database`
8. `npx prisma migrate dev --name m28_m30_loyalty_promotion_foundation --create-only`
9. Review migration SQL; **stop** on reset/drift prompt. Then `npx prisma migrate dev`.
10. `cd ..\..`
11. `npm run db:generate`
12. `npx tsc -p apps/api/tsconfig.json --noEmit`
13. Run API with your existing working command.

## Routes (authenticated SUPER_ADMIN / BRANCH_MANAGER)
- GET `/api/v1/checkout-foundation/customers?phone=0331`
- GET `/api/v1/checkout-foundation/loyalty?customerId=<uuid>`
- GET `/api/v1/checkout-foundation/promotions`
- GET `/api/v1/checkout-foundation/redemptions?saleId=<uuid>`
- GET `/api/v1/checkout-foundation/health`

## Safety and verification
- Loyalty balance sums **all** ledger events, not just the latest 100 displayed.
- This patch does not create loyalty ledger events or promotion redemptions. Empty balances and redemption lists are expected until checkout integration is completed.
- Existing sale prices, POS sync, and online checkout are unchanged.
- The archive was checked for integrity but not compiled or integration-tested against your local code.

## To complete M28–30
Provide a ZIP of the **latest working project** or GitHub branch containing all changes through M27 (omit `.env`, `node_modules`, database dumps and secrets). The next integration patch will modify the offline POS payload, local DB, Electron bridge, POS server sync, pricing calculation, and HQ promotion activation together, with tests for retries, returns, and stock conflicts.
