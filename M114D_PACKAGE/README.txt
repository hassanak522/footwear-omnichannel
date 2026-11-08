M114-D Advanced POS Sync QA

Requirements: Windows PowerShell 5.1, Docker container footwear-postgres, QA API port 3002, previously created open M114-C QA shift, valid M114C_QA_TOKEN in calling PowerShell session.

Run from project root:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\M114D_PACKAGE\RUN_M114D.ps1" -Root "G:\footwear-omnichannel" -ExpectedApiPid 12164 -ConfirmQaApiDatabase

Optional HIGH IMPACT synthetic stock contention (uses most remaining stock): append -RunStockContention. Run only after reviewing synthetic stock and confirming no other QA work is using it.

WARNING: -ConfirmQaApiDatabase is an operator attestation, NOT an independent verification of the running API's DB connection. Confirm the API's original guarded startup environment still points to footwear_omnichannel_test. Script independently verifies PostgreSQL QA DB but cannot prove the running API's DATABASE_URL from outside its process. Do not run if uncertain.

Lost-response test models an acknowledged server commit with discarded client response; it does not interrupt the network or the actual Electron desktop application. Real offline persistence/reconnect requires separate desktop E2E testing.

No migrations, schema changes, resets, or production DB queries. New synthetic sales are permanent QA evidence. Reports do not include JWTs. Script removes the JWT environment variable on exit.
