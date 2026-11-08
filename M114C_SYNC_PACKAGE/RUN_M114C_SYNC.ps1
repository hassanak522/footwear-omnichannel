param(
 [string]$Root='G:\footwear-omnichannel',
 [int]$ExpectedApiPid=12164,
 [switch]$ConfirmQaApiDatabase
)
$ErrorActionPreference='Stop'
$device='04c78b20-942c-44cc-b5b5-f677113de73a'
$branch='0b0cc789-66ce-462b-9f94-f3ab33739975'
$variant='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f'
$report=Join-Path $Root ('security-checks\M114C_SYNC_'+(Get-Date -Format yyyyMMdd_HHmmss))
New-Item -ItemType Directory -Path $report -Force | Out-Null
$results=New-Object System.Collections.Generic.List[object]
function Check($name,$condition,$detail='') {
 $results.Add([pscustomobject]@{test=$name;pass=[bool]$condition;detail=$detail})
 Write-Host "$(if($condition){'PASS'}else{'FAIL'}) $name $detail"
 if(-not $condition){throw "SAFETY STOP / TEST FAILURE: $name $detail"}
}
function Sql([string]$query){
 $output=$query | docker exec -i footwear-postgres psql -U footwear -d footwear_omnichannel_test -X -q -t -A -F '|' -v ON_ERROR_STOP=1
 if($LASTEXITCODE -ne 0){throw 'Read-only QA SQL failed'}
 return ($output | Out-String).Trim()
}
function Request([string]$path,[string]$method,[object]$body=$null){
 $args=@{Uri=('http://127.0.0.1:3002/api/v1'+$path);Method=$method;Headers=@{Authorization=('Bearer '+$env:M114C_QA_TOKEN)};TimeoutSec=25;ErrorAction='Stop'}
 if($null -ne $body){$args.Body=($body|ConvertTo-Json -Depth 15 -Compress);$args.ContentType='application/json'}
 try {$r=Invoke-WebRequest @args -UseBasicParsing;return [pscustomobject]@{code=[int]$r.StatusCode;data=($r.Content|ConvertFrom-Json)}}
 catch {
  $code=0; $message=$_.Exception.Message
  if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode}
  return [pscustomobject]@{code=$code;data=$null;error=$message}
 }
}
try {
 Write-Host "M114-C LIVE SYNC QA; report $report"
 Check 'EXPLICIT_QA_CONFIRMATION' $ConfirmQaApiDatabase.IsPresent 'Operator must have verified QA DATABASE_URL in API launch terminal'
 Check 'TOKEN_PROVIDED' (-not [string]::IsNullOrWhiteSpace($env:M114C_QA_TOKEN)) 'Set M114C_QA_TOKEN in this terminal; do not paste token into chat'
 $listener=Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction Stop | Select-Object -First 1
 Check 'EXPECTED_API_PID' ($listener.OwningProcess -eq $ExpectedApiPid) "actual=$($listener.OwningProcess) expected=$ExpectedApiPid"
 $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$ExpectedApiPid"
 Check 'API_COMMAND' ($proc.CommandLine -match 'node(?:\.exe)?[" ]+dist/main\.js') 'Node dist/main.js required'
 $db=Sql "BEGIN READ ONLY; SELECT current_database(); COMMIT;"
 Check 'QA_DATABASE' ($db -match 'footwear_omnichannel_test') 'psql connects to isolated QA DB'
 $stockRow=Sql "BEGIN READ ONLY; SELECT (`"onHand`"-`"reservedOnline`"-`"reservedReplenish`"-`"quarantined`"-`"safetyBuffer`") FROM `"StockBalance`" WHERE `"locationId`"='$branch' AND `"variantId`"='$variant'; COMMIT;"
 $stockValue=($stockRow -split "`n" | Where-Object {$_ -match '^\d+$'} | Select-Object -First 1)
 Check 'STOCK_ROW_FOUND' (-not [string]::IsNullOrWhiteSpace($stockValue)) 'Stock balance must be present'
 $available=[int]$stockValue
 Check 'STOCK_AVAILABLE' ($available -ge 4) "available=$available"
 $health=Invoke-WebRequest 'http://127.0.0.1:3002/api/v1/health' -UseBasicParsing -TimeoutSec 8
 Check 'API_HEALTH' ($health.StatusCode -eq 200)
 $status=Request "/pos/devices/$device/status" 'GET'
 Check 'AUTHORIZED_DEVICE_STATUS' ($status.code -eq 200) "HTTP $($status.code)"
 Check 'DEVICE_LOCATION' ($status.data.locationId -eq $branch)
 Check 'DEVICE_ACTIVE' ($status.data.active -eq $true)
 Check 'NO_OPEN_SHIFT' ($null -eq $status.data.openShift) 'Stop if shift exists; do not interfere with another QA run'
 $auth=Request '/auth/session' 'GET'
 Check 'AUTHORIZED_SESSION' ($auth.code -eq 200) "HTTP $($auth.code)"
 Write-Host 'Preflight complete. Creating one synthetic QA shift and three synthetic sales.'
 $shiftResponse=Request '/pos/shifts/open' 'POST' @{deviceId=$device;openingCash=0}
 Check 'OPEN_QA_SHIFT' ($shiftResponse.code -in @(200,201)) "HTTP $($shiftResponse.code)"
 $shiftId=$shiftResponse.data.id
 Check 'SHIFT_ID_RETURNED' ($shiftId -match '^[0-9a-fA-F-]{36}$')
 $soldAt=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
 function Sale([string]$localId,[int]$qty){return @{deviceId=$device;localSaleId=$localId;shiftId=$shiftId;soldAt=$soldAt;lines=@(@{variantId=$variant;quantity=$qty;unitPrice=1000});tenders=@(@{type='CASH';amount=(1000*$qty)})}}
 $id1=[guid]::NewGuid().ToString();$payload=Sale $id1 1
 $first=Request '/pos/sales/sync' 'POST' $payload
 Check 'SYNC_ACCEPTED' ($first.code -in @(200,201) -and $first.data.status -eq 'ACCEPTED' -and $first.data.duplicate -eq $false) "HTTP $($first.code)"
 $repeat=Request '/pos/sales/sync' 'POST' $payload
 Check 'DUPLICATE_REPLAY' ($repeat.code -in @(200,201) -and $repeat.data.duplicate -eq $true -and $repeat.data.id -eq $first.data.id)
 $changed=Sale $id1 2
 $mismatch=Request '/pos/sales/sync' 'POST' $changed
 Check 'PAYLOAD_MISMATCH_REJECTED' ($mismatch.code -eq 409) "HTTP $($mismatch.code)"
 $id2=[guid]::NewGuid().ToString();$tooMany=Sale $id2 ($available+1)
 $conflict=Request '/pos/sales/sync' 'POST' $tooMany
 Check 'STOCK_CONFLICT_RECORDED' ($conflict.code -in @(200,201) -and $conflict.data.status -eq 'STOCK_CONFLICT') "HTTP $($conflict.code)"
 $replayConflict=Request '/pos/sales/sync' 'POST' $tooMany
 Check 'STOCK_CONFLICT_REPLAY' ($replayConflict.data.duplicate -eq $true -and $replayConflict.data.id -eq $conflict.data.id)
 $saleId=$first.data.id;$conflictId=$conflict.data.id
 $verification=Sql "BEGIN READ ONLY; SELECT 'accepted_sale',count(*) FROM `"PosSale`" WHERE id='$saleId' AND status='ACCEPTED' UNION ALL SELECT 'conflict_sale',count(*) FROM `"PosSale`" WHERE id='$conflictId' AND status='STOCK_CONFLICT' UNION ALL SELECT 'accepted_movement',count(*) FROM `"StockMovement`" WHERE `"referenceType`"='POS_SALE' AND `"referenceId`"='$saleId' AND `"quantityDelta`"=-1 UNION ALL SELECT 'conflict_movement',count(*) FROM `"StockMovement`" WHERE `"referenceType`"='POS_SALE' AND `"referenceId`"='$conflictId'; COMMIT;"
 $verification | Set-Content (Join-Path $report 'db_verification.txt')
 Check 'DB_ACCEPTED_SINGLE' ($verification -match 'accepted_sale\|1')
 Check 'DB_CONFLICT_SINGLE' ($verification -match 'conflict_sale\|1')
 Check 'DB_SINGLE_STOCK_MOVEMENT' ($verification -match 'accepted_movement\|1')
 Check 'DB_CONFLICT_NO_MOVEMENT' ($verification -match 'conflict_movement\|0')
 Write-Host "M114-C base tests passed. Shift left OPEN for audit: $shiftId"
} catch { Write-Host "STOP: $($_.Exception.Message)"; $global:LASTEXITCODE=1 }
finally {
 $results | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $report 'results.json')
 Write-Host "REPORT: $report"
 Remove-Item Env:M114C_QA_TOKEN -ErrorAction SilentlyContinue
}
if($global:LASTEXITCODE -eq 1){exit 1}
