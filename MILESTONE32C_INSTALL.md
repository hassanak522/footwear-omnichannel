# Royal Step Milestone 32C — discounted return allocation and recovery lookup

## What is implemented
- Existing `POST /api/v1/pos/returns` now calculates merchandise refund values from the **net discounted sale total** rather than gross unit prices when a promotion redemption exists.
- Deterministic largest-remainder allocation distributes discount cents across product variants; cumulative integer-cent division across returned units makes sequential partial returns add up to the original net sale amount.
- Existing non-discounted returns remain based on original sale unit prices.
- Loyalty return reversals use these net merchandise return values.
- New read-only `GET /api/v1/pos/checkout/discounted-status/:deviceId/:localSaleId` lets authorized cashiers/managers find the accepted sale after an uncertain API response. It returns status and discount information, or `found:false`.
- No schema changes.

## Installation
1. **Do not deploy to a live store yet.** Back up code, PostgreSQL, and the offline Electron POS database.
2. Install after Milestone 32B backend. This patch replaces `apps/api/src/pos.ts`, based on that version. Compare if you have local modifications.
3. `cd G:\footwear-omnichannel`
4. `npx tsc -p apps/api/tsconfig.json --noEmit`
5. `npm run build -w @footwear/api`
6. Start API using the existing `npm run dev -w @footwear/api` command.
7. No Prisma migration.

## Sandbox acceptance tests
- Create discounted test sale with two SKUs and different prices; return one SKU; sum of refund values across all returns should equal the discounted sale total.
- Test three units of one SKU with a one-cent allocated discount and return each unit separately; sum must equal the line's net paid value.
- Verify over-return and duplicate idempotency key are rejected or idempotently returned as before.
- Verify full-price sale returns have unchanged amounts.
- Call discounted-status with the device UUID and local sale UUID after successful checkout; verify `found:true`, amount, promotion code.
- Call status with a valid but unknown sale UUID; expect `found:false`.
- Verify a branch user cannot look up another branch's device.
- Verify no refund is disbursed automatically and no card capture occurs.

## Important restrictions
- **This is still a backend-only sandbox patch.** POS discounted checkout, receipt rendering, and robust durable recovery are not implemented.
- A read-only status lookup is NOT a durable local recovery queue; the cashier must persist checkout identifiers and avoid collecting payment again on uncertain responses.
- `PromotionRedemption` currently stores only aggregate discount, not an immutable per-line allocation snapshot. The algorithm reconstructs allocation from immutable sale lines and redemption amount; future migrations should store the original allocation explicitly.
- Existing refund register is an administrative workflow only; it does not disburse money.
- Returns are valued using merchandise allocation; taxes, shipping, service fees, mixed refund tender settlement, exchanges, and loyalty spending remain unsupported.
- No automated compilation or database integration testing was possible here; perform all acceptance tests before enabling any real discounted transactions.
