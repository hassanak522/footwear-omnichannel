# Royal Step production deployment checklist

This checklist is a release gate, not evidence that the application is production-ready.

## Required environment

- Run PostgreSQL with durable volumes, daily backups and tested point-in-time recovery. Never run destructive Prisma reset commands on real store data.
- Set `NODE_ENV=production`, `DATABASE_URL`, and a unique cryptographically random `JWT_SECRET` of at least 32 characters in the API secret manager. Never commit secrets.
- Set `CORS_ORIGIN` to a comma-separated allowlist of exact deployed web origins, for example `https://shop.example.com,https://hq.example.com`. Do not use `*`.
- Set `NEXT_PUBLIC_API_URL` to the externally reachable HTTPS API base URL ending in `/api/v1`.
- Place the API behind HTTPS/TLS termination, restrict direct database access, configure network/firewall rules, and use separate staging and production credentials.
- Run reviewed migrations using `prisma migrate deploy` as a controlled deployment step; back up the database first.
- Deploy the Next.js web app and NestJS API with restart policies, health monitoring, centralized logs and alerts.

## Release verification

1. Ensure GitHub build checks pass for the exact release commit.
2. Run `node scripts/smoke.mjs` against staging with `API_BASE_URL`. Set `SMOKE_EMAIL` and `SMOKE_PASSWORD` for read-only authenticated checks.
3. Test real user roles: super admin, warehouse manager, branch manager, cashier, and unauthenticated shopper. Verify denied cross-branch access.
4. Test transfer lifecycle: requested, approved/reserved, dispatched, received with good/damaged/missing quantities; inspect stock movement and audit records.
5. Test supplier receiving, physical counts, and concurrent updates without negative sellable inventory.
6. Test offline POS: create sales without internet, restart Electron, reconnect and sync exactly once. Resolve stock conflicts before closing shifts.
7. Test online checkout retries, order cancellation, stock reservation and delivery transitions.
8. Test returns against original sales, repeated idempotency keys and quarantine accounting. Refund disbursement and exchanges require separate operational procedures until implemented.
9. Validate phone/customer matching, consent controls and restricted access to CRM data.
10. Perform accessibility, responsive layout, browser, receipt printer, barcode scanner and branch-device acceptance testing.

## Known launch blockers

- Shipping is currently a placeholder; configure and validate a real shipping/tax policy before accepting live orders.
- Full refund settlement and exchanges are not automated.
- POS sales are not linked to CRM customer records; loyalty points and rewards are not implemented.
- Finance analytics show gross accepted POS sales, not net profit or a general ledger.
- A successful compile does not replace staging integration, security or disaster recovery testing.
