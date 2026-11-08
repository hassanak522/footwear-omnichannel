# Royal Step Milestones 22–24 — installation and limitations

## Contents
- M22: branch-scoped accepted-sale history and manager-approved return UI, using existing `POST /api/v1/pos/returns`.
- M23: read-only return ledger and per-sale returned quantities. **Customer-linked sales and exchanges are not implemented** because the current database has no sale-to-customer association.
- M24: daily sales / return-value / tender summary (UTC) and shift listing. This is an operational summary, **not** a general ledger or a record of refunds paid.

## Install (after Milestones 19–21)
1. Back up source, PostgreSQL, and offline POS database.
2. Copy archive files into `G:\footwear-omnichannel`, preserving paths. The `apps/api/src/module.ts` file is based on the Milestones 19–21 version; compare before overwriting if you have made local changes.
3. No Prisma schema migration.
4. In PowerShell:
   `cd G:\footwear-omnichannel`
   `npx tsc -p apps/api/tsconfig.json --noEmit`
   `npm run build -w @footwear/web`
5. Launch API with the working script from `npm run --workspace=@footwear/api` and launch web with your existing script.
6. Visit `http://localhost:3000/admin/retail` and sign in as SUPER_ADMIN or BRANCH_MANAGER.

## Tests
- Branch manager cannot query another branch (HTTP 400).
- Load recent sales and check quantities remaining after previous returns.
- Return one unit of an ACCEPTED sale, refresh and verify quantity and quarantined stock.
- Attempt over-return: API must reject.
- Attempt return against non-ACCEPTED sale: API must reject.
- Verify approved return appears in history and summary; **do not treat it as proof of money refunded**.
- Check UTC reporting day boundary for your Pakistan-based branches; business-local reporting is a future task.

## Known limitations
- Refund tender / gateway / cash settlement not implemented.
- Exchange workflows, customer-sale linking, loyalty, promotion engine, and accounting postings not implemented.
- Reporting is limited to the latest 100 sales/returns per branch; daily summary queries all matching transactions for the UTC day.
- UI submits a new idempotency key per approval. On a network timeout, inspect return history before retrying; otherwise a retry could create a second valid return if quantity remains.
- Source is an incremental patch, not an independently built application. Compile and test locally before using with real customer transactions.
