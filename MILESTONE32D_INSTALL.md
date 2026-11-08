# Royal Step Milestone 32D — discounted POS sandbox integration & local recovery

## Important: test-only release
This patch **does not enable live discounted customer payments**. Discounted sales are disabled by default and can only be tested after explicitly building with `VITE_ENABLE_DISCOUNT_SANDBOX=true`. Even in sandbox mode, the API posts REAL sales and stock movements to the configured database. Use an isolated test database and test inventory.

## What changed
- Desktop POS now has a sandbox-only button to post an online discounted transaction against `POST /api/v1/pos/checkout/online-discounted-sale`.
- Electron persists an immutable attempt with UUID and full payload in a new `discount_attempts` sql.js table BEFORE the HTTP request.
- An interrupted/uncertain response becomes `UNKNOWN`; the UI **never automatically resubmits it**.
- Sales history includes a discounted attempts table, server status lookup using `GET /api/v1/pos/checkout/discounted-status/:deviceId/:localSaleId`, and receipt printing for server-accepted attempts.
- Accepted discounted receipts display Royal Step, subtotal, promotion, discount, paid total, tender amounts, and 7Solutions / 03313621464.
- Existing offline full-price checkout, outbox and sync are unchanged. Discounted checkout requires online connectivity and login.
- No Prisma migration. Electron creates its local `discount_attempts` table on startup without touching existing tables.

## Installation
1. Backup project and Electron userData/pos.sqlite. Keep all existing unsynced sales.
2. Requires Milestones 32B and 32C API installed; this ZIP changes only `apps/pos-desktop`.
3. Extract into `G:\footwear-omnichannel` preserving paths. Merge local edits to the four modified files.
4. `cd G:\footwear-omnichannel`
5. `npm run build -w @footwear/pos-desktop`
6. Start with `$env:POS_USE_BUILT_UI="1"; npm run start -w @footwear/pos-desktop`.
7. By default the sandbox button is disabled. To test ONLY against a dedicated test database:
   `$env:VITE_ENABLE_DISCOUNT_SANDBOX="true"; npm run build -w @footwear/pos-desktop`
   then restart Electron. Remove the flag and rebuild before any live deployment.

## Test plan
- Full-price sale remains unchanged and syncs as before.
- Enter an active promotion and obtain HQ quote, then use test-only checkout. Verify accepted sale and stock deduction exactly once.
- Verify receipt subtotal minus discount equals total; tender amounts equal discounted total.
- For an unknown network response, attempt is marked UNKNOWN. Click 'Check server status' and verify server accepted/not found.
- A server-accepted UNKNOWN attempt can be recovered and printed.
- If not found, DO NOT charge again; reconcile manually. No automatic retry exists.
- Close and reopen Electron and verify attempts persist.
- Test a declined promo / price mismatch / stock shortage; no accepted sale.
- Run `npx tsc -p apps/api/tsconfig.json --noEmit` for previously installed API.

## Known restrictions and safety
- No card gateway capture, cash drawer, or proof of external payment. 'Accepted' means backend sale recorded, not that funds settled.
- A declined HTTP request is deliberately left UNKNOWN; do not re-use the button to create another sale without reconciliation.
- There is no atomic guarantee between server acceptance and local status update; recovery lookup mitigates but does not eliminate risk.
- No durable payment-intent gateway, supervisor overrides, automatic safe retry, or price-version snapshots.
- This is a sandbox prototype. Electron main/preload passed `node --check`; full Vite/TypeScript compilation and database integration were not performed in this environment.
