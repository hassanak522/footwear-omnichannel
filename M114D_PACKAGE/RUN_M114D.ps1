param(
 [string]$Root='G:\footwear-omnichannel',
 [int]$ExpectedApiPid=12164,
 [string]$ShiftId='2a657b01-c41f-4115-8b39-c764537faebd',
 [switch]$ConfirmQaApiDatabase,
 [switch]$RunStockContention
)
$ErrorActionPreference='Stop'
$global:LASTEXITCODE=0
$device='04c78b20-942c-44cc-b5b5-f677113de73a'
$branch='0b0cc789-66ce-462b-9f94-f3ab33739975'
$variant='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f'
$base='http://127.0.0.1:3002/api/v1'
$report=Join-Path $Root ('security-checks\M114D_'+(Get-Date -Format yyyyMMdd_HHmmss))
New-Item -ItemType Directory -Path $report -Force | Out-Null
$results=New-Object System.Collections.Generic.List[object]
$ids=New-Object System.Collections.Generic.List[string]
function Check([string]$name,[bool]$ok,[string]$detail=''){
 $results.Add([pscustomobject]@{test=$name;pass=$ok;detail=$detail})
 Write-Host "$(if($ok){'PASS'}else{'FAIL'}) $name $detail"
 if(-not $ok){throw "STOP: $name $detail"}
}
function Sql([string]$query){
 $output=$query | docker exec -i footwear-postgres psql -U footwear -d footwear_omnichannel_test -X -q -t -A -F '|' -v ON_ERROR_STOP=1
 if($LASTEXITCODE -ne 0){throw 'SQL read failed'}
 return ($output | Out-String).Trim()
}
function Req([string]$path,[string]$method,[object]$body=$null){
 $a=@{Uri=($base+$path);Method=$method;Headers=@{Authorization=('Bearer '+$env:M114C_QA_TOKEN)};TimeoutSec=45;ErrorAction='Stop';UseBasicParsing=$true}
 if($null -ne $body){$a.Body=($body|ConvertTo-Json -Depth 12 -Compress);$a.ContentType='application/json'}
 try{$r=Invoke-WebRequest @a;return [pscustomobject]@{code=[int]$r.StatusCode;data=($r.Content|ConvertFrom-Json)}}
 catch{$code=0;if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode};return [pscustomobject]@{code=$code;data=$null}}
}
function Sale([string]$id,[int]$qty,[string]$timestamp){
 return @{deviceId=$device;localSaleId=$id;shiftId=$ShiftId;soldAt=$timestamp;lines=@(@{variantId=$variant;quantity=$qty;unitPrice=1000});tenders=@(@{type='CASH';amount=(1000*$qty)})}
}
$worker={param($url,$token,$json)
 try{$r=Invoke-WebRequest -Uri $url -Method POST -ContentType 'application/json' -Headers @{Authorization=('Bearer '+$token)} -Body $json -UseBasicParsing -TimeoutSec 55 -ErrorAction Stop
 return [pscustomobject]@{code=[int]$r.StatusCode;data=($r.Content|ConvertFrom-Json)}}
 catch{$code=0;if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode};return [pscustomobject]@{code=$code;data=$null}}
}
function ParallelSales([object[]]$payloads){
 $jobs=@()
 try{
  foreach($p in $payloads){$json=$p|ConvertTo-Json -Depth 12 -Compress;$jobs+=Start-Job -ScriptBlock $worker -ArgumentList ($base+'/pos/sales/sync'),$env:M114C_QA_TOKEN,$json}
  $null=$jobs|Wait-Job -Timeout 120
  if(@($jobs|Where-Object State -ne 'Completed').Count -gt 0){throw 'Concurrent requests timed out'}
  $out=@();foreach($j in $jobs){$out+=@(Receive-Job -Job $j -ErrorAction Stop)}
  return $out
 }finally{if($jobs.Count -gt 0){$jobs|Stop-Job -ErrorAction SilentlyContinue;$jobs|Remove-Job -Force -ErrorAction SilentlyContinue}}
}
try{
 Write-Host "M114-D advanced QA: $report"
 Check 'EXPLICIT_QA_CONFIRMATION' $ConfirmQaApiDatabase.IsPresent 'Verify the running API DATABASE_URL independently before execution'
 Check 'TOKEN_PRESENT' (-not [string]::IsNullOrWhiteSpace($env:M114C_QA_TOKEN))
 $listener=Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction Stop|Select-Object -First 1
 Check 'API_PID' ($listener.OwningProcess -eq $ExpectedApiPid) "actual=$($listener.OwningProcess) expected=$ExpectedApiPid"
 $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$ExpectedApiPid"
 Check 'API_COMMAND' ($proc.CommandLine -match 'node(?:\.exe)?[" ]+dist/main\.js')
 $db=Sql 'BEGIN READ ONLY; SELECT current_database(); COMMIT;'
 Check 'QA_DB' ($db -match 'footwear_omnichannel_test')
 $auth=Req '/auth/session' 'GET';Check 'AUTH_SESSION' ($auth.code -eq 200) "HTTP $($auth.code)"
 $status=Req "/pos/devices/$device/status" 'GET'
 Check 'DEVICE_AUTHORIZED' ($status.code -eq 200 -and $status.data.active -eq $true -and $status.data.locationId -eq $branch)
 Check 'SHIFT_MATCH' ($null -ne $status.data.openShift -and $status.data.openShift.id -eq $ShiftId) 'Expected existing open synthetic QA shift'
 $shiftSql=Sql "BEGIN READ ONLY; SELECT count(*) FROM `"PosShift`" WHERE id='$ShiftId' AND `"deviceId`"='$device' AND status='OPEN'; COMMIT;"
 Check 'QA_SHIFT_DB' (@($shiftSql -split "`n"|Where-Object{$_ -eq '1'}).Count -eq 1)
 $availableSql=Sql "BEGIN READ ONLY; SELECT (`"onHand`"-`"reservedOnline`"-`"reservedReplenish`"-`"quarantined`"-`"safetyBuffer`") FROM `"StockBalance`" WHERE `"locationId`"='$branch' AND `"variantId`"='$variant'; COMMIT;"
 $availableText=($availableSql -split "`n"|Where-Object{$_ -match '^\d+$'}|Select-Object -First 1)
 Check 'STOCK_ROW' (-not [string]::IsNullOrWhiteSpace($availableText))
 $available=[int]$availableText
 Check 'STOCK_BUFFER' ($available -ge 6) "available=$available"
 $soldAt=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
 # A. Lost response simulation: intentionally ignore the first HTTP response, then replay identical request.
 $lostId=[guid]::NewGuid().ToString();$ids.Add($lostId);$lost=Sale $lostId 1 $soldAt
 $first=Req '/pos/sales/sync' 'POST' $lost
 Check 'LOST_RESPONSE_SERVER_COMMIT' ($first.code -in @(200,201) -and $first.data.status -eq 'ACCEPTED') "HTTP $($first.code)"
 $replay=Req '/pos/sales/sync' 'POST' $lost
 Check 'LOST_RESPONSE_REPLAY' ($replay.code -in @(200,201) -and $replay.data.duplicate -eq $true -and $replay.data.id -eq $first.data.id)
 $verifyLost=Sql "BEGIN READ ONLY; SELECT 'sales',count(*) FROM `"PosSale`" WHERE `"deviceId`"='$device' AND `"localSaleId`"='$lostId' UNION ALL SELECT 'movement',count(*) FROM `"StockMovement`" WHERE `"referenceType`"='POS_SALE' AND `"referenceId`"='$($first.data.id)'; COMMIT;"
 Check 'LOST_RESPONSE_EXACTLY_ONCE' ($verifyLost -match 'sales\|1' -and $verifyLost -match 'movement\|1')
 # B. Simultaneous duplicate requests with the same sale ID and identical payload.
 $dupId=[guid]::NewGuid().ToString();$ids.Add($dupId);$dup=Sale $dupId 1 $soldAt
 $parallel=@(ParallelSales @($dup,$dup,$dup,$dup))
 $parallel | Select-Object code,@{n='status';e={$_.data.status}},@{n='duplicate';e={$_.data.duplicate}}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $report 'duplicate_responses.json')
 Check 'CONCURRENT_DUPLICATE_RESPONSES' ($parallel.Count -eq 4 -and @($parallel|Where-Object{$_.code -notin @(200,201) -or $_.data.status -ne 'ACCEPTED'}).Count -eq 0) "responses=$($parallel.Count)"
 Check 'CONCURRENT_DUPLICATE_FLAGS' (@($parallel|Where-Object{$_.data.duplicate -eq $false}).Count -eq 1 -and @($parallel|Where-Object{$_.data.duplicate -eq $true}).Count -eq 3)
 $saleIds=@($parallel|ForEach-Object{$_.data.id}|Select-Object -Unique)
 Check 'CONCURRENT_DUPLICATE_SINGLE_ID' ($saleIds.Count -eq 1)
 $verifyDup=Sql "BEGIN READ ONLY; SELECT 'sales',count(*) FROM `"PosSale`" WHERE `"deviceId`"='$device' AND `"localSaleId`"='$dupId' UNION ALL SELECT 'movement',count(*) FROM `"StockMovement`" WHERE `"referenceType`"='POS_SALE' AND `"referenceId`"='$($saleIds[0])'; COMMIT;"
 Check 'CONCURRENT_DUPLICATE_EXACTLY_ONCE' ($verifyDup -match 'sales\|1' -and $verifyDup -match 'movement\|1')
 # C. Stock contention is opt-in because it intentionally consumes nearly all synthetic sellable stock.
 if($RunStockContention){
  $freshSql=Sql "BEGIN READ ONLY; SELECT (`"onHand`"-`"reservedOnline`"-`"reservedReplenish`"-`"quarantined`"-`"safetyBuffer`") FROM `"StockBalance`" WHERE `"locationId`"='$branch' AND `"variantId`"='$variant'; COMMIT;"
  $freshText=($freshSql -split "`n"|Where-Object{$_ -match '^\d+$'}|Select-Object -First 1)
  Check 'CONTENTION_STOCK_ROW' (-not [string]::IsNullOrWhiteSpace($freshText))
  $fresh=[int]$freshText;Check 'CONTENTION_STOCK_MINIMUM' ($fresh -ge 4) "available=$fresh"
  $qty=[int][math]::Ceiling($fresh/2.0)
  if($qty*2 -le $fresh){$qty++}
  $a=[guid]::NewGuid().ToString();$b=[guid]::NewGuid().ToString();$ids.Add($a);$ids.Add($b)
  $pair=@(ParallelSales @((Sale $a $qty $soldAt),(Sale $b $qty $soldAt)))
  $pair|Select-Object code,@{n='status';e={$_.data.status}}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $report 'contention_responses.json')
  Check 'CONTENTION_HTTP_SUCCESS' ($pair.Count -eq 2 -and @($pair|Where-Object{$_.code -notin @(200,201)}).Count -eq 0)
  Check 'CONTENTION_ONE_ACCEPTED_ONE_CONFLICT' (@($pair|Where-Object{$_.data.status -eq 'ACCEPTED'}).Count -eq 1 -and @($pair|Where-Object{$_.data.status -eq 'STOCK_CONFLICT'}).Count -eq 1)
  $verification=Sql "BEGIN READ ONLY; SELECT 'accepted',count(*) FROM `"PosSale`" WHERE `"deviceId`"='$device' AND `"localSaleId`" IN ('$a','$b') AND status='ACCEPTED' UNION ALL SELECT 'conflict',count(*) FROM `"PosSale`" WHERE `"deviceId`"='$device' AND `"localSaleId`" IN ('$a','$b') AND status='STOCK_CONFLICT' UNION ALL SELECT 'movement',count(*) FROM `"StockMovement`" m JOIN `"PosSale`" s ON s.id::text=m.`"referenceId`"::text WHERE s.`"localSaleId`" IN ('$a','$b') AND s.`"deviceId`"='$device' AND m.`"referenceType`"='POS_SALE'; COMMIT;"
  Check 'CONTENTION_DB_EXACTLY_ONE_DEDUCTION' ($verification -match 'accepted\|1' -and $verification -match 'conflict\|1' -and $verification -match 'movement\|1')
 }else{Write-Host 'SKIP STOCK_CONTENTION: Requires explicit -RunStockContention; intentionally consumes synthetic stock.'}
 Write-Host 'PASS M114-D API-level scenarios complete. Existing QA shift remains OPEN.'
}catch{Write-Host "STOP: $($_.Exception.Message)";$global:LASTEXITCODE=1}
finally{
 $results|ConvertTo-Json -Depth 6|Set-Content (Join-Path $report 'results.json')
 $ids|Set-Content (Join-Path $report 'test_local_sale_ids.txt')
 Write-Host "REPORT: $report"
 Remove-Item Env:M114C_QA_TOKEN -ErrorAction SilentlyContinue
}
if($global:LASTEXITCODE -eq 1){exit 1}

