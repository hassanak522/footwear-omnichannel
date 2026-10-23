# Footwear Omnichannel — Consolidated Development Platform

This is a **development-stage source repository**, not a production-ready or fully tested platform. It consolidates previous database, NestJS, transfers, POS and HQ milestones and adds a Next.js storefront, HQ console, online-order reservation and dispatch lifecycle.

## Modules included
- PostgreSQL + Prisma schema/seed: one Karachi warehouse and four branches, roles, products, variants, balances, reservations, transfers, POS, returns and online orders.
- NestJS API: JWT authentication, catalog, inventory, transfers, offline POS synchronization, HQ reports, public storefront catalog and COD checkout, online order management.
- Next.js: customer catalog/cart/COD checkout and authenticated HQ console for stock, orders, attention alerts, overview, catalog and adjustments.
- Electron POS: existing offline-first cashier application and local database.

## Windows PowerShell quick start
```powershell
# Extract the ZIP, then run in the extracted project root
npm install
Copy-Item packages/database/.env.example packages/database/.env
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/web/.env.example apps/web/.env.local
# Edit DATABASE_URL in packages/database/.env and apps/api/.env; edit JWT_SECRET in apps/api/.env
# Ensure Docker Desktop is running
docker compose -f infra/docker/compose.yml up -d
npm run db:generate
npm run db:migrate -- --name initial_full_platform
npm run db:seed
# Provision a super admin: see apps/api/README.md and apps/api/scripts/create-admin.ts
npm run dev -w @footwear/api
# Open another PowerShell terminal
npm run dev -w @footwear/web
# Optional desktop POS in a third terminal
npm run dev -w @footwear/pos-desktop
```
Open http://localhost:3000 for customers, http://localhost:3000/admin for HQ, http://localhost:3001/api/v1/health for API health. Ensure the database URL is accessible to both Prisma CLI and the API process. If your environment loads env files differently, set DATABASE_URL in your PowerShell session explicitly.

## Security / deployment boundaries
- COD only. CARD, EASYPAISA and JAZZCASH are **not integrated**; the API rejects them. No payment capture is claimed.
- Courier fields are manual; no Leopards booking/tracking integration exists yet.
- Storefront has no account login, order tracking, discount rules, shipping calculations, rate limiting or spam protection. Shipping fee is 0 as a placeholder.
- Online order cancellation is only possible before dispatch; after-dispatch returns/refunds are not implemented for online orders.
- POS offline database persistence is not encrypted; refunds, shift settlement, offline conflict recovery, hardware printer support and device security need hardening.
- HQ console currently requires SUPER_ADMIN for HQ reporting and does not cover every transfer or POS workflow.
- No automated integration/E2E test suite, verified production deployment, backups, payment settlement or tax configuration has been delivered. Run staging tests before any real sales.

## Inventory invariants
Checkout locks each warehouse SKU and creates ACTIVE online reservations. Dispatch consumes reservations and deducts warehouse on-hand stock, writing SALE movements. Cancellation releases reservations. Branch stock is separate; transfers and POS use existing backend workflows. A transaction serializable isolation level is used; production should also retry serialization failures and provide operational alerting.

## Suggested next engineering gates
1. Install and run `prisma validate`, `nest build`, `next build` and POS build; resolve issues against actual toolchain.
2. Add database-backed E2E tests for concurrent checkout, repeated keys, cancel/dispatch races, stock conflicts and transfer receipt.
3. Add payment provider server-to-server verification/webhooks, shipping service integrations, and refund ledger.
4. Add customer privacy/consent, rate limits, monitoring, backups, secrets management and deployment pipelines.
5. Finish branch-specific RBAC, richer POS reconciliation and dedicated warehouse UI.
