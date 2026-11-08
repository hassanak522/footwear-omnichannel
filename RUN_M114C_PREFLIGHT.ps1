param(
  [string]$Root='G:\footwear-omnichannel',
  [string]$Container='footwear-postgres',
  [string]$DbName='footwear_omnichannel_test',
  [string]$ApiBase='http://127.0.0.1:3002/api/v1'
)
$ErrorActionPreference='Stop'
if($DbName -ne 'footwear_omnichannel_test'){throw 'SAFETY: Only the isolated QA database is permitted.'}
$report=Join-Path $Root ('security-checks\M114C_PREFLIGHT_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Force -Path $report | Out-Null
Write-Host 'M114-C READ-ONLY PREFLIGHT: no test sales, stock changes, or shift changes'
Write-Host "Report: $report"
$src=Join-Path $Root 'apps\api\src\pos.ts'
$electron=Join-Path $Root 'apps\pos-desktop\electron\main.cjs'
if(!(Test-Path $src) -or !(Test-Path $electron)){throw 'Missing POS source files'}
$apiSource=Get-Content $src -Raw
$electronSource=Get-Content $electron -Raw
$checks=@(
  [pscustomobject]@{Check='Sync endpoint';Pass=$apiSource.Contains("@Post('sales/sync')")},
  [pscustomobject]@{Check='Idempotent localSaleId';Pass=$apiSource.Contains('deviceId_localSaleId')},
  [pscustomobject]@{Check='Serialization retry';Pass=$apiSource.Contains('withPosTransactionRetry')},
  [pscustomobject]@{Check='Offline outbox';Pass=$electronSource.Contains('sales:pending')},
  [pscustomobject]@{Check='Local sale persistence';Pass=$electronSource.Contains('sales:save')}
)
$checks | Export-Csv (Join-Path $report 'source_checks.csv') -NoTypeInformation
$checks | Format-Table -AutoSize
try {
  $health=Invoke-WebRequest -UseBasicParsing -Uri ($ApiBase.TrimEnd('/')+'/health') -TimeoutSec 8
  Write-Host "API health: HTTP $($health.StatusCode) (does NOT prove database isolation)"
} catch { Write-Warning "QA API unavailable: $($_.Exception.Message)" }
$sql=@'
BEGIN READ ONLY;
SELECT 'QA_DATABASE' AS check_name, current_database() AS value;
SELECT l.id AS location_id,l.name AS location_name,l.type,l.active,
       COUNT(DISTINCT d.id) AS registered_devices,
       COUNT(DISTINCT s.id) FILTER (WHERE s.status='OPEN') AS open_shifts
FROM "Location" l
LEFT JOIN "PosDevice" d ON d."locationId"=l.id
LEFT JOIN "PosShift" s ON s."deviceId"=d.id
WHERE l.type='BRANCH'
GROUP BY l.id,l.name,l.type,l.active
ORDER BY l.name;
SELECT b."locationId" AS location_id,b."variantId" AS variant_id,
       b."onHand" AS on_hand,b."reservedOnline" AS reserved_online,
       b."reservedReplenish" AS reserved_replenish,b.quarantined,b."safetyBuffer" AS safety_buffer,
       (b."onHand"-b."reservedOnline"-b."reservedReplenish"-b.quarantined-b."safetyBuffer") AS available
FROM "StockBalance" b JOIN "Location" l ON l.id=b."locationId"
WHERE l.type='BRANCH' AND l.active=true
ORDER BY available DESC,b."locationId",b."variantId" LIMIT 20;
COMMIT;
'@
$sqlPath=Join-Path $report 'read_only.sql';Set-Content -Path $sqlPath -Value $sql -Encoding UTF8
Write-Host 'Reading QA database branch/device/stock candidates...'
$output=$sql | & docker exec -i $Container psql -U footwear -d $DbName -X -v ON_ERROR_STOP=1 -P pager=off 2>&1
$output | Tee-Object -FilePath (Join-Path $report 'qa_database.txt')
if($LASTEXITCODE -ne 0){throw 'Read-only database query failed; review report.'}
Write-Host 'PREFLIGHT FINISHED. No database writes were requested.'
Write-Host 'Before M114-C execution, independently confirm API 3002 uses footwear_omnichannel_test.'
