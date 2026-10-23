# Milestone 6 — Checkout retry safety and API smoke checks

This is an incremental **development** release, not a production certification.

## What changed

- The storefront retains the same idempotency key when an identical checkout is retried after a network failure. It changes the key when customer/cart details change and clears it after a successful order. This reduces accidental duplicate orders on retry; it does not provide persistent recovery after a browser reload.
- Added `npm run smoke`, a non-mutating HTTP smoke-check runner for health, catalog, unauthorized endpoint protection and invalid-login rejection.
- Optional authenticated smoke checks for HQ overview, stock and attention (use SUPER_ADMIN credentials).
- Includes the three previously issued TypeScript corrections.

## Local instructions (PowerShell)

From the project root:

```powershell
npm install
npm run db:generate
npm run dev -w @footwear/api
```

In a **second** PowerShell terminal:

```powershell
npm run smoke
```

To also test HQ endpoints:

```powershell
$env:SMOKE_EMAIL='your-admin-email@example.com'
$env:SMOKE_PASSWORD='your-admin-password'
npm run smoke
Remove-Item Env:SMOKE_PASSWORD
Remove-Item Env:SMOKE_EMAIL
```

The smoke runner makes no checkout, inventory, return or transfer changes. Never use real customer credentials or a production environment for these checks.

Then run:

```powershell
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/pos-desktop/tsconfig.json
npm run build -w @footwear/web
```

## Known gaps before production

- Full end-to-end database tests with concurrent checkout, transfer and offline POS conflict scenarios.
- Real courier and payment integrations; refund settlement and financial reconciliation.
- POS data encryption, backup/recovery, offline device identity and conflict workflows.
- Checkout idempotency recovery across browser reloads and order lookup.
- Deployment, secrets management, observability, rate limiting, security and performance review.

## Validation performed in this environment

- `node --check scripts/smoke.mjs` passed.
- Full dependency installation timed out; no running database or HTTP server was available, so smoke checks and TypeScript builds have **not** been executed successfully here.
