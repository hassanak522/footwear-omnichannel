# Milestone 15 — Royal Step branch operations, online allocation, HQ screens

## Prerequisites
Apply milestones 6–14 first. This patch was built by layering the prior milestone archives and modifies only the files contained in this ZIP. This has NOT passed TypeScript compilation or database integration tests. It requires Prisma migration and seeding.

## Backups (PowerShell)
Close Electron first and copy its userData directory containing local sales. Back up PostgreSQL using `docker exec footwear-postgres pg_dump -U <DB_USER> -d <DB_NAME> -Fc` and save the dump before migrations. Back up the whole source tree. Never run `prisma migrate reset` or `docker compose down -v`.

## Installation
Extract this ZIP into `G:\footwear-omnichannel`, preserving paths. In project root:

```powershell
npm install
npx prisma validate --schema packages/database/prisma/schema.prisma
cd packages/database
npx prisma migrate dev --name m15_online_and_replenishment --create-only
```

Review the generated SQL. It should add `ONLINE` to the LocationType enum and create ReplenishmentRequest plus its enum. If Prisma wants to reset, STOP. After reviewing:

```powershell
npx prisma migrate dev
npx prisma generate
npx tsx prisma/seed.ts
cd ../..
npx tsc -p apps/api/tsconfig.json --noEmit
npm run build -w @footwear/web
npm run build -w @footwear/pos-desktop
```

Use your existing API/HQ start commands. For Electron, use `$env:POS_USE_BUILT_UI="1"; npm run start -w @footwear/pos-desktop`.

## What changed
1. HQ `Branch users` tab provisions unique branch manager logins with bcrypt passwords, assigned to one branch. Branch staff sign in at `/branch` or Electron with those credentials.
2. `/branch` shows location-scoped sellable stock and lets staff request replenishment from warehouse or another branch.
3. New `/replenishment/requests` request, approve, reject endpoints. Approval does NOT move stock; an audited stock transfer must still be created, approved, dispatched, and received.
4. Transfer creation permits warehouse or branch sources, and branch or ONLINE destinations; destination need not belong to the source requester. Existing approval/dispatch/receipt permission checks remain.
5. Online store queries ONLINE inventory only. Seed creates `ONLINE-RS-01`. Warehouse stock is not listed as online availability. Move stock to ONLINE via warehouse-to-ONLINE transfer. Historical online orders retain their original location references.
6. HQ Purchasing, Stock counts, Customers, Governance tabs expose milestone 12–14 APIs. Simple single-SKU purchase and count forms; receiving full ordered quantity assumes zero damage and is not appropriate for partial/damaged receipts. For damaged receiving, use API until detailed UI is added.
7. Receipt brand Royal Step, footer software by 7Solutions and 03313621464.
8. POS close shift button blocks PENDING sync sales, but allows STOCK_CONFLICT records to remain for manager reconciliation; no local records are deleted. Closing still requires backend authorization.

## Known limitations / safety
- This is a development patch, not a production-ready release. npm install offline could not run in the authoring environment, so TypeScript compilation and Prisma migration were not verified.
- Stock requests and transfers are separate operations; approving a request does not automatically create a transfer or link to a transfer.
- Branch stock portal shows SKU balances that have a StockBalance row. Zero-stock SKUs are selectable for requests via catalog.
- The HQ receiving form receives the full ordered quantity as good units; do not use it for damaged or partial receipts.
- The current HQ portal is not a full permission-specific UI; backend guards enforce role and location access. Do not share a common branch password publicly; create individual accounts for accountability.
- The POS cashier may close a shift with STOCK_CONFLICT sales. These remain unresolved and must be reviewed in HQ; they are not accepted sales.
- Historical online orders were created against the old warehouse location. They continue referencing that location; do not alter or reassign them manually.
- Full stock conflict reconciliation, linked replenishment fulfillment, refund and approval UI are future work.

## Critical smoke test
- Create branch user in HQ; log in at `/branch`; verify only assigned branch is available. Confirm a different branch's balance endpoint returns 403.
- Create request for an out-of-stock SKU from warehouse; approve request as source manager; manually create transfer, approve, dispatch, receive; verify balances.
- Confirm `/store/products` shows zero available before ONLINE transfer even if warehouse has stock. Transfer two units to ONLINE; confirm two available, checkout one, confirm stock reservation and dispatch.
- Verify `Royal Step` receipt footer. Verify POS close shift is enabled when no pending sales, and that conflicted sales remain recorded after closure.
- Open HQ Purchasing, Stock counts, Customers, Governance; test with disposable data and check audit logs.
