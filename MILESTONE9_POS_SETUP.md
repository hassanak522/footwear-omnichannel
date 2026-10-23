# Milestone 9 — Branch POS onboarding and live-sale validation

This incremental patch improves the existing Electron desktop POS setup screen. After login, click **Load available branches**, choose the assigned branch, enter a unique uppercase device code, and click **Register this terminal**. The API returns a device UUID and the app saves it locally. Registration is restricted to SUPER_ADMIN and BRANCH_MANAGER. The branch and device become read-only once registered. Existing registered devices retain their saved configuration.

## Install

1. Back up the project and your POS local data before overwriting files.
2. Extract this ZIP at `G:\footwear-omnichannel` preserving directories.
3. Start PostgreSQL, API, and POS in separate PowerShell terminals:
   - `docker compose -f infra/docker/compose.yml up -d`
   - `npm run dev -w @footwear/api`
   - `npm run dev -w @footwear/pos-desktop`
4. Open **Setup & shift**, log in with an authorized account, load branches, select the destination branch, register this terminal (once), open a shift, and cache the catalog.
5. Sell one unit of a test SKU transferred to this branch, sync, and confirm the sale is ACCEPTED. Verify HQ branch on-hand decreased by exactly one and a POS SALE movement exists.
6. Test offline behavior by disconnecting the network *after caching the catalog and opening a shift*. Create a second test sale, reconnect, sync, and verify one central sale and one stock decrement. Do not retry stock-conflicted sales without reconciliation.
7. Count cash, ensure all local sales accepted, and close the shift. Review central shift summary. Cash variance is not yet fully reconciled server-side.

## Important limitations

- Existing device registration uses a saved device UUID, not cryptographic device authentication. Do not treat this as secure provisioning.
- Local sql.js data is not encrypted; do not deploy this build with sensitive production data.
- Offline POS can oversell; backend flags stock conflicts rather than silently allowing negative stock.
- No payment terminal capture is performed: card references are records, not payment authorization.
- Device code is unique. If an existing device is registered but local configuration was lost, ask an administrator to recover the device UUID from the PosDevice table rather than registering a duplicate.
- This patch was inspected for its API contract, but a full Electron build and live database integration test were not performed in this environment.
