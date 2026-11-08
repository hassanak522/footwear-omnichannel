# Royal Step — Milestones 37–38

**Milestone 37:** Drawer movement register and manager approval. **Milestone 38:** Manual settlement statement import, candidate matching and finance review. Backend-only; no HQ/POS UI changes.

## Prerequisites
Install Milestones 33–36 first. This ZIP's `schema.prisma` and `module.ts` are based on Milestone 36 and preserve earlier milestone declarations. If you have made subsequent schema/module edits, merge carefully rather than overwriting them. Back up PostgreSQL and your code first; preserve Electron offline POS data.

## Installation (PowerShell)

```powershell
cd G:\footwear-omnichannel
npx prisma migrate dev --name drawer_movements_and_settlement_imports --schema packages/database/prisma/schema.prisma
npx prisma generate --schema packages/database/prisma/schema.prisma
npx tsc -p apps/api/tsconfig.json --noEmit
npm run build -w @footwear/api
```

If the compile fails, stop and fix the error before restarting the API. Do not use `prisma migrate reset`.

## Milestone 37 API

- `POST /api/v1/drawer-movements`: `{ "shiftId":"uuid", "type":"CASH_OUT", "amount":250, "reason":"Approved store supplies", "externalReference":"V-123" }`. Requires OPEN shift; cashier can submit only on own shift; manager may submit for branch.
- `GET /api/v1/drawer-movements?locationId=uuid&shiftId=uuid` (last 200).
- `PATCH /api/v1/drawer-movements/:id/review`: `{ "status":"APPROVED", "note":"Receipt checked" }` or `REJECTED` (manager).
- `GET /api/v1/drawer-movements/shift/:shiftId/summary`: approved movement adjustment and a separate informational expected-cash adjustment against Milestone 36 snapshot.

Movement type values: `CASH_IN`, `CASH_OUT`, `PETTY_CASH`, `CASH_REFUND`, `BANK_DEPOSIT`. Movements are PENDING until manager approval. Historical cash reconciliation snapshots are **not rewritten**. This does **not** disburse refunds, post bank deposits, or adjust physical cash automatically.

## Milestone 38 API

- `POST /api/v1/settlements/import` with:

```json
{
 "locationId":"uuid", "provider":"Card Terminal Provider", "statementReference":"STMT-2026-001", "statementDate":"2026-10-27T00:00:00Z",
 "entries":[{"externalId":"txn-001", "terminalReference":"POS-REF-001", "grossAmount":4500, "feeAmount":90, "netAmount":4410}]
}
```

- `GET /api/v1/settlements?locationId=uuid`
- `GET /api/v1/settlements/:id`
- `GET /api/v1/settlements/:id/match-preview`: suggests candidates from ACCEPTED card tenders with identical reference and gross amount; multiple candidates marked AMBIGUOUS.
- `PATCH /api/v1/settlements/entries/:entryId/review` with `{ "status":"MATCHED", "matchedTenderId":"uuid", "note":"Reference and amount checked" }`, or `UNMATCHED` / `AMBIGUOUS` / `DISPUTED` without tender ID.

Only managers can import and review settlements. Duplicate statement and external IDs are rejected. A matched tender cannot be matched twice. Imported statements are evidence supplied by staff, **not independently authenticated bank data**. No bank integration, auto-settlement, card capture, CSV upload, or accounting journal posting is included.

## Future work / integration risks

- Cash movements currently affect only a supplementary summary. They do not retroactively change Milestone 36's immutable `expectedCash` / `variance` snapshots.
- Refund payouts and deposits must be verified by an external payment/bank workflow before treating them as settled.
- Settlement matching uses reference + amount, not provider transaction ID, and therefore may have false candidates; review manually.
- A full accounting ledger, adjustment journal, HQ screens and CSV parser are future milestones.
- This patch was packaged and its ZIP integrity verified. API compilation, migration and integration tests have **not** been run in this environment. Install as development code, not as a verified production release.
