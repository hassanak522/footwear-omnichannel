# Royal Step Milestones 19–21 — incremental patch

## Included
- M19: manager POS shift/stock-conflict review dashboard, branch-scoped API, append-only audit review records. Review **does not** accept/reverse conflicted sales or alter inventory.
- M20: replenishment approval/link-to-transfer/refresh interface, supplier/PO/partial receipt/stock-count interface (single-SKU forms; existing API supports multi-line operations).
- M21: customer phone lookup, creation and marketing consent. **Customer-linked sales history, returns/exchanges and loyalty are not implemented** because the current schema and POS flow do not safely associate sales with customer IDs.

## Install
1. Back up the project, PostgreSQL and Electron offline POS data. Do not reset migrations or delete POS data.
2. Extract this archive into `G:\footwear-omnichannel`, preserving paths. It updates `apps/api/src/module.ts` and adds two new files. This `module.ts` is based on Milestone 15, retaining its controller registrations.
3. Run from project root:
   `npx tsc -p apps/api/tsconfig.json --noEmit`
   `npm run build -w @footwear/web`
4. Use `npm run --workspace=@footwear/api` to identify the API start script, then run it. Start Next.js with your existing web command.
5. Visit `http://localhost:3000/admin/advanced`. Log in with an authorized HQ/branch manager account.
6. No Prisma migration required. New API controller: `/api/v1/pos-review` (assuming your existing global API prefix).

## Acceptance tests
- HQ sees shifts and conflicts across locations; branch manager only sees assigned locations.
- Manager review creates an audit entry without changing sale status or stock.
- Replenishment: REQUESTED -> approve -> create-transfer -> transfer dispatch/receipt using existing transfer workflow -> refresh-status. Repeat create-transfer must fail.
- PO: create supplier, create PO, receive good and damaged quantities, repeat partial receipt, ensure no over-receipt and damaged units quarantined.
- Count: create count, post once, reject stale counts and double posting.
- Customers: search by phone, add with consent off by default, verify consent opt-in.

## Caveats
- Not compiled or tested against the user's current local repository; API and web builds must pass before use.
- Manager review is an audit acknowledgment, **not** a financial approval or conflict settlement.
- Branch transfer dispatch/receipt screens, customer-linked returns/exchanges and loyalty remain future work.
- No payment gateway or tax-compliance changes are made.
