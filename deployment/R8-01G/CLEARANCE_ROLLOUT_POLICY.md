# R8-01G Clearance Checkout Rollout Policy

## Production state

Clearance checkout is disabled by default.

Railway API:
POS_CLEARANCE_CHECKOUT_ENABLED=false

Electron desktop build:
VITE_ENABLE_CLEARANCE_CHECKOUT=false

Do not enable either flag without explicit rollout approval.

## Deployment boundaries

1. GitHub main contains application source.
2. Vercel hosts the HQ web interface.
3. Railway hosts the NestJS API.
4. Electron desktop POS requires separate distribution.
5. A GitHub push does not automatically update installed POS terminals.

## Clearance transaction policy

- Online-only clearance checkout.
- Persistent UUID created before API submission.
- Server recalculates prices, discounts and stock.
- No offline clearance transaction queue.
- UNKNOWN transactions must not be resubmitted automatically.
- PREPARED transactions must be reconciled before retry.
- Missing server sale does not prove external payment failed.
- Receipts require server-confirmed accepted transactions.
- Unresolved clearance transactions block desktop shift closing.

## Production rollout prerequisites

- Confirm deployed API and desktop versions.
- Confirm required database migration was applied.
- Verify server-side allocation and receipt integrity.
- Verify shift reconciliation includes clearance tenders.
- Confirm card terminal/payment procedures.
- Confirm receipt printing on actual branch hardware.
- Confirm deployment rollback procedure.
- Obtain explicit production activation approval.

## Branch rollout

Recommended controlled sequence:

1. Internal development environment.
2. Dedicated QA terminal.
3. One supervised retail branch.
4. Remaining branches after approval.

Do not distribute a production-enabled installer until
the controlled rollout is authorized.

## Rollback

Disable POS_CLEARANCE_CHECKOUT_ENABLED on Railway.

Build and distribute the desktop application with
VITE_ENABLE_CLEARANCE_CHECKOUT=false.

Do not delete local clearance transaction ledgers.
Preserve unresolved transactions for reconciliation.
