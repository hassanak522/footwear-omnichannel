# Royal Step — Milestone 36: Cash Drawer Reconciliation

## Prerequisites
Install Milestones 33–35 first. This patch is based on their schema/module and includes their declarations. Back up PostgreSQL, source, and Electron offline POS data before installation.

## Installation (PowerShell)
Extract this ZIP into G:\footwear-omnichannel, retaining directory paths. Merge local changes rather than overwriting customized files.

```powershell
cd G:\footwear-omnichannel
npx prisma migrate dev --name cash_reconciliation --schema packages/database/prisma/schema.prisma
npx prisma generate --schema packages/database/prisma/schema.prisma
npx tsc -p apps/api/tsconfig.json --noEmit
npm run build -w @footwear/api
```

No changes to Electron offline sales or web UI.

## API
- POST `/api/v1/cash-reconciliation/submit` with `{ "shiftId": "UUID", "countedCash": 4000.00, "note": "Drawer counted at close" }`.
- GET `/api/v1/cash-reconciliation?locationId=UUID`.
- GET `/api/v1/cash-reconciliation/:id`.
- PATCH `/api/v1/cash-reconciliation/:id/review` with `{ "status": "APPROVED", "note": "Physical count reviewed" }` or `DISPUTED` (manager only).

## Business rules
- One reconciliation per CLOSED shift; the shift must already have closingCash recorded.
- Expected drawer = shift opening cash + CASH tenders from centrally ACCEPTED POS sales assigned to the shift.
- Variance = counted cash - expected cash.
- Submitted snapshots are immutable; managers may approve or dispute with a note. Cashiers can only submit their own shifts and see their own submissions.
- Reconciliation does not modify inventory, shifts, sales, payments, or bank balances.

## Limitations — important
- Cash refunds, paid-outs, cash-ins, deposits, tips, and drawer transfers are NOT included in expected drawer; variances are therefore indicative, not a certified accounting balance.
- The submitted `countedCash` is a separately entered count and may differ from the `closingCash` already saved on the shift; both should be investigated if inconsistent.
- Offline sales synchronized after submission are not reflected in the immutable snapshot. Do not approve final cash reconciliation until offline sync is complete.
- This is a backend milestone; HQ dashboard and bank settlement imports are later work.
- The archive is checked for integrity; API compilation and database integration have not been run in this environment.
