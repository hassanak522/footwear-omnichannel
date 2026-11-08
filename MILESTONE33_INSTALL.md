# Royal Step — Milestone 33: Payment Exception & Supervisor Review Foundation

## Purpose
A backend-only workflow to record uncertain POS payment/checkout outcomes, attach **references and notes** (not card data), and let managers review and resolve cases. This is an audit trail, NOT payment settlement, refund disbursement, or card capture.

## Included
- Prisma models `PaymentException` and `PaymentExceptionEvidence` with one case per `(deviceId,localSaleId)` and branch/status indexes.
- Role- and location-restricted REST controller.
- Open case with device/local sale ID, optional matching server sale ID, reported/observed amounts and reason.
- Add typed evidence (cash count, terminal receipt reference, bank reference, other) while case is open.
- List up to 100 cases per location, view details.
- Manager review transitions OPEN/UNDER_REVIEW -> UNDER_REVIEW/RESOLVED/VOIDED, with a required note and concurrent update protection.
- Closed cases are immutable. No automatic ledger changes or payment actions.

## Installation
1. **Backup** your code and PostgreSQL database, and preserve Electron offline POS userData.
2. This patch builds on your uploaded source and does not replace Milestones 32B, 32C or 32D. Extract ZIP into `G:\footwear-omnichannel`, retaining paths.
3. Run:
   ```
   cd G:\footwear-omnichannel
   npx prisma migrate dev --name payment_exception_workflow --schema packages/database/prisma/schema.prisma
   npx prisma generate --schema packages/database/prisma/schema.prisma
   npx tsc -p apps/api/tsconfig.json --noEmit
   npm run build -w @footwear/api
   ```
4. Restart API using your established command.
5. No POS UI or HQ UI is included in this milestone.

## Endpoints
- `POST /api/v1/payment-exceptions` (cashier/manager)
  `{ "locationId":"uuid", "deviceId":"uuid", "localSaleId":"uuid", "reason":"Terminal timeout after card authorization", "expectedAmount":4500, "observedAmount":4500 }`
- `GET /api/v1/payment-exceptions?locationId=uuid&status=OPEN`
- `GET /api/v1/payment-exceptions/:id`
- `POST /api/v1/payment-exceptions/:id/evidence`
  `{ "kind":"TERMINAL_RECEIPT", "reference":"terminal batch/reference only", "note":"Physical terminal slip retained in store safe" }`
- `PATCH /api/v1/payment-exceptions/:id/review` (manager only)
  `{ "status":"UNDER_REVIEW", "note":"Checking acquiring bank settlement" }`
  or `RESOLVED` / `VOIDED`.

## Restrictions
- The reviewer can resolve a case as a human workflow action; the API does NOT verify bank settlement.
- Do not enter PAN, CVV, account credentials, full card numbers or sensitive customer details in evidence fields.
- No automatic payment capture, cash ledger adjustment, refund or stock change.
- No automated API compilation or database integration tests were run in this environment.
- Existing checkout should remain sandbox-only for discounts until payment integration and acceptance testing.
