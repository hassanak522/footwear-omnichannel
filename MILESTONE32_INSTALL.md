# Royal Step Milestone 32A — Server-validated cart promotion quote

## What this patch does
- Uses **actual cart variants and quantities** to compute a server-catalog subtotal, checking branch sellable stock and price mismatches.
- Previews a currently ACTIVE percentage/fixed promotion (capped at subtotal).
- Shows the quote in desktop POS. Changes to the cart or promotion code invalidate the displayed quote.
- **Does not charge the discounted amount, authorize coupons, redeem points, or write promotion redemptions.** Existing sales and payment calculations remain unchanged.
- No database migration. Compatible with Milestone 31B and the M29B/30B backend patch.

## Install
1. Back up source and Electron offline sales data. Never delete pending POS sales.
2. Extract over `G:\footwear-omnichannel` preserving directories. Review diffs if local edits have been made to `apps/api/src/pos.ts` or `apps/pos-desktop/src/main.tsx`.
3. In PowerShell run:
   ```powershell
   cd G:\footwear-omnichannel
   npx tsc -p apps/api/tsconfig.json --noEmit
   npm run build -w @footwear/pos-desktop
   ```
4. Start the API with your existing working script. Start desktop POS using:
   ```powershell
   $env:POS_USE_BUILT_UI = "1"
   npm run start -w @footwear/pos-desktop
   ```
5. On an active shift, add items and request a promotion quote. Verify checkout continues to charge the **undiscounted** total.

## Test cases
- Active valid PERCENT and FIXED promotions; discount capped at subtotal.
- DRAFT, DISABLED, expired and nonexistent codes are ineligible.
- Mismatched cached POS prices or insufficient stock: quote flags issues and does not claim eligibility.
- Offline API failure: sale cart remains intact, standard offline checkout still works.
- Change quantity or promotion code: old quote disappears.
- Existing cash/card split, receipt and sales sync unchanged.

## Safety / next milestone
This is a preview-only safety stage. **Do not tell customers that a preview discount was applied.** The next stage must add persisted discount snapshots, exact settlement math, server-verified redemption and offline price-conflict resolution in a coordinated schema/API/Electron migration. The code has not been compiled against your local dependencies or integration-tested on your database.
