# Royal Step Milestones 25–27 (incremental development)

## Scope
- **25**: Link an existing accepted POS sale to a customer. View a customer's linked sales. Link is immutable; correction requires a future supervised workflow.
- **26**: Create one refund request per approved merchandise return. HQ admin can approve it and mark it paid *after external settlement*. No payment gateway/cash disbursement is executed.
- **27**: Create and list DRAFT promotion definitions. **Promotions are not activated or applied to pricing**. No loyalty points or automatic discounts.

## Files and prerequisites
Requires Milestones 15–24. The schema is based on Milestone 15 (which includes M12–14 models). If you have edited schema.prisma locally, **merge the three new models and two enums instead of overwriting your schema**.
The API module is based on the Milestones 22–24 module. If locally customized, merge `CustomerFinanceController` import and controller registration.
No changes to existing POS sale processing, inventory balances, or existing order totals.

## Install (Windows PowerShell)
1. Back up project, PostgreSQL and offline POS data. Do not reset migrations.
2. Extract into `G:\footwear-omnichannel`, preserving paths.
3. `cd G:\footwear-omnichannel`
4. `npx prisma validate --schema packages/database/prisma/schema.prisma`
5. `npm run db:generate`
6. `cd packages\database`
7. `npx prisma migrate dev --name m25_m27_customer_finance --create-only`
8. Review generated migration SQL. Stop if prompted to reset or if migration drift is reported.
9. `npx prisma migrate dev`
10. `cd ..\..`
11. `npx tsc -p apps/api/tsconfig.json --noEmit`
12. `npm run build -w @footwear/web`
13. Start API using the **existing working** script (`npm run --workspace=@footwear/api` to list).
14. Start web with its existing script; open `http://localhost:3000/admin/customer-finance`.

## Test checklist
- Link an ACCEPTED sale to an existing customer. Duplicate same-customer link is idempotent. Different-customer link is rejected.
- Branch manager cannot link sales outside assigned locations; cannot view other branches' sales.
- Create refund request for a return; second request for the same return must fail.
- Only SUPER_ADMIN can approve and mark refund paid. Mark-paid requires an external reference.
- Draft promotion validation: end after start, PERCENT <= 100, unique code.
- Existing online checkout and POS must continue to use existing prices; promotions are inert.

## Limitations
This patch is an incremental, **uncompiled** source update. It is not production tested. The refund register is not financial accounting, and there is no refund gateway integration. Customer-sale linking is manual and uses UUIDs; cashier lookup and customer selection during checkout are future work. Promotion engine and loyalty points are not implemented.
