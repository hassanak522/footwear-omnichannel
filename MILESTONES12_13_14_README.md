# Milestones 12–14: combined backend foundation

This is an **incremental backend patch**, not a complete finished retail platform. It is based on the Milestone 6 baseline with Milestones 7–11 applied. It does not include new HQ/POS screens, discount calculation, loyalty redemption, supplier payables, payment gateway, exchanges, deployment, or full financial accounting. Do not treat the new endpoints as production-tested.

## Included

- M12: suppliers, purchase orders, one-time receiving into warehouse with quarantined damaged units, stock-count snapshots and controlled posting. Uses stock movement and audit logs.
- M13: customer directory, opt-in marketing consent, phone lookup; **no card details stored**.
- M14: price change requests and admin approval with audit, branch performance snapshot.

## Windows install

1. Back up the project, PostgreSQL database, and Electron userData (offline sales) before changes.
2. Extract ZIP at `G:\footwear-omnichannel`, merging the `apps/` and `packages/` folders. Do not copy an extra parent directory.
3. Ensure the database container is healthy (`docker ps`) and that port 5433 is accessible.
4. From project root run:

```powershell
npm install
npm run db:generate
# Review generated SQL before applying it; create a migration in the database workspace:
cd packages\database
npx prisma migrate dev --name m12_m14_enterprise_foundation
cd ..\..
```

**Important:** `migrate dev` changes the schema; it must be run only on a backed-up development database. If the existing migration history differs, stop rather than reset the database. For production, generate/review migrations in development and apply with `prisma migrate deploy`. The `npm run db:generate` command may need to be repeated after the migration.

5. Restart the NestJS API. Existing HQ and Electron builds do not need source changes for this patch, but do not expect UI tabs for these endpoints.

## New API routes (JWT bearer required)

- `GET/POST /api/v1/purchasing/suppliers`
- `GET/POST /api/v1/purchasing/orders`
- `POST /api/v1/purchasing/orders/:id/receive`
- `GET/POST /api/v1/stock-counts`
- `POST /api/v1/stock-counts/:id/post`
- `GET/POST /api/v1/retail/customers`
- `GET/POST /api/v1/governance/price-requests`
- `POST /api/v1/governance/price-requests/:id/approve`
- `GET /api/v1/governance/branch-performance`

## Example payloads

Create purchase order:
```json
{"supplierId":"<UUID>","warehouseId":"<UUID>","reference":"PO-2026-0001","lines":[{"variantId":"<UUID>","quantity":3,"unitCost":1250}]}
```
Receive (3 total, 1 damaged/quarantined):
```json
{"lines":[{"variantId":"<UUID>","quantity":2,"damaged":1}]}
```
Create stock count:
```json
{"locationId":"<UUID>","reference":"COUNT-BR3-001","lines":[{"variantId":"<UUID>","countedQty":2}]}
```
Request price change:
```json
{"variantId":"<UUID>","proposedPrice":3200,"reason":"Approved retail price review"}
```

## Mandatory acceptance checks

- `npx prisma validate`, `npm run db:generate`, `npx tsc -p apps/api/tsconfig.json --noEmit`.
- Receive purchase order twice: second must fail without double stock increment.
- Receiving 2 good + 1 damaged must increase onHand by 3, quarantined by 1, and sellable by 2.
- Count posting must reject stale balances and quantities below protected inventory; posting twice must not duplicate movement.
- Price approval twice must not repeat; verify audit entry and price change.
- Branch manager cannot view or alter a location they are not assigned to; check API authorization.
- Regression: prior POS accepted sale, pending sale, stock conflict, returns, shifts, transfers, storefront checkout, HQ analytics.

## Known limitations

- Purchase receipts currently accept a single complete receipt (including short receipts), not partial/multi-delivery receiving.
- Stock counts are a simple snapshot-and-post workflow; no blind counting or dual approval.
- Customer directory is independent of POS sales; no customer-to-sale linkage or loyalty balances yet.
- Reporting is a lifetime summary, not date-filtered and not net of refunds.
- No full production security audit or end-to-end tests have been executed in this environment.
