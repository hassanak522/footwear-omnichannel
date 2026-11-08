# Royal Step — Milestones 42–44 (additive backend foundation)

**Important: staging only.** Your latest reported database has nine applied migrations missing from the local migrations folder. **Do not run `prisma migrate reset` or `prisma migrate dev` until the original migrations are restored and drift is resolved.** The installer only changes source files; it does not connect to or mutate PostgreSQL.

## Scope
- M42: `InventoryCostBasis` manually maintained by branch/location + variant, estimated stock valuation from current `StockBalance.onHand` and manual cost. Missing costs flagged.
- M43: `SupplierInvoice` records linked to existing purchase orders; warehouse access, duplicate supplier/invoice guard, review/dispute workflow. **No actual accounts-payable ledger posting**.
- M44: explicit **profitability preview**, based on accepted POS sale totals and current manual costs. It is NOT a true gross margin/COGS report because it omits returns, historical costs, online sales, fees, expenses, and taxes.

## Stage code safely
1. Backup `G:\footwear-omnichannel` and PostgreSQL; preserve Electron userData.
2. Extract ZIP to any separate folder, for example `G:\royal-m42-44-patch`. **Do not extract directly over the project**.
3. From PowerShell:
   ```
   cd G:\royal-m42-44-patch
   .\INSTALL_M42_44.ps1 -Root "G:\footwear-omnichannel"
   ```
   If PowerShell blocks local scripts, run `powershell -ExecutionPolicy Bypass -File .\INSTALL_M42_44.ps1 -Root "G:\footwear-omnichannel"` after reviewing script.
4. The installer makes timestamped schema/module backups, appends only new models, registers the controller, and copies `retail-finance.ts`. It refuses to install twice.
5. **Do not run Prisma generate or TypeScript build yet** if migrations are unresolved or earlier syntax errors remain; Prisma Client must be generated after the new schema is actually migrated.

## When migration history has been restored
- `npx prisma migrate status --schema packages/database/prisma/schema.prisma`
- `npx prisma migrate dev --name inventory_cost_and_supplier_invoice --schema packages/database/prisma/schema.prisma`
- `npx prisma generate --schema packages/database/prisma/schema.prisma`
- `npx tsc -p apps/api/tsconfig.json --noEmit`
- `npm run build -w @footwear/api`

## New authenticated endpoints (SUPER_ADMIN or BRANCH_MANAGER; branch access enforced)
- `POST /api/v1/retail-finance/cost-basis` — `{locationId,variantId,unitCost,sourceNote}`
- `GET /api/v1/retail-finance/valuation?locationId=uuid`
- `POST /api/v1/retail-finance/supplier-invoices` — `{purchaseOrderId,invoiceNumber,invoiceDate,totalAmount,note}`
- `GET /api/v1/retail-finance/supplier-invoices?warehouseId=uuid`
- `PATCH /api/v1/retail-finance/supplier-invoices/:id/review` — `{status:"REVIEWED"|"DISPUTED",note}`
- `GET /api/v1/retail-finance/profitability-preview?locationId=uuid`

## Notes
- Inventory valuation is a snapshot at request time; no historical cost layers, FIFO, weighted-average, tax or audit ledger integration.
- Profitability preview uses at most 5000 sales and flags truncation; no date filter. Do not use as audited profit or as a final branch P&L.
- Source code staged but no migration, compilation, or database tests were performed.
