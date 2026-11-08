# Milestone 18 — POS reconciliation and cashier accountability (UI patch)

## Scope
- Local shift transaction counts split by accepted, pending, and stock-conflicted sales.
- Fetch the central API shift summary on demand and compare its accepted totals with the locally computed totals.
- Prevent shift close with any local PENDING sale; require explicit cashier acknowledgment of STOCK_CONFLICT records before closing. Acknowledgment **does not resolve** conflicts or post sales to the server.
- Reset shift review and central summary when a new shift is opened or a shift closes.

## Installation
Back up `apps/pos-desktop/src/main.tsx` and your offline Electron database. Extract this ZIP at the project root. It replaces only the POS frontend file. No Prisma migration.

```powershell
cd G:\footwear-omnichannel
npx tsc -p apps/api/tsconfig.json --noEmit
npm run build -w @footwear/pos-desktop
$env:POS_USE_BUILT_UI = '1'
npm run start -w @footwear/pos-desktop
```

## Acceptance tests
1. Open an active shift; use **Fetch central shift summary** while authenticated. Check accepted cash/card totals.
2. Record a local offline sale. Verify PENDING count and that shift closure is blocked.
3. Sync an accepted sale and verify accepted count; central summary refreshes on demand.
4. Reproduce a STOCK_CONFLICT in a test branch. Verify the warning and required acknowledgment. Closing after acknowledgment is permitted only when no PENDING sales remain.
5. Enter counted cash; check the displayed variance. Close shift, then ensure shift ID is cleared and the next shift begins with a clean acknowledgment state.

## Important limitations
- This is a POS frontend reconciliation improvement, **not** a server-side manager approval or a durable exception-resolution workflow. Stock conflicts remain unresolved.
- Central summary is read-only and fetched manually. It is not a cryptographic proof that all offline sales reached the server.
- Cash payouts and returns are not incorporated in the local expected-cash calculation.
- This patch was assembled from the available Milestone 15 source; it has not been compiled against the user's latest local project.
