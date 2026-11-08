# Royal Step Milestones 39–41 — HQ Finance Controls, Manual Journal, Reporting

## Included
- 39: HQ finance page at `/admin/finance-controls`: branch/date selection, movement submissions and approvals, imported settlement batch list, exception summary.
- 40: Balanced **manual** double-entry journal backend. A journal has 2–50 lines; every line must have exactly one positive debit or credit; total debits must equal credits to the cent. Globally unique `externalKey` prevents duplicate posts. Managers can reverse (exclude) a journal with a reason; original lines remain immutable. No automatic POS, inventory, bank or cash posting.
- 41: UTC date-filtered, branch-scoped dashboard API for movement counts and adjustments, settlement statement totals, match states, exception counts, posted manual journal account balances; CSV export of displayed account balances.

## Important prerequisite: unresolved migration drift
Your previous output showed nine migrations applied to PostgreSQL but absent locally, and TypeScript errors in `payment-reports.ts` and `pos.ts`. **Do not run `prisma migrate reset` or `prisma migrate dev` while the drift remains.** Restore the exact nine missing migration directories from a trusted original backup/Git history first. Do not invent empty migrations or mark them resolved to hide the drift. Backup PostgreSQL before any migration.

This ZIP contains a full Prisma schema **based on the Milestones 37–38 patch** plus the two new journal models. It is NOT a replacement for your missing migration history. Compare it with your currently installed schema before copying; if your current schema contains additional models, merge the appended `FinanceJournalStatus`, `FinanceJournal`, and `FinanceJournalLine` definitions instead of overwriting it.

## Installation (source staging only until migration history is repaired)
1. Back up `G:\footwear-omnichannel` and PostgreSQL; preserve Electron offline userData.
2. Merge/extract files into the project; do not overwrite customized Prisma schema or `module.ts` blindly.
3. Ensure Milestones 33–38 are installed and previous TypeScript errors fixed.
4. Once migration history is fully restored and `npx prisma migrate status --schema packages/database/prisma/schema.prisma` shows no missing applied migrations, run:
   ```powershell
   cd G:\footwear-omnichannel
   npx prisma migrate dev --name finance_manual_journals --schema packages/database/prisma/schema.prisma
   npx prisma generate --schema packages/database/prisma/schema.prisma
   npx tsc -p apps/api/tsconfig.json --noEmit
   npm run build -w @footwear/api
   npm run build -w @footwear/web
   ```
5. Access `/admin/finance-controls` on your HQ web app.

## APIs
- `POST /api/v1/finance-management/journals` body `{locationId,externalKey,description,sourceType,sourceId?,lines:[{accountCode,description?,debit,credit},...]}`
- `GET /api/v1/finance-management/journals?locationId=UUID`
- `POST /api/v1/finance-management/journals/:id/reverse` body `{reason}`
- `GET /api/v1/finance-management/dashboard?locationId=UUID&from=YYYY-MM-DD&to=YYYY-MM-DD`

All require JWT and manager role with branch scope. Dates are UTC and limited to 31 days. Dashboard aggregates are capped only by database load, so use sensible periods.

## Limitations and verification
- **No real profit/loss, cash flow statement, inventory COGS, automated tax postings, or bank confirmation.** A chart of accounts and posting rules must be defined before production accounting.
- Reversing a journal changes its status and removes it from displayed posted balances; it does not create a compensating accounting entry. This is a prototype, not an immutable general ledger compliant with accounting audit standards.
- The settlement list is read-only on this page; statement import and matching remain in Milestone 38 API.
- The ZIP archive integrity was verified. No dependency-installed TypeScript build, Prisma migration, or end-to-end integration test was completed in this environment.
