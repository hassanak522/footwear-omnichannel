# Milestone 3 — Backend API (first working increment)

## Prerequisites
- Milestone 2 schema migrated and seed executed
- Node.js 20+ and PostgreSQL running

## Setup (PowerShell, from repository root)
```powershell
Copy-Item apps\api\.env.example apps\api\.env
# Replace JWT_SECRET in apps/api/.env with a random 32+ character value.
# Keep DATABASE_URL equal to packages/database/.env.
npm install
npm run db:generate
$env:DATABASE_URL='postgresql://footwear:footwear_local_only@localhost:5433/footwear_omnichannel?schema=public'
$env:ADMIN_EMAIL='admin@example.test'
$env:ADMIN_PASSWORD='ReplaceWithYourOwnLongUniquePassword123!'
npm exec -w @footwear/api -- tsx scripts/create-admin.ts
Remove-Item Env:ADMIN_PASSWORD
npm run dev -w @footwear/api
```

## Test endpoints
- `GET http://localhost:3001/api/v1/health` (public)
- `POST /api/v1/auth/login` with `{"email":"admin@example.test","password":"your-password"}`
- `GET /api/v1/inventory/locations` with `Authorization: Bearer TOKEN`
- `GET /api/v1/inventory/balances`
- `GET /api/v1/catalog/categories`, `GET /api/v1/catalog/products`
- `POST /api/v1/catalog/products`, `POST /api/v1/catalog/variants`
- `POST /api/v1/inventory/adjust`, `POST /api/v1/inventory/reserve`
- `POST /api/v1/inventory/reservations/:id/release`

## Known limitations / not production-ready
This increment is an API foundation, not the complete Milestone 3 feature set. Transfers, sales/consumption, warehouse procurement, expiry workers, full RBAC permission matrix, API tests, and robust request idempotency across every mutation remain pending. Never connect live POS sales or payment processing yet. The role codes in `@Roles` must match `packages/database/prisma/seed.ts`; inspect your seed if you changed them. Database CHECK constraints and deadlock/retry handling are not yet installed. Create admin only in local development. No default password is shipped.
