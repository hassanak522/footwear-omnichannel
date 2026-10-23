# Milestone 8 — Branch Transfers

This is an incremental patch on top of Milestone 7. Copy the two included files into the corresponding paths in your existing project. **Do not replace the whole project.**

## Fixes
- Converts PostgreSQL advisory-lock query results to text to avoid Prisma `void` deserialization errors across inventory, online orders, POS and transfers.
- Adds HQ transfer request, approval, dispatch, and receipt forms.
- Receipt supports good and damaged quantities, with backend quarantine handling.

## Install
1. Back up your project. Extract this ZIP into `G:\footwear-omnichannel`, preserving paths.
2. Restart API and web app. No database migration required.
3. `npx tsc --noEmit -p apps/api/tsconfig.json`
4. `npm run build -w @footwear/web`
5. Visit `http://localhost:3000/admin`, Transfers.

## Test with 10 warehouse units
- Confirm warehouse has 10 available units for test SKU.
- Request 3 units for one branch.
- Approve: warehouse onHand remains 10, reservedReplenish increases by 3.
- Dispatch: warehouse onHand becomes 7 and reservedReplenish decreases by 3.
- Receive 3 good: branch onHand increases by 3.
- Confirm ledger movements and HQ Stock tab.

## Known limitations
- Transfer creation UI supports one SKU per request; API supports multiple SKUs.
- Missing units become PARTIALLY_RECEIVED; discrepancy resolution is not yet implemented.
- No barcode scanning, carrier proof, or approvals policy configuration yet.
- Requests use fresh idempotency keys; avoid double clicking or retrying after ambiguous network errors until checking transfer history.
- Compilation and integration must be verified in your Windows environment.
