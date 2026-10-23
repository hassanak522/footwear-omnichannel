# Milestone 7 — Catalog creation UI

Apply this ZIP over your project root (`G:\footwear-omnichannel`), preserving paths. Back up the two existing files first.

## What changed
- POST `/api/v1/catalog/categories` for SUPER_ADMIN / ECOMMERCE_MANAGER.
- HQ Catalog tab now creates categories, products, and size/color variants through existing authenticated APIs.
- Catalog categories are loaded into the HQ interface.
- No database migration is needed.

## Start
1. Keep PostgreSQL running.
2. `npm run dev -w @footwear/api`
3. `npm run dev -w @footwear/web`
4. Open http://localhost:3000/admin, sign in, select Catalog.
5. Create category `Men` slug `men`, product `Classic Oxford` slug `classic-oxford`, variant SKU `OXF-BLK-42`, barcode `TEST-OXF-BLK-42`, size `42`, color `Black`, price `5999`.
6. Select Stock adjustment, choose Karachi Central Warehouse and the new SKU, delta `10`, reason `Initial test stock`.
7. Confirm stock appears in Stock tab and product in storefront.

## Verification
`npx tsc --noEmit -p apps/api/tsconfig.json`
`npm run build -w @footwear/web`

This patch has not been compiled against installed node_modules or exercised against a live database in this environment. Do not use test stock as real physical inventory. The adjustment endpoint is an audit adjustment, not a complete goods-receiving workflow.
