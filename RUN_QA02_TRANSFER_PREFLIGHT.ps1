param(
    [string]$Root = 'G:\footwear-omnichannel',
    [string]$Container = 'footwear-postgres',
    [string]$Database = 'footwear_omnichannel_test'
)
$ErrorActionPreference = 'Stop'
if ($Database -ne 'footwear_omnichannel_test') { throw 'SAFETY STOP: Only isolated test DB is permitted.' }
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Project root missing: $Root" }
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$out = Join-Path $Root "security-checks\QA02_TRANSFER_PREFLIGHT_$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null
$sql = @'
BEGIN READ ONLY;
SELECT 'DATABASE_IDENTITY' AS section, jsonb_build_object('database',current_database(),'user',current_user) AS data;
SELECT 'LOCATIONS' AS section, to_jsonb(l) AS data FROM "Location" l ORDER BY l.id;
SELECT 'USER_LOCATION_ASSIGNMENT_COUNTS' AS section, jsonb_build_object('locationId', "locationId",'count',count(*)) AS data FROM "UserLocation" GROUP BY "locationId" ORDER BY "locationId";
SELECT 'PRODUCT_VARIANTS' AS section, jsonb_build_object('id',v.id) AS data FROM "ProductVariant" v ORDER BY v.id LIMIT 20;
SELECT 'TRANSFER_TABLE_COLUMNS' AS section, jsonb_build_object('table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable) AS data FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('StockTransfer','StockTransferItem','StockBalance','StockMovement') ORDER BY table_name,ordinal_position;
SELECT 'RETAIL_TABLE_COUNTS' AS section, jsonb_build_object('table',c.relname,'estimated_rows',c.reltuples) AS data FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('Location','StockTransfer','StockTransferItem','StockBalance','StockMovement');
COMMIT;
'@
$sqlFile = Join-Path $out 'preflight.sql'
$sql | Set-Content -LiteralPath $sqlFile -Encoding UTF8
Write-Host "Running read-only preflight against $Database ..." -ForegroundColor Cyan
$lines = Get-Content -LiteralPath $sqlFile -Raw | docker exec -i $Container psql -U footwear -d $Database -X -v ON_ERROR_STOP=1 -P pager=off -A -F ' | ' 2>&1
$code = $LASTEXITCODE
$lines | Set-Content -LiteralPath (Join-Path $out 'preflight_output.txt') -Encoding UTF8
if ($code -ne 0) { $lines | Select-Object -Last 20; throw "Preflight failed (exit $code)." }
$source = Join-Path $Root 'apps\api\src\transfers.ts'
if (Test-Path -LiteralPath $source) {
    Select-String -LiteralPath $source -Pattern '@Controller','@Post','@Get','@Roles','Serializable','assertLocation','idempotency' | ForEach-Object { '{0}: {1}' -f $_.LineNumber,$_.Line.Trim() } | Set-Content -LiteralPath (Join-Path $out 'transfer_route_review.txt') -Encoding UTF8
}
Write-Host 'PASS: Read-only transfer preflight completed.' -ForegroundColor Green
Write-Host "Reports: $out"
Write-Host 'Upload preflight_output.txt and transfer_route_review.txt. No database writes or HTTP calls were made.'
