# Royal Step Milestones 16–17 — Operational workflows

## Scope
- M16: Approved replenishment requests can be converted into **exactly one** linked stock transfer. Source manager then approves and dispatches through the existing transfer endpoints; destination manager receives. A status refresh marks the request FULFILLED only after a full, undamaged receipt of the requested quantity. Partial/damaged receipts stay APPROVED for manual review; no stock is silently invented.
- M17: Purchase orders can be received in **multiple deliveries**, including good and damaged units. Damaged units are added to on-hand and quarantined, not sellable. Receipt events are individually recorded with UUIDs, and orders remain SUBMITTED until all ordered units arrive.

## Installation (after Milestone 15)
1. Back up source, database, and offline POS database; close Electron. Never reset Prisma or delete Docker volumes.
2. Extract patch at `G:\footwear-omnichannel` and allow replacement of the two API files.
3. No Prisma schema migration is required.
4. From project root, run:

```powershell
npx tsc -p apps/api/tsconfig.json --noEmit
npm run start:dev -w @footwear/api
```

## API workflow
All routes below use the existing `/api/v1` prefix and JWT authentication.

1. Branch POST `/replenishment/requests` (existing).
2. Source manager POST `/replenishment/requests/:id/approve` (existing).
3. Source manager POST `/replenishment/requests/:id/create-transfer` (new). Returns linked transfer ID. Calling twice returns 409.
4. Source manager POST `/transfers/:id/approve` with `{ "idempotencyKey": "unique-key-123" }`, then POST `/transfers/:id/dispatch` with another key.
5. Destination manager POST `/transfers/:id/receive` with `{ "idempotencyKey":"unique-key-456", "items":[{"variantId":"UUID","receivedQty":2,"damagedQty":0}] }`.
6. POST `/replenishment/requests/:id/refresh-status` (new). Only marks FULFILLED if transfer status RECEIVED and good received units meet requested quantity.

Purchasing: POST `/purchasing/orders/:id/receive` with `{ "lines":[{"variantId":"UUID","quantity":2,"damaged":1}] }`. Repeat with the remaining quantity on a subsequent delivery. Do not replay a receipt request after a network timeout without checking the purchase order and stock movements first: this endpoint does not yet accept a client idempotency key.

## Limitations
- These are **backend workflow enhancements**, not new HQ/branch screens.
- Milestone 18 (shift and POS reconciliation) is not included in this patch.
- Transfer status refresh is explicit, not triggered automatically.
- Partial or damaged linked replenishment receipts require manual exception handling.
- Receipt retries after a timeout require operator verification to prevent duplicate posting.
- Source compilation and live database tests must be performed on your installation; this patch is not production certified.

## Tests
- Approved request → linked transfer → dispatch → full receipt → refresh → FULFILLED.
- Second create-transfer request → 409; no second transfer.
- Purchase 5 units: receive 2 good + 1 damaged, then 2 good. Order remains SUBMITTED after first receipt and RECEIVED after second; damaged stock stays quarantined.
- Attempt to receive 1 additional unit after completion → 409.
- Unauthorized branch attempts linked-transfer creation → 403.
