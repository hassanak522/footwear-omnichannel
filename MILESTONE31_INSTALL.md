# Milestone 31 — Secure pricing gate (first stage)

This patch is based on the Milestones 29B–30B `apps/api/src/pos.ts` and should be installed after that patch. **It is not the full discounts milestone.**

## What it adds
An opt-in strict price validation at the server: if `POS_STRICT_CATALOG_PRICING=true`, every synchronized sale line's unit price must equal the current centrally configured `ProductVariant.price` (in cents). A mismatch causes HTTP 409 and rolls back the transaction, preventing stock decrement, sale acceptance, and loyalty earning. This does not authorize promotions, loyalty spending, manual price overrides or discounts.

## Critical offline caveat
Offline POS catalog prices may become stale. An offline sale may have already collected payment. A mismatch will **reject** sync, so a manager must reconcile the sale/payment and refresh catalog. Do not retry with altered payload or reuse a local sale ID for a changed sale. Do not enable this policy on live branches until you have a documented exception/reconciliation process. Price versioning and signed quotes are still needed for robust offline checkout.

## Installation
1. Back up `apps/api/src/pos.ts`, PostgreSQL and the Electron offline database. Preserve unsynchronized sales.
2. Extract the ZIP into `G:\footwear-omnichannel` and overwrite only `apps/api/src/pos.ts`. If you've edited it since Milestones 29B–30B, merge the price validation block instead of overwriting.
3. No Prisma migration required.
4. Run `cd G:\footwear-omnichannel` then `npx tsc -p apps/api/tsconfig.json --noEmit`.
5. Restart API with its existing working script.
6. Default behavior is unchanged because `POS_STRICT_CATALOG_PRICING` is disabled when unset.

## Controlled test
- In a test branch with no pending real transactions, set `POS_STRICT_CATALOG_PRICING=true` in the API environment and restart.
- Sync a sale with matching catalog price; verify ACCEPTED, correct stock, and loyalty points if configured.
- Sync a test sale with an outdated/incorrect price; expect HTTP 409 and **no** accepted sale, stock movement, or loyalty award. Note the offline POS currently classifies this as a retryable error; avoid repeatedly retrying it.
- Turn strict pricing off after testing until your offline price-version and exception workflow is implemented.

## Remaining milestone 31 work
Price snapshots/versioning; explicit offline quote validity; cashier and manager price-override permissions; discount-inclusive totals/tenders; atomic promotion redemption; returns using actual discounted amounts; receipt discount display; POS 409 price-conflict handling. Do not activate coupons or loyalty redemption yet.

Patch archive integrity was checked. TypeScript compilation and live integration testing must be done locally.
