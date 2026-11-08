# Royal Step Milestone 31B — online preflight (safe incremental step)

## Scope
This patch adds **online advisory checkout preflight** against the current HQ variant price and branch sellable stock, and a POS button to invoke it. It does not apply promotions, change sale totals, reserve stock, or redeem loyalty points. **This is not yet discounted checkout.**

## Install
1. Back up project, database and Electron offline POS database. Do not clear pending sales.
2. Extract into `G:\footwear-omnichannel`, preserving paths. API pos.ts is based on M31; POS main.tsx is based on M28B. **Merge any later local changes rather than overwriting.**
3. No Prisma migration.
4. `cd G:\footwear-omnichannel`
5. `npx tsc -p apps/api/tsconfig.json --noEmit`
6. `npm run build -w @footwear/pos-desktop`
7. Start API with the working script and POS with `$env:POS_USE_BUILT_UI="1"; npm run start -w @footwear/pos-desktop`.

## Test
- Log in, open a shift, add items, press **Check HQ prices and branch stock**.
- Correct prices and adequate stock should show a timestamped advisory pass.
- Change an HQ price and verify PRICE_CHANGED appears (do not complete a paid sale for this test).
- Insufficient stock should show INSUFFICIENT_SELLABLE_STOCK.
- Disconnect API: preflight should fail safely, without erasing the cart.
- Confirm existing local sale saving, syncing, customer linking and shift closing still work.

## Critical limitations
- Preflight is non-binding and subject to race conditions; not a guarantee of acceptance.
- Existing strict pricing rejects mismatches at sync, potentially after offline payment. Keep strict pricing disabled in live operation until manager reconciliation exists.
- No coupon redemption, discount-adjusted tenders, price-version snapshots, or loyalty spending yet. Those need a transaction schema and offline settlement design.
- Source patch is not compiled or integration-tested on your machine.
