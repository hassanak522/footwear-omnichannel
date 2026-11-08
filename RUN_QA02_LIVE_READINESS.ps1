param(
    [string]$Container = 'footwear-postgres',
    [string]$Database = 'footwear_omnichannel_test'
)
$ErrorActionPreference = 'Stop'
if ($Database -ne 'footwear_omnichannel_test') { throw 'SAFETY STOP: Only isolated test database allowed.' }
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$out = Join-Path (Get-Location).Path "security-checks\QA02_LIVE_READINESS_$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null
$sql = @'
BEGIN READ ONLY;
SELECT 'DB_IDENTITY' AS section, current_database() AS value;
SELECT 'LOCATIONS' AS section, l.id::text AS location_id, l.code, l.type::text AS location_type, l.active::text AS active FROM "Location" l ORDER BY l.type, l.code;
SELECT 'VARIANT_STOCK' AS section, b."locationId"::text AS location_id, b."variantId"::text AS variant_id,
 b."onHand", b."reservedOnline", b."reservedReplenish", b.quarantined, b."safetyBuffer",
 (b."onHand"-b."reservedOnline"-b."reservedReplenish"-b.quarantined-b."safetyBuffer") AS available
 FROM "StockBalance" b ORDER BY b."locationId",b."variantId";
SELECT 'LOCATION_ASSIGNMENTS' AS section, ul."locationId"::text AS location_id, count(*) AS assigned_users
 FROM "UserLocation" ul GROUP BY ul."locationId" ORDER BY ul."locationId";
SELECT 'ACTIVE_VARIANTS' AS section, count(*) AS count FROM "ProductVariant" WHERE active=true;
SELECT 'TRANSFER_COUNTS' AS section, count(*) AS count FROM "StockTransfer";
COMMIT;
'@
$sqlPath = Join-Path $out 'live_readiness.sql'
$logPath = Join-Path $out 'live_readiness_output.txt'
[System.IO.File]::WriteAllText($sqlPath,$sql,[System.Text.UTF8Encoding]::new($false))
Write-Host "Read-only QA-02 readiness check: $Database" -ForegroundColor Cyan
$result = $sql | docker exec -i $Container psql -U footwear -d $Database -X -v ON_ERROR_STOP=1 -P pager=off
$exit = $LASTEXITCODE
$result | Set-Content -Path $logPath -Encoding UTF8
$result | Out-Host
if ($exit -ne 0) { throw "psql failed with exit code $exit" }
Write-Host "`nSaved report: $logPath" -ForegroundColor Green
Write-Host 'No database writes or HTTP requests were performed.'
