# Milestone 5 — HQ Reporting API (incremental patch)

Copy the `apps/api/src` files into the same paths in your existing footwear-omnichannel repository, replacing `module.ts`. Keep your existing schema and other code. This patch adds no migrations.

From the repository root (PowerShell):

```powershell
npm install
npm run db:generate
npm run dev -w @footwear/api
```

Authenticate via `POST http://localhost:3001/api/v1/auth/login`; send `Authorization: Bearer <JWT>` to the endpoints below. The user must have `SUPER_ADMIN` role.

- `GET /api/v1/hq/overview?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z` — current stock snapshot, POS gross accepted sales, stock conflicts, open shifts, in-transit transfers, approved return count, locations.
- `GET /api/v1/hq/overview?locationId=<UUID>` — same metrics scoped to one location.
- `GET /api/v1/hq/stock-by-location` — per-variant stock and availability by location. Optional `locationId` UUID.
- `GET /api/v1/hq/attention` — low availability, up to 100 open shifts, latest 100 stock conflicts, and up to 100 in-transit transfers.

**Definitions:** Available = onHand - reservedOnline - reservedReplenish - quarantined - safetyBuffer. Date `to` is exclusive, timestamps use UTC; date range is at most 366 days. Accepted POS sales are grouped by `soldAt` and exclude offline sales not yet synced. Gross sales are **not** net revenue and do not deduct returns or refunded payments. Return count is not a refund amount. Stock is current, not historical. Attention is an indicator, not a true reorder-point or age-based alert system.

**Limitations:** This milestone provides only reporting APIs; it does not create a visual HQ web dashboard, online order management, accounting, tender settlement, cash variance approval, real-time refresh, paginated export, or end-to-end tests. No DB-backed runtime test was performed. Validate against a development PostgreSQL database before production.
