param(
  [string]$Root = 'G:\footwear-omnichannel',
  [string]$Container = 'footwear-postgres',
  [string]$TestDatabase = 'footwear_omnichannel_test'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Project not found: $Root" }
if ($TestDatabase -ne 'footwear_omnichannel_test') { throw 'SAFETY STOP: Only the isolated test database is allowed.' }
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$report = Join-Path $Root "security-checks\QA02_RETAIL_READONLY_$stamp"
New-Item -ItemType Directory -Path $report -Force | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
function Add-Result([string]$name,[string]$status,[string]$detail) {
  $script:results.Add([pscustomobject]@{ Check=$name; Status=$status; Detail=$detail })
  Write-Host "$name : $status - $detail"
}
function Run-SqlCheck([string]$name,[string]$sql) {
  $wrapped = "BEGIN READ ONLY;`n" + $sql + "`nCOMMIT;"
  $output = $wrapped | & docker exec -i $Container psql -U footwear -d $TestDatabase -X -A -t -v ON_ERROR_STOP=1 2>&1
  if ($LASTEXITCODE -ne 0) { Add-Result $name 'ERROR' (($output | Out-String).Trim()); return }
  $lines = @($output | Where-Object { $_ -and $_ -notin @('BEGIN','COMMIT') })
  if ($lines.Count -ne 1 -or $lines[0] -notmatch '^\d+$') { Add-Result $name 'ERROR' "Unexpected SQL output: $($lines -join '; ')"; return }
  $count = [int64]$lines[0]
  Add-Result $name $(if ($count -eq 0) {'PASS'} else {'FAIL'}) "violations=$count"
}
function Source-Check([string]$name,[string]$path,[string]$pattern) {
  if (-not (Test-Path -LiteralPath $path)) { Add-Result $name 'BLOCKED' 'Source file missing'; return }
  $matches = @(Select-String -LiteralPath $path -Pattern $pattern)
  Add-Result $name $(if ($matches.Count) {'REVIEW'} else {'PASS'}) "matches=$($matches.Count) (review source context)"
  $matches | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" } | Set-Content -LiteralPath (Join-Path $report "$name.txt")
}
Write-Host "`n=== QA-02 READ-ONLY RETAIL BASELINE ===" -ForegroundColor Cyan
Write-Host "Database: $TestDatabase | Container: $Container"
$ready = & docker exec $Container pg_isready -U footwear -d $TestDatabase 2>&1
if ($LASTEXITCODE -ne 0) { throw "Test database unavailable: $ready" }
Add-Result 'TEST_DB_READY' 'PASS' ($ready | Out-String).Trim()
Run-SqlCheck 'NEGATIVE_STOCK_COMPONENTS' 'SELECT COUNT(*) FROM "StockBalance" WHERE "onHand" < 0 OR "reservedOnline" < 0 OR "reservedReplenish" < 0 OR quarantined < 0 OR "safetyBuffer" < 0;'
Run-SqlCheck 'OVERCOMMITTED_STOCK' 'SELECT COUNT(*) FROM "StockBalance" WHERE "onHand" < ("reservedOnline" + "reservedReplenish" + quarantined + "safetyBuffer");'
Run-SqlCheck 'SAME_SOURCE_DESTINATION_TRANSFER' 'SELECT COUNT(*) FROM "StockTransfer" WHERE "sourceId" = "destinationId";'
Run-SqlCheck 'INVALID_TRANSFER_QUANTITIES' 'SELECT COUNT(*) FROM "StockTransferItem" WHERE "requestedQty" <= 0 OR "dispatchedQty" < 0 OR "receivedQty" < 0 OR "damagedQty" < 0 OR "dispatchedQty" > "requestedQty" OR ("receivedQty" + "damagedQty") > "dispatchedQty";'
Run-SqlCheck 'RECEIVED_TRANSFER_QUANTITY_MISMATCH' 'SELECT COUNT(*) FROM "StockTransferItem" i JOIN "StockTransfer" t ON t.id = i."transferId" WHERE t.status = ''RECEIVED'' AND (i."receivedQty" + i."damagedQty") <> i."dispatchedQty";'
Run-SqlCheck 'DISPATCHED_TRANSFER_MISSING_DISPATCH_QTY' 'SELECT COUNT(*) FROM "StockTransferItem" i JOIN "StockTransfer" t ON t.id = i."transferId" WHERE t.status IN (''DISPATCHED'',''RECEIVED'',''PARTIALLY_RECEIVED'') AND i."dispatchedQty" <> i."requestedQty";'
Run-SqlCheck 'DUPLICATE_MOVEMENT_IDEMPOTENCY' 'SELECT COUNT(*) FROM (SELECT "idempotencyKey" FROM "StockMovement" GROUP BY "idempotencyKey" HAVING COUNT(*) > 1) q;'
Run-SqlCheck 'DUPLICATE_TRANSFER_EVENT_IDEMPOTENCY' 'SELECT COUNT(*) FROM (SELECT "idempotencyKey" FROM "IntegrationEvent" GROUP BY "idempotencyKey" HAVING COUNT(*) > 1) q;'
Run-SqlCheck 'TRANSFER_DISPATCH_MOVEMENT_MISMATCH' @'
SELECT COUNT(*) FROM "StockTransferItem" i
JOIN "StockTransfer" t ON t.id = i."transferId"
LEFT JOIN LATERAL (
 SELECT COALESCE(SUM(m."quantityDelta"),0) qty
 FROM "StockMovement" m
 WHERE m."referenceType"='STOCK_TRANSFER' AND m."referenceId"=t.id::text
 AND m."locationId"=t."sourceId" AND m."variantId"=i."variantId" AND m.type='TRANSFER_DISPATCH'
) movement ON true
WHERE t.status IN ('DISPATCHED','RECEIVED','PARTIALLY_RECEIVED')
AND movement.qty <> -i."dispatchedQty";
'@
Run-SqlCheck 'TRANSFER_RECEIPT_MOVEMENT_MISMATCH' @'
SELECT COUNT(*) FROM "StockTransferItem" i
JOIN "StockTransfer" t ON t.id = i."transferId"
LEFT JOIN LATERAL (
 SELECT COALESCE(SUM(m."quantityDelta"),0) qty
 FROM "StockMovement" m
 WHERE m."referenceType"='STOCK_TRANSFER' AND m."referenceId"=t.id::text
 AND m."locationId"=t."destinationId" AND m."variantId"=i."variantId" AND m.type='TRANSFER_RECEIPT'
) movement ON true
WHERE t.status IN ('RECEIVED','PARTIALLY_RECEIVED')
AND movement.qty <> i."receivedQty"+i."damagedQty";
'@
$src = Join-Path $Root 'apps\api\src'
Source-Check 'TRANSFER_RETRY_REVIEW' (Join-Path $src 'transfers.ts') 'P2034|TransactionIsolationLevel|\$transaction'
Source-Check 'INVENTORY_IDEMPOTENCY_REVIEW' (Join-Path $src 'inventory.ts') 'idempotencyKey|isDeepStrictEqual'
Source-Check 'TRANSFER_ACCESS_REVIEW' (Join-Path $src 'transfers.ts') 'assertLocation|this\.access\('
$summary = Join-Path $report 'QA02_SUMMARY.csv'
$results | Export-Csv -LiteralPath $summary -NoTypeInformation -Encoding UTF8
Write-Host "`n=== SUMMARY ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize
Write-Host "`nReport folder: $report"
Write-Host 'Read-only SQL and source inspection only. No migrations, HTTP writes, or test data creation.'
Write-Host 'PASS on empty tables is not functional coverage; review test data counts separately.'
