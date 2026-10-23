# Milestone 4 consolidated POS upgrade (development)

## Scope
Adds Windows print-dialog receipts for locally saved POS sales, a manager-only centrally accepted sale return endpoint with partial quantities and quarantine support, and a central shift summary endpoint. This is **not** a refund-processing or exchange workflow. No money is returned by the API. Device credentials, offline encryption, hardware integration, and financial reconciliation remain unfinished.

## Before applying
1. Back up the whole repository and database. Ensure earlier Milestone 3 POS backend and Milestone 4 split-payment patch are already installed.
2. Compare the supplied files with your current code. Merge, do not overwrite customized files blindly.
3. Do not run this against production or live store data.

## Apply
From the project root on Windows PowerShell:

```powershell
npm install
npm run db:generate
npm run db:migrate -- --name pos_returns
npm run db:generate
npm run dev -w @footwear/api
```

In a separate terminal:

```powershell
npm run build -w @footwear/pos-desktop
npm run dev -w @footwear/pos-desktop
```

## API
`GET /api/v1/pos/shifts/{shiftId}/summary` (cashier, branch manager, super admin)
`POST /api/v1/pos/returns` (branch manager, super admin)

Example request body for POST /returns:

```json
{
  "saleId": "ORIGINAL_ACCEPTED_SALE_UUID",
  "idempotencyKey": "return-unique-2026-0001",
  "reason": "Customer returned unworn shoes, size issue",
  "lines": [{"variantId":"ORIGINAL_VARIANT_UUID","quantity":1,"quarantined":false}]
}
```

Use the same JWT authorization header as other API calls. Repeated return keys refer to the same recorded return; always generate a new key for a new return. The endpoint records an approved **merchandise return**, not a completed monetary refund.

## Receipt printing
Open POS > Sales & sync > Print for a locally stored sale. Uses the Windows print dialog; test your specific receipt printer, paper size and drivers. Receipt displays local sync status; a pending receipt is **not** confirmation that the central API accepted the sale.

## Mandatory acceptance checks
- Partial return increases branch on-hand only for the original sale location.
- Quarantined returns increase both on-hand and quarantined; sellable stock stays unchanged.
- Return exceeding sold-minus-previously-returned quantity fails.
- Branch manager cannot return another branch's sale.
- Duplicate return key does not increment inventory again.
- Shift summary matches centrally accepted tenders, not unsynced local sales.
- Receipt printing cancellation does not change sale status.

## Not production-ready
Do not use for actual customer refunds: no gateway/card/cash refund accounting or refund ledger is implemented. No secure per-device auth, encrypted SQLite, real offline stock enforcement, printer hardware support, exchange workflow, signed installer, or automated integration tests are included. Central shift summary excludes returns and cash payouts and is not final financial reconciliation.
