# Royal Step Milestones 99–101 — Verification and Release Gates

This is a **read-only** package. It does not modify source code, Prisma schema, environment variables, or data. It is not an authorization fix or security certification.

- **M99**: Inventory API route decorators for manual contract/permission review. Report: `security-checks/M99_101/reports/M99_api_route_inventory.csv`.
- **M100**: Check API health and signed-out finance API access. Expects 200 for health and 401 for two protected routes. Does not authenticate or exercise write operations.
- **M101**: Produce a release gate checklist, explicitly marking unverified authorization, branch isolation, and audit persistence requirements.

## Installation

Extract ZIP to `G:\royal-m99-101-patch`. In PowerShell:

```powershell
cd G:\royal-m99-101-patch
.\INSTALL_M99_101.ps1 -Root 'G:\footwear-omnichannel'
.\RUN_M99_API_CONTRACT_INVENTORY.ps1 -Root 'G:\footwear-omnichannel'
.\RUN_M100_SESSION_REGRESSION.ps1
.\RUN_M101_RELEASE_GATE.ps1 -Root 'G:\footwear-omnichannel'
```

Run M100 with NestJS API on port 3001 and Next.js on port 3000. No server restart or database migration required.

**Important**: M94/M97 authenticated cross-branch results were not supplied, so no branch-permission changes have been made. Share sanitized CSV findings and M100 statuses, without JWTs, passwords, or customer records, before implementing source-specific hardening.
