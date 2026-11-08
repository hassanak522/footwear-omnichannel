# M105–M107 verification package

Grounded in the uploaded footwear-omnichannel-c.zip source layout.

- **M105:** Authenticated role/branch isolation review.
- **M106:** Transaction/concurrency and idempotency review.
- **M107:** Finance reconciliation and durable audit review.

## Installation

Extract this folder to `G:\footwear-omnichannel\security-checks\M105_107` (preserve `RUN_M105_107.ps1`).

```powershell
& 'G:\footwear-omnichannel\security-checks\M105_107\RUN_M105_107.ps1' -Root 'G:\footwear-omnichannel' -Milestone ALL
```

Reports appear under `security-checks\M105_107\reports`. These are **static source checks**, not PASS/FAIL runtime verification. Do not use a production database for concurrency testing. Future authenticated tests require a dedicated staging database and assigned/other-branch test users; do not paste credentials into chat.

## Runtime test plan (manual, staging only)

| Milestone | Scenario | Expected |
|---|---|---|
| M105 | Cashier queries own branch sales | Allowed within role permissions |
| M105 | Cashier queries another branch sales | 403 or equivalent denial, no data leakage |
| M105 | Branch manager attempts warehouse-only stock adjustment | Denied |
| M105 | Signed-out finance requests | 401 (already evidenced in M100) |
| M106 | Two checkouts compete for last unit | At most one successful reservation/sale |
| M106 | Retry POS sync with same local sale ID | Exactly one sale and stock decrement |
| M106 | Repeat transfer receive action | No duplicate stock posting |
| M107 | Refund against a sale | Correct sale linkage, amounts and audit actor |
| M107 | Reconcile cash shift | Ledger/cash totals match source transactions |
| M107 | Unauthorized user reads audit events | Denied |

Evidence should include request/response status, redacted request IDs, test account role/branch, before/after DB counts, and any error traces. Do not treat static pattern presence as proof of correct behavior.
