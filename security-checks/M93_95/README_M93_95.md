# Royal Step — Milestones 93–95: Authorization Verification Gate

This is a **read-only security validation package**, not an implementation of a new role system. It deliberately does not change application code or financial permissions until current behavior is established.

## M93 — API authorization inventory
`RUN_M93_AUTHZ_AUDIT.ps1` scans NestJS controller files for guard, role and location-assertion patterns. These are *review candidates*, not proof of vulnerability. Guards may be inherited or enforced in services.

## M94 — Branch isolation regression
`RUN_M94_BRANCH_TESTS.ps1` calls an existing, protected, **GET-only** finance endpoint for an assigned and an unassigned location. Expected results for a BRANCH_MANAGER account are HTTP 200 and 403, respectively. It also verifies a bogus JWT returns 401. Requires two **real UUIDs** and a valid short-lived BRANCH_MANAGER JWT assigned only to the first location. Do not use a SUPER_ADMIN token for this test. The script prompts for the token without echoing it and does not write it to disk. Tests are restricted to localhost / 127.0.0.1.

## M95 — Auditability assessment
Review the audit inventory manually, particularly whether every sensitive write logs actor ID, location ID, timestamp, action and outcome. This package does **not** create or modify audit tables or certify financial write auditability. Implement missing audit trails only after the report and branch tests are reviewed.

## Installation
1. Extract this ZIP to `G:\royal-m93-95-patch`.
2. `cd G:\royal-m93-95-patch`
3. `.\INSTALL_M93_95.ps1 -Root 'G:\footwear-omnichannel'`
4. `.\RUN_M93_AUTHZ_AUDIT.ps1 -Root 'G:\footwear-omnichannel'`
5. `.\RUN_M94_BRANCH_TESTS.ps1 -AssignedLocationId 'YOUR_ASSIGNED_UUID' -OtherLocationId 'OTHER_BRANCH_UUID'`

No server restart, database migration, schema change, or Prisma reset. Tests are read-only. The authorization test may fail if your API or test account is not configured; investigate rather than weakening checks.
