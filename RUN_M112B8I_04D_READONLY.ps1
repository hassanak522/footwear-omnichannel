# M112-B8I-04D: read-only financial integrity smoke gate.
# Does not write to databases, application source, or environment files.
$ErrorActionPreference = 'Stop'
Set-Location 'G:\footwear-omnichannel'

$container = 'footwear-postgres'
$db = 'footwear_omnichannel_test'
$user = 'footwear'
if ($db -cne 'footwear_omnichannel_test') { throw 'Unsafe database target' }

Write-Host '=== Source gates ===' -ForegroundColor Cyan
$pos = [IO.File]::ReadAllText((Join-Path (Get-Location) 'apps\api\src\pos.ts'))
$rec = [IO.File]::ReadAllText((Join-Path (Get-Location) 'apps\api\src\cash-reconciliation.ts'))
$drawer = [IO.File]::ReadAllText((Join-Path (Get-Location) 'apps\api\src\finance-controls.ts'))
$checks = [ordered]@{
  'Closed shift snapshot lookup' = $pos.Contains('posShiftClosingSnapshot.findUnique')
  'Late sync separate reporting' = $pos.Contains('lateSync:')
  'Legacy closed shift guard' = $pos.Contains('Closed legacy shift has no verified closing snapshot')
  'Reconciliation snapshot lookup' = $rec.Contains('posShiftClosingSnapshot.findUnique')
  'Reconciliation uses snapshot expected cash' = $rec.Contains('expectedCash:snapshot.expectedCash')
  'Drawer summary snapshot lookup' = $drawer.Contains('posShiftClosingSnapshot.findUnique')
  'Drawer summary avoids double count' = $drawer.Contains('not added twice')
}
$failed = @()
foreach ($key in $checks.Keys) {
  if ($checks[$key]) { Write-Host "PASS $key" -ForegroundColor Green }
  else { Write-Host "FAIL $key" -ForegroundColor Red; $failed += $key }
}
if ($failed.Count) { throw "Source gates failed: $($failed -join ', ')" }

Write-Host '=== Test database identity and schema ===' -ForegroundColor Cyan
$sql = @'
SELECT current_database() AS database_name, current_user AS database_user;
SELECT count(*) AS snapshot_columns
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'PosShiftClosingSnapshot';
SELECT migration_name, (finished_at IS NOT NULL) AS applied,
       (rolled_back_at IS NULL) AS not_rolled_back
FROM "_prisma_migrations"
WHERE migration_name = '20261104_m112b8i_shift_snapshot';
SELECT count(*) AS closed_shifts,
       count(s."shiftId") AS closed_shifts_with_snapshots,
       count(*) - count(s."shiftId") AS legacy_closed_shifts_without_snapshots
FROM "PosShift" p
LEFT JOIN "PosShiftClosingSnapshot" s ON s."shiftId" = p.id
WHERE p.status = 'CLOSED';
SELECT count(*) AS inconsistent_snapshot_arithmetic
FROM "PosShiftClosingSnapshot" s
WHERE s."expectedCash" <> s."openingCash" + s."cashSales" + s."drawerAdjustment"
   OR s.variance <> s."countedCash" - s."expectedCash";
'@
$sql | docker exec -i $container psql -U $user -d $db -X -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Read-only SQL gate failed' }
Write-Host 'Read-only smoke gate completed. Live behavioral regression tests remain pending.' -ForegroundColor Yellow
