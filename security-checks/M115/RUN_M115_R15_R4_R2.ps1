$ErrorActionPreference = 'Stop'
$root = 'G:\footwear-omnichannel'
$db = 'footwear_m115_api_b16z_20261107'
$api = 'http://127.0.0.1:3102/api/v1'
$locationId = '0286ddd3-4b83-42ce-8a68-7fa9a5bd5829'
$variantId = 'd167b9bb-61bf-4364-aae0-5a7a064310bf'
$reportDir = Join-Path $root 'security-checks\M115\reports'
$credentialsPath = Join-Path $root 'security-checks\M115\fixtures\M115_B16Z_TEST_CREDENTIALS.json'
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
$writeStarted = $false
function Assert-Test([string]$name,[bool]$condition,[string]$details='') {
  $status = if($condition){'PASS'}else{'FAIL'}
  Write-Host "$status - $name"
  $script:results.Add([pscustomobject]@{Test=$name;Status=$status;Details=$details})
  if(-not $condition){throw "SAFETY STOP: $name"}
}
function Read-Sql([string]$sql) {
  $output = @($sql | docker exec -i footwear-postgres psql -X -U footwear -d $db -At -v ON_ERROR_STOP=1)
  if($LASTEXITCODE -ne 0){throw 'SAFETY STOP: PostgreSQL query failed'}
  return $output
}
function Get-State {
  $sql = @"
BEGIN TRANSACTION READ ONLY;
SELECT row_to_json(s) FROM (
 SELECT current_database() AS database,l."code" AS warehouse,v."sku" AS sku,
 b."onHand" AS on_hand,b."reservedOnline" AS reserved_online,
 b."reservedReplenish" AS reserved_replenish,b."version" AS version,
 (SELECT COUNT(*) FROM public."StockReservation" r WHERE r."variantId"=v."id" AND r."locationId"=l."id") AS reservations,
 (SELECT COUNT(*) FROM public."StockReservation" r WHERE r."variantId"=v."id" AND r."locationId"=l."id" AND r."status"='ACTIVE') AS active_reservations,
 (SELECT COUNT(*) FROM public."StockReservation" r WHERE r."variantId"=v."id" AND r."locationId"=l."id" AND r."status"='RELEASED') AS released_reservations
 FROM public."StockBalance" b
 JOIN public."Location" l ON l."id"=b."locationId"
 JOIN public."ProductVariant" v ON v."id"=b."variantId"
 WHERE l."id"='$locationId' AND v."id"='$variantId'
) s;
ROLLBACK;
"@
  $data = @(Read-Sql $sql | Where-Object {$_ -match '^\{.*\}$'})
  if($data.Count -ne 1){throw 'SAFETY STOP: Fixture state missing or ambiguous'}
  return ($data[0] | ConvertFrom-Json)
}
function Invoke-TestPost([string]$path,[object]$payload,[hashtable]$headers) {
  try {
    $response = Invoke-WebRequest -Uri "$api/$path" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8 -Compress) -UseBasicParsing -TimeoutSec 30
    return [pscustomobject]@{Status=[int]$response.StatusCode;Data=($response.Content | ConvertFrom-Json)}
  } catch {
    $status = 0
    if($_.Exception.Response){$status = [int]$_.Exception.Response.StatusCode}
    return [pscustomobject]@{Status=$status;Data=$null}
  }
}
function Get-OriginalStock {
  $sql = @'
BEGIN TRANSACTION READ ONLY;
SELECT v."sku" || '|' || b."onHand"
FROM public."StockBalance" b
JOIN public."ProductVariant" v ON v."id"=b."variantId"
JOIN public."Location" l ON l."id"=b."locationId"
WHERE l."code"='WH-KHI-01' AND v."sku" IN ('ASK-WHT-44','OXF-BLK-42')
ORDER BY v."sku";
ROLLBACK;
'@
  return @(Read-Sql $sql | Where-Object {$_ -match '^(ASK-WHT-44|OXF-BLK-42)\|\d+$'})
}
try {
  Write-Host "`n=== M115-R15-R4-R2 ===" -ForegroundColor Cyan
  $identity = @(Read-Sql 'SELECT current_database();')
  Assert-Test 'Disposable database identity' ($identity.Count -eq 1 -and $identity[0].Trim() -ceq $db)
  $tagged = @(Read-Sql "SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='m115_b16z_isolated_api' AND client_addr IS NOT NULL;")
  Assert-Test 'Tagged API database connection' ($tagged.Count -eq 1 -and $tagged[0].Trim() -match '^[1-9]\d*$')
  $health = Invoke-WebRequest -Uri "$api/health" -UseBasicParsing -TimeoutSec 10
  Assert-Test 'Isolated API health' ($health.StatusCode -eq 200)
  if(-not (Test-Path $credentialsPath)){throw 'SAFETY STOP: Credentials file missing'}
  $manager = (Get-Content $credentialsPath -Raw | ConvertFrom-Json).warehouseManager
  if(-not $manager.email -or -not $manager.password){throw 'SAFETY STOP: Warehouse credentials missing'}
  $login = Invoke-RestMethod -Uri "$api/auth/login" -Method Post -ContentType 'application/json' -Body (@{email=$manager.email;password=$manager.password} | ConvertTo-Json) -TimeoutSec 15
  $token = $login.accessToken
  if(-not $token){$token=$login.access_token}
  Assert-Test 'Warehouse authentication' (-not [string]::IsNullOrWhiteSpace($token))
  $headers = @{Authorization="Bearer $token"}
  $locations = @(Invoke-RestMethod -Uri "$api/inventory/locations" -Headers $headers -TimeoutSec 15)
  $assigned = @($locations | Where-Object {$_.id -eq $locationId -and $_.code -eq 'WH-KHI-01'})
  Assert-Test 'Warehouse authorization' ($assigned.Count -eq 1)
  $before = Get-State
  Assert-Test 'Clean reservation baseline' ($before.database -ceq $db -and $before.warehouse -eq 'WH-KHI-01' -and $before.sku -eq 'M115-R15-INVENTORY-001' -and $before.on_hand -eq 10 -and $before.reserved_online -eq 0 -and $before.reserved_replenish -eq 0 -and $before.version -eq 1 -and $before.reservations -eq 0)
  $originals = @(Get-OriginalStock)
  Assert-Test 'Original warehouse baseline' ($originals.Count -eq 2 -and $originals -contains 'ASK-WHT-44|319' -and $originals -contains 'OXF-BLK-42|290')
  $runId = [guid]::NewGuid().ToString('N')
  $reserveBody = @{locationId=$locationId;variantId=$variantId;quantity=3;purpose='ONLINE_ORDER';referenceId="M115-R15-R4-$runId";idempotencyKey="M115-R15-R4-RES-$runId"}
  Write-Host "`nCreating reservation for 3 units..."
  $writeStarted=$true
  $reserve=Invoke-TestPost 'inventory/reserve' $reserveBody $headers
  Assert-Test 'Reservation HTTP' ($reserve.Status -ge 200 -and $reserve.Status -lt 300) "HTTP $($reserve.Status)"
  $reservationId=$reserve.Data.id
  Assert-Test 'Reservation identifier' (-not [string]::IsNullOrWhiteSpace($reservationId))
  $reserved=Get-State
  Assert-Test 'Reservation stock accounting' ($reserved.on_hand -eq 10 -and $reserved.reserved_online -eq 3 -and $reserved.version -eq 2 -and $reserved.reservations -eq 1 -and $reserved.active_reservations -eq 1)
  $replay=Invoke-TestPost 'inventory/reserve' $reserveBody $headers
  Assert-Test 'Reservation replay HTTP' ($replay.Status -ge 200 -and $replay.Status -lt 300)
  Assert-Test 'Reservation replay identity' ($replay.Data.id -eq $reservationId)
  $replayState=Get-State
  Assert-Test 'Reservation replay unchanged' ($replayState.on_hand -eq 10 -and $replayState.reserved_online -eq 3 -and $replayState.version -eq 2 -and $replayState.reservations -eq 1)
  $conflictBody=$reserveBody.Clone();$conflictBody.quantity=4
  $conflict=Invoke-TestPost 'inventory/reserve' $conflictBody $headers
  Assert-Test 'Reservation idempotency conflict' ($conflict.Status -eq 409) "HTTP $($conflict.Status)"
  $overBody=$reserveBody.Clone();$overBody.quantity=100;$overBody.referenceId="M115-R15-R4-OVER-$runId";$overBody.idempotencyKey="M115-R15-R4-OVER-$runId"
  $over=Invoke-TestPost 'inventory/reserve' $overBody $headers
  Assert-Test 'Insufficient available stock rejection' ($over.Status -eq 409) "HTTP $($over.Status)"
  $beforeRelease=Get-State
  Assert-Test 'Rejected requests unchanged' ($beforeRelease.on_hand -eq 10 -and $beforeRelease.reserved_online -eq 3 -and $beforeRelease.version -eq 2 -and $beforeRelease.reservations -eq 1)
  Write-Host "`nReleasing reservation..."
  $releaseBody=@{idempotencyKey="M115-R15-R4-REL-$runId"}
  $release=Invoke-TestPost "inventory/reservations/$reservationId/release" $releaseBody $headers
  Assert-Test 'Reservation release HTTP' ($release.Status -ge 200 -and $release.Status -lt 300)
  $released=Get-State
  Assert-Test 'Reservation release accounting' ($released.on_hand -eq 10 -and $released.reserved_online -eq 0 -and $released.version -eq 3 -and $released.reservations -eq 1 -and $released.active_reservations -eq 0 -and $released.released_reservations -eq 1)
  $releaseReplay=Invoke-TestPost "inventory/reservations/$reservationId/release" $releaseBody $headers
  Assert-Test 'Release replay HTTP' ($releaseReplay.Status -ge 200 -and $releaseReplay.Status -lt 300)
  $final=Get-State
  Assert-Test 'Final inventory reconciliation' ($final.on_hand -eq 10 -and $final.reserved_online -eq 0 -and $final.reserved_replenish -eq 0 -and $final.version -eq 3 -and $final.reservations -eq 1 -and $final.released_reservations -eq 1)
  $originalsAfter=@(Get-OriginalStock)
  Assert-Test 'Original warehouse stock unchanged' ($originalsAfter.Count -eq 2 -and $originalsAfter -contains 'ASK-WHT-44|319' -and $originalsAfter -contains 'OXF-BLK-42|290')
  Write-Host "`n=== R15-R4-R2 ALL CHECKS PASSED ===" -ForegroundColor Green
} catch {
  Write-Host "`n=== R15-R4-R2 STOPPED ===" -ForegroundColor Red
  Write-Host $_.Exception.Message
  if($writeStarted){Write-Host 'A transaction may have committed. DO NOT rerun without inspecting fixture state.'}
} finally {
  $report=Join-Path $reportDir 'M115_R15_R4_R2_RESULTS.csv'
  $results | Export-Csv -Path $report -NoTypeInformation
  Write-Host "`nReport: $report"
  Write-Host 'Production release: BLOCKED'
}
