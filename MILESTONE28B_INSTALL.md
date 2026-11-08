# Royal Step Milestone 28B — POS Customer Selection (actual source integration)

Built against the source uploaded as `royal-step-latest.zip` on 2026-10-24.

## Delivered
- Search existing customers by phone in desktop POS (requires online API access and login).
- Select or remove customer before recording a sale.
- Persist `customerId` inside the existing local sql.js sale payload and outbox. No offline database schema change.
- On server sync, create `SaleCustomerLink` atomically with an ACCEPTED sale and inventory movements.
- Existing stock conflicts do not create a customer link.
- Duplicate sync retains existing idempotency semantics (payload hash includes optional customerId).
- Receipt displays short customer ID when present (not name/phone).

## Install
1. Back up source and the Electron userData `pos.sqlite` file. Keep unsynchronized sales.
2. Extract the ZIP to `G:\footwear-omnichannel`, preserving paths. Files are based on your uploaded snapshot; compare if you edited them since upload.
3. No Prisma migration required: relies on the existing `SaleCustomerLink` and `RetailCustomer` models.
4. `cd G:\footwear-omnichannel`
5. `npx tsc -p apps/api/tsconfig.json --noEmit`
6. `npm run build -w @footwear/pos-desktop`
7. Launch API with `npm run dev -w @footwear/api`; launch POS with `$env:POS_USE_BUILT_UI="1"; npm run start -w @footwear/pos-desktop`.

## Acceptance checks
- Login as CASHIER/BRANCH_MANAGER; customer search by >=5 phone characters.
- Search and select a known customer, complete a sale while offline; local `sales:list` payload should include `customerId`.
- Reconnect, sync, verify accepted sale and `GET /api/v1/customer-finance/customer-sales?customerId=<uuid>` (manager role).
- Retry same local sale sync: server should return duplicate and create no additional sale/customer link.
- Create a stock-conflicted sale with customer; it should not appear in customer purchase history.
- Complete a sale without customer: unchanged behavior.
- Verify printed receipt and that shift close/reconciliation still works.

## Important boundaries
- Milestone 29B/30B automatic promotion calculation, redemption, loyalty earning/redemption and returns reversal are NOT included. They require server-authoritative price calculation and careful offline rules.
- Customer search is online-only; selected customer ID persists for offline sale. Customer creation in POS is not included.
- Existing sale total is calculated from cashier-supplied prices; server-side price integrity must be addressed before enabling promotions or loyalty.
- No compilation against installed dependencies or live database was possible in this environment. Run the checks above.
