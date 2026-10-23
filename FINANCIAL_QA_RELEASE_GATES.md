# Royal Step financial workflow release gates

## Implemented on the feature branch
- POS and online refund settlements are **records of externally completed payouts**, not disbursement instructions.
- API services cap payouts against approved return amounts and serialize competing writes.
- PostgreSQL refund triggers enforce cumulative approved-amount caps on insert and update, independently of API code.
- Online returns reverse earned loyalty points proportionally and refuse to reverse already-spent balances.
- Loyalty redemptions are admin-only, audited, idempotent, and disabled by default with `LOYALTY_REDEMPTION_ENABLED=false`.
- HQ reports distinguish activity-period payouts from lifetime unpaid refund liabilities.

## Automated verification
- GitHub Actions builds the API, web and POS; deploys Prisma migrations into PostgreSQL 16; checks database constraints and index structure.
- `scripts/verify-retail-db.mjs` runs rollback-only invalid data probes, SQL query compilation, an advisory-lock contention test, and a real online refund fixture that intentionally exceeds the approved return amount.
- `scripts/smoke.mjs` checks unauthorized financial endpoint access.

## Still required before production release
1. All CI workflows for the final commit must pass. Investigate and fix any failed migration, test, or build.
2. Exercise actual NestJS refund and return endpoints with seeded PostgreSQL fixtures, including simultaneous requests, retries, partial returns, damaged stock, and failed payment references.
3. Confirm return/refund financial policies with the retailer: taxes, shipping, COD collected, customer payment verification, exchange netting, and who can confirm external payouts.
4. Choose the value of one point in PKR, minimum redemption, maximum discount, expiry, and refund clawback policy. Until approved, **do not** apply loyalty points to POS or online checkout.
5. Run supervised UAT on warehouse, branch, POS offline synchronization, online checkout, returns, and payout reconciliation. Verify backup/restore, audit log retention, and deployment secrets.

Do not treat a green compile or migration test as proof of production financial correctness.
