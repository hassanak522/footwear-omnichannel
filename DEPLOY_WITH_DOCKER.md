# Royal Step container deployment

This repository includes container build and orchestration configuration; it is **not** evidence of a completed production deployment. Run this on a Linux host with Docker Compose, HTTPS reverse proxy, domain names, and backup/restore procedures.

## Before starting
1. Create `infra/docker/.env.production` from `infra/docker/.env.production.example`; replace all example credentials and domains. Use a secret manager or restrict file permissions. The database password in `DATABASE_URL` must match `POSTGRES_PASSWORD` (URL-encode reserved characters).
2. Configure DNS and a TLS reverse proxy: public web domain routes to the `web` service on port 3000; public API domain routes to `api` on port 3001. Connect the proxy to the Compose `edge` network. The Compose file deliberately does not expose unencrypted public ports.
3. Take a verified backup before every migration. Do **not** use `prisma migrate reset` against customer data.
4. Approve the COD shipping charge and all checkout/refund operational policies. Leave `LOYALTY_REDEMPTION_ENABLED=false` until the point-value and refund clawback workflow are approved.

## Deploy
Run from the repository root:

```sh
docker compose --env-file infra/docker/.env.production -f infra/docker/compose.production.yml config
docker compose --env-file infra/docker/.env.production -f infra/docker/compose.production.yml build
docker compose --env-file infra/docker/.env.production -f infra/docker/compose.production.yml up -d
```

The one-shot `migrate` service must exit successfully before the API starts. Use `docker compose ... ps -a` and `docker compose ... logs migrate api web` to investigate errors. Test `https://api.example.com/api/v1/health` through your actual TLS proxy.

## Optional built-in HTTPS reverse proxy
Set WEB_DOMAIN and API_DOMAIN to real DNS names pointing at your server. If ports 80/443 are available, start the Caddy overlay using `docker compose --env-file infra/docker/.env.production -f infra/docker/compose.production.yml -f infra/docker/compose.proxy.yml up -d --build`. Caddy can obtain certificates automatically once DNS and firewall routing are correct. Do not run this alongside an existing proxy on the same ports.

## Database backup operations
The repository includes `infra/docker/backup-postgres.sh` to produce a PostgreSQL custom-format archive. Run it within the database container with `BACKUP_DIR` set to a securely mounted backup directory. Backups must be encrypted, copied off-host, scheduled, and periodically restored to a disposable staging database. An archive listing check is not a substitute for restore testing.

## Release acceptance
- CI must pass for the **exact commit** deployed; no unreviewed migrations or failed checks.
- Run `API_BASE_URL=https://api.example.com/api/v1 node scripts/smoke.mjs` from a trusted machine. Supply staging-only read-only credentials for authenticated tests.
- Verify purchase, partial return, quarantined inventory, refund reconciliation, concurrent refund requests, POS offline sync, and authorized roles on staging.
- Confirm nightly database backups, tested restore, monitoring/alerts, and a rollback procedure. Application rollback must account for forward-only schema changes.
- Deploy the desktop POS separately with tested signed installer/device provisioning. Docker Compose deploys the web, API, and database, **not** Electron desktop clients.

See `FINANCIAL_QA_RELEASE_GATES.md` and `PRODUCTION_RELEASE_CHECKLIST.md` for outstanding controls. No payments are transferred by the refund-recording endpoints.
