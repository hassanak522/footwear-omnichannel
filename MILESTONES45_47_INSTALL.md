# Royal Step Milestones 45–47

## Scope
- **45 Supplier payables:** append-only invoice/payment/credit events and informational per-invoice balance. Not a posted accounts payable general ledger; does not verify payment at bank.
- **46 Inventory cost history:** transactional update to existing `InventoryCostBasis` and append-only `InventoryCostRevision`. Not FIFO/weighted-average historical COGS.
- **47 Consolidated reporting foundation:** location/date management snapshot records and read API. Snapshot figures are user-submitted, **not automatically calculated**, consolidated or audited.

## Install (Windows PowerShell)
1. Back up project and database. Keep Electron POS userData untouched.
2. Extract this ZIP to `G:\royal-m45-47-patch` (not over the project).
3. `cd G:\royal-m45-47-patch`
4. `.\INSTALL_M45_47.ps1 -Root "G:\footwear-omnichannel"`
5. `cd G:\footwear-omnichannel`
6. `npx prisma validate --schema packages/database/prisma/schema.prisma`
7. `npx prisma migrate dev --name payable_cost_history_finance_snapshots --schema packages/database/prisma/schema.prisma`
8. `npx prisma generate --schema packages/database/prisma/schema.prisma`
9. `npx tsc -p apps/api/tsconfig.json --noEmit`
10. `npm run build -w @footwear/api`

If Prisma reports drift, do NOT use `migrate reset`. Restore missing migration history first. Do not continue with subsequent commands if a prior command fails.

## Routes
`/api/v1/finance-extension/`:
- `POST payables/:invoiceId/events` kind INVOICE|PAYMENT|CREDIT, amount, reference, idempotencyKey, note
- `GET payables/:invoiceId`
- `POST cost-revisions` locationId, variantId, unitCost, reason
- `GET cost-revisions?locationId=...&variantId=...`
- `POST snapshots` locationId, snapshotDate, cashSales, receivables, payables, estimatedStockValue, missingCostVariants, sourceNote
- `GET snapshots?locationId=...`

## Limitations / QA
The package is a source patch only; no real customer environment compilation or database integration test performed. It assumes the same NestJS `Db`, `auth.ts`, and `module.ts` interfaces used in previous milestones. The endpoint contracts and security controls require integration testing before production. FinanceSnapshot is manual reporting data, not automatic accounting consolidation. The payable-event endpoint does not enforce total paid <= invoice amount, so payment validation and journal posting remain future work.
