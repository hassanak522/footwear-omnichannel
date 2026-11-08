# Royal Step — Milestones 29B and 30B (safe incremental backend)

This patch builds on Milestone 28B customer-linked POS sale sync. It does **not** implement discount application, coupon redemption, or loyalty spending at checkout.

## Delivered
- Promotion **preview** endpoint: `GET /api/v1/checkout-foundation/promotion-preview?code=CODE&subtotal=1000.00`. Only ACTIVE, in-date PERCENT/FIXED definitions are eligible. The result is informational; it cannot be submitted as an authorized discount.
- Configurable loyalty **earning** for accepted customer-linked POS sales, inside the same transaction as stock movements and customer association. Set `LOYALTY_POINTS_PER_100_PKR` to an integer between 1 and 100 after HQ approves the policy. Default `0` means disabled. Formula: `floor(sale total in PKR / 100) * rate`.
- On approved merchandise return, automatically reverse earned points proportionally, using cumulative returned value and integer rounding. Multiple partial returns do not over-reverse points; a full return reverses the entire earned award.
- Existing local-sale idempotency and return idempotency keys remain in effect. No schema migration.

## Installation (Windows PowerShell)
1. **Install Milestone 28B first**, including its customer-linked sale sync, and verify the API compiles.
2. Back up `apps/api/src/pos.ts`, `apps/api/src/checkout-foundation.ts`, PostgreSQL and offline POS data.
3. Extract this ZIP to `G:\footwear-omnichannel`, preserving folder paths.
4. Run:
   ```powershell
   cd G:\footwear-omnichannel
   npx tsc -p apps/api/tsconfig.json --noEmit
   ```
5. Restart the API using your existing working `npm run dev -w @footwear/api` script.
6. To **enable** points after agreeing the policy, add `LOYALTY_POINTS_PER_100_PKR=1` to the API environment and restart. Leaving it unset keeps earning disabled. This is 1 point per PKR 100 of accepted sale value; no monetary redemption value is assigned.

## Tests
- Confirm `GET /api/v1/checkout-foundation/health` works with an authenticated manager.
- Create ACTIVE promotion through your existing admin process and preview it. A DRAFT promotion must not be eligible.
- With points disabled, accepted customer-linked sale earns 0 points.
- Enable rate 1. Accept a PKR 350 customer-linked sale: 3 points, once. Retry sync: no extra points.
- A sale without customer or with STOCK_CONFLICT earns no points.
- Fully return the sale: -3 points, once. Multiple partial returns should cumulatively reverse exactly 3 points.
- Verify customer balance with `GET /api/v1/checkout-foundation/loyalty?customerId=<uuid>`.
- Verify current offline POS, tender totals, shift closing and stock movements remain unchanged.

## Known limitations / critical caveats
- **Discount redemption and loyalty spending are deliberately disabled.** The current POS server trusts cashier-supplied unit prices and exact tender totals; applying a preview discount without an atomic price/discount/payment protocol would create accounting and abuse risks.
- Customer lookup/selection was implemented in Milestone 28B; this ZIP does not include that UI again.
- The points policy is a single global environment setting. If changed, historic awards retain their original amounts. Returns reverse the actual recorded award.
- Returns reflect merchandise refund value, not proof of payment settlement.
- The existing Prisma `PromotionRedemption` table remains unused by this patch.
- No TypeScript compilation or live integration testing was possible in this environment. Do not deploy to real cashier terminals before tests pass.

## Next engineering stage
Implement an immutable sale-pricing snapshot and server-side price validation, promotion authorization tied to device/localSaleId, a discount-aware offline outbox, an atomic checkout discount ledger and tender reconciliation, then controlled loyalty spending/reversal. This needs an integrated test environment and your final business rules (stacking, exclusions, points value, expiration, offline redemption policy).
