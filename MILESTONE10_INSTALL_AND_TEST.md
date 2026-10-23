# Milestone 10 integrated patch — installation and test guide

## Scope delivered
- POS: immediate sync attempt after local sale, 30-second retry, unauthorized-session pause and manual re-login, preservation of offline sales, clearer conflict messaging, split tender validation.
- API: branch inventory read endpoint, registered device and open-shift status endpoint, branch-oriented stock conflict message, UUID validation for localSaleId, safer advisory lock invocation.
- HQ: sales analytics API and an Analytics tab showing per-location accepted sales, stock conflicts, cash and card tender totals.
- Electron: restrictive CSP header for the POS main frame, existing navigation restriction retained.
- Existing receipt printing, shift close and returns backend remain intact.

## Not included / not claimed
- No new payment gateway integration: card is a recorded tender only.
- No new discount or tax engine, refund disbursement, cash-in/out ledger, or manager stock-conflict resolution UI.
- No database migrations; schema remains unchanged.
- Not tested against your actual Windows services. Run validation below before operational use.
- CSP and CORS policy may require tuning for custom API hosts; CSP allows localhost:3001 and 127.0.0.1:3001 only.

## Backup before installation (PowerShell)
1. Close the Electron POS, stop the API and web dev servers.
2. Copy the entire project to a separate backup directory. In particular, back up Electron userData/pos.sqlite, which is NOT in the project directory. To locate it, inspect Electron's `app.getPath('userData')` or Windows `%APPDATA%` for the application folder. Never delete this database.
3. Back up PostgreSQL using your existing credentials and normal pg_dump procedure. Do not reset schema or Docker volumes.

## Apply
From `G:\footwear-omnichannel`, expand this ZIP to the project root. The archive paths begin with `apps/` and contain only replacement source files and this guide. Do not extract into an extra nested directory.

```powershell
cd G:\footwear-omnichannel
Expand-Archive -Path "$env:USERPROFILE\Downloads\footwear-milestone10-integrated-patch.zip" -DestinationPath . -Force
```

Adjust ZIP path if you saved it elsewhere.

## Build and start
In separate PowerShell terminals:

```powershell
cd G:\footwear-omnichannel
npm run build -w @footwear/pos-desktop
$env:POS_USE_BUILT_UI = '1'
npm run start -w @footwear/pos-desktop
```

Start the API using the same working command you already use for NestJS (e.g. `npm run start:dev -w @footwear/api` if that script exists). Start the web console with its existing workspace command. Do not run migrations for this patch.

## API validation (use valid bearer token)
- `GET /api/v1/pos/devices/<device-uuid>/status` should return the registered branch and open shift.
- `GET /api/v1/inventory/branch-availability?locationId=<branch-uuid>` should report `onHand`, `quarantined`, `reservedOnline`, `reservedReplenish`, `safetyBuffer`, `sellable`.
- `GET /api/v1/hq/sales-analytics` requires SUPER_ADMIN and returns by-location accepted sales and tender totals.

## Safe test matrix
1. Use a test SKU with verified branch sellable quantity 2; quarantine 1 of 3 units.
2. Complete one cash sale offline; confirm PENDING and outbox persistence.
3. Sign in and sync; confirm ACCEPTED and exactly one stock decrement and one movement.
4. Sync same local sale again using same localSaleId: server must return duplicate=true without second stock deduction.
5. Create another sale that exceeds remaining stock; confirm STOCK_CONFLICT, no stock deduction, local record retained.
6. Simulate expired token: local sales remain queued and app asks for re-login, rather than repeatedly retrying every 30 seconds.
7. Sign in again and sync eligible pending sales.
8. Verify card reference and split tender validation; a reference is not a payment gateway authorization.
9. Confirm HQ Analytics tab shows accepted sales and cash/card breakdown, and excludes stock conflicts from gross.
10. Close shift only after all local sales on that shift are accepted/reconciled.
11. Check Electron DevTools console for CSP/CORS failures. If API is hosted on a non-local URL, configure an approved origin before deployment.

## Operational cautions
- The local sales database and its outbox must remain intact until reconciliation.
- Existing `STOCK_CONFLICT` sales are not automatically corrected or reprocessed.
- The POS currently cannot reliably prove to HQ that all local sales are synced before closing a shift; close only after explicit cashier reconciliation.
- Analytics endpoint is limited to 5,000 records per request and flags truncated results.
