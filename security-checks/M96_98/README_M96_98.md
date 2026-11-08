# Royal Step — Milestones 96–98: authorization and audit verification

**Scope:** This is a read-only verification package, NOT a security fix or production authorization certification. M94 authenticated cross-branch results have not yet been provided; implementing permission changes without them risks breaking HQ/branch workflows.

## M96: Controller and write-route review
Scans NestJS TypeScript source for guards, role decorators, location checks, and write route counts. Writes `security-checks/M96_98/reports/M96_controller_review.csv`. Pattern absence does not establish a vulnerability: checks can be inherited or inside services.

## M97: Branch isolation regression
Calls two GET-only endpoints (`finance-guardrails/period-locks` and `finance-audit/posting-integrity`) against assigned and other location UUIDs. Prompts for a short-lived BRANCH_MANAGER JWT without echoing it. Expected 200 / 403 / 401 for assigned / unassigned / invalid token. Uses local API only. Does not inspect response record ownership; verify separately. Requires two REAL location IDs and a branch-restricted test user. Avoid sharing JWT or credentials.

## M98: Financial write audit inventory
Lists controllers with write routes and signals of actor, location, event/audit, and transaction references in `M98_write_audit_inventory.csv`. These are review prompts, not verified durable audit events.

## Install and run

```powershell
cd G:\royal-m96-98-patch
.\INSTALL_M96_98.ps1 -Root 'G:\footwear-omnichannel'
.\RUN_M96_ROUTE_REVIEW.ps1 -Root 'G:\footwear-omnichannel'
.\RUN_M98_AUDIT_INVENTORY.ps1 -Root 'G:\footwear-omnichannel'
.\RUN_M97_BRANCH_REGRESSION.ps1 -AssignedLocationId 'REPLACE_WITH_REAL_UUID' -OtherLocationId 'REPLACE_WITH_OTHER_REAL_UUID'
```

Do not run M97 with placeholders. No Prisma migration, reset, application changes, or server restart. Share sanitized CSV findings and status codes, not credentials or financial records. After reviewing the results, implement source-specific hardening in a subsequent milestone.
