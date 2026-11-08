param(
 [string]$Root='G:\footwear-omnichannel',
 [switch]$Execute,
 [switch]$ConfirmApiUsesTestDatabase
)
$ErrorActionPreference='Stop'
$Db='footwear_omnichannel_test'
$Base='http://127.0.0.1:3002/api/v1'
$Wh='87a6cd9a-ff80-41f4-869c-669b63068fce'
$Branch='0b0cc789-66ce-462b-9f94-f3ab33739975'
$Variant='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f'
$Report=Join-Path $Root ('security-checks\M113C_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $Report -Force | Out-Null
$Checks=New-Object System.Collections.Generic.List[object]
$Ids=[ordered]@{TransferId='';CreateKey='';ApproveKey='';DispatchKey='';ReceiveKey=''}
function Record([string]$Name,[string]$Status,[string]$Detail){$script:Checks.Add([pscustomobject]@{Check=$Name;Status=$Status;Detail=$Detail});Write-Host "$Name : $Status - $Detail" -ForegroundColor $(if($Status -eq 'PASS'){'Green'}elseif($Status -eq 'FAIL'){'Red'}else{'Yellow'})}
function Sql([string]$Query){$o=$Query | docker exec -i footwear-postgres psql -U footwear -d $Db -X -A -t -v ON_ERROR_STOP=1 2>&1;if($LASTEXITCODE -ne 0){throw "SQL failure: $($o -join ' ')"};return (($o -join "`n").Trim())}
function Key([string]$Suffix){return ('m113c-'+$Suffix+'-'+[guid]::NewGuid().ToString('N'))}
function Login([string]$Email){$s=Read-Host "Password for $Email" -AsSecureString;$c=[pscredential]::new($Email,$s);$body=@{email=$Email;password=$c.GetNetworkCredential().Password}|ConvertTo-Json;try{$r=Invoke-RestMethod -Uri "$Base/auth/login" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 30;if(-not $r.accessToken){throw 'Login response missing accessToken'};return [string]$r.accessToken}finally{$body=$null;$c=$null;$s=$null}}
function Request([string]$Method,[string]$Path,[string]$Token,[object]$Data=$null){$args=@{Uri="$Base$Path";Method=$Method;Headers=@{Authorization="Bearer $Token"};UseBasicParsing=$true;TimeoutSec=75};if($null -ne $Data){$args.ContentType='application/json';$args.Body=$Data|ConvertTo-Json -Depth 12 -Compress};$code=0;$raw='';try{$r=Invoke-WebRequest @args;$code=[int]$r.StatusCode;$raw=[string]$r.Content}catch{$raw=$_.Exception.Message;if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode;try{$reader=New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream());$raw=$reader.ReadToEnd();$reader.Dispose()}catch{}}};$parsed=$null;try{if($raw){$parsed=$raw|ConvertFrom-Json}}catch{};return [pscustomobject]@{Code=$code;Data=$parsed;Message=$raw}}
function Expect([string]$Name,$Response,[int[]]$Codes,[string]$Status=''){if($Response.Code -notin $Codes -or ($Status -and $Response.Data.status -ne $Status)){Record $Name 'FAIL' "HTTP $($Response.Code); status=$($Response.Data.status); expected HTTP $($Codes -join '/') $Status; $($Response.Message.Substring(0,[Math]::Min(350,$Response.Message.Length)))";throw "$Name failed"};Record $Name 'PASS' "HTTP $($Response.Code) $($Response.Data.status)"}
function Snapshot([string]$Name){$id=if($Ids.TransferId){$Ids.TransferId}else{"00000000-0000-0000-0000-000000000000"};$q=@"
BEGIN READ ONLY;
SELECT 'BALANCE',"locationId","onHand","reservedOnline","reservedReplenish",quarantined,"safetyBuffer" FROM "StockBalance" WHERE "variantId"='$Variant' AND "locationId" IN ('$Wh','$Branch') ORDER BY "locationId";
SELECT 'TRANSFER',t.id,t.status,i."requestedQty",i."dispatchedQty",i."receivedQty",i."damagedQty",i."shortageQty" FROM "StockTransfer" t JOIN "StockTransferItem" i ON i."transferId"=t.id WHERE t.id='$id';
SELECT 'MOVEMENTS',type,"quantityDelta","locationId","idempotencyKey" FROM "StockMovement" WHERE "referenceId"='$id' ORDER BY "createdAt";
SELECT 'RECEIPTS',"receivedQty","damagedQty","idempotencyKey" FROM "StockTransferReceipt" WHERE "transferId"='$id' ORDER BY "createdAt";
SELECT 'AUDIT',action,"entityId",after FROM "AuditLog" WHERE "entityType"='StockTransfer' AND "entityId"='$id' ORDER BY "createdAt";
COMMIT;
"@;Sql $q | Set-Content (Join-Path $Report "$Name.txt")}
try{
 Write-Host "M113-C CONCURRENT SAME-KEY RECEIPT - $(if($Execute){'EXECUTE'}else{'READ-ONLY'})" -ForegroundColor Cyan
 if((Sql 'SELECT current_database();') -ne $Db){throw 'Wrong database'}
 $stock=Sql "SELECT (`"onHand`"-`"reservedOnline`"-`"reservedReplenish`"-quarantined-`"safetyBuffer`") FROM `"StockBalance`" WHERE `"locationId`"='$Wh' AND `"variantId`"='$Variant';"
 $health=Invoke-WebRequest -Uri "$Base/health" -UseBasicParsing -TimeoutSec 15
 if([int]$health.StatusCode -ne 200){throw 'API 3002 unhealthy'}
 Record 'PREFLIGHT' 'PASS' "QA database accessible; warehouse available=$stock; API DB isolation must be independently verified"
 Snapshot 'before'
 if(-not $Execute){Record 'WRITES' 'SKIPPED' 'Read-only mode';return}
 if(-not $ConfirmApiUsesTestDatabase){throw 'SAFETY STOP: API isolation not confirmed'}
 if([int]$stock -lt 2){throw 'SAFETY STOP: insufficient synthetic warehouse inventory'}
 $w=Login 'm109-test@localhost.invalid';$a=Login 'm112-manager-a@localhost.invalid'
 $r=Request 'GET' '/inventory/locations' $w;Expect 'WAREHOUSE ACCESS' $r @(200)
 if(-not @($r.Data|Where-Object {$_.id -eq $Wh}).Count){throw 'Warehouse not assigned'}
 $r=Request 'GET' '/inventory/locations' $a;Expect 'BRANCH ACCESS' $r @(200)
 if(-not @($r.Data|Where-Object {$_.id -eq $Branch}).Count){throw 'Branch not assigned'}
 $Ids.CreateKey=Key 'create'
 $r=Request 'POST' '/transfers' $w @{sourceId=$Wh;destinationId=$Branch;items=@(@{variantId=$Variant;quantity=2});idempotencyKey=$Ids.CreateKey}
 Expect 'CREATE 2' $r @(200,201) 'REQUESTED'
 $Ids.TransferId=[string]$r.Data.id
 try{$null=[guid]::Parse($Ids.TransferId)}catch{throw 'Invalid transfer ID'}
 $id=$Ids.TransferId
 $Ids.ApproveKey=Key 'approve';$r=Request 'POST' "/transfers/$id/approve" $w @{idempotencyKey=$Ids.ApproveKey};Expect 'APPROVE' $r @(200,201) 'APPROVED'
 $Ids.DispatchKey=Key 'dispatch';$r=Request 'POST' "/transfers/$id/dispatch" $w @{idempotencyKey=$Ids.DispatchKey};Expect 'DISPATCH' $r @(200,201) 'DISPATCHED'
 Snapshot 'before_race'
 $Ids.ReceiveKey=Key 'receive'
 $payload=@{idempotencyKey=$Ids.ReceiveKey;items=@(@{variantId=$Variant;receivedQty=2;damagedQty=0})}|ConvertTo-Json -Depth 10 -Compress
 $url="$Base/transfers/$id/receive"
 $jobScript={param($Url,$Token,$Payload)
   Start-Sleep -Milliseconds 1200
   $code=0;$message=''
   try{$res=Invoke-WebRequest -Uri $Url -Method POST -Headers @{Authorization="Bearer $Token"} -ContentType 'application/json' -Body $Payload -UseBasicParsing -TimeoutSec 75;$code=[int]$res.StatusCode;$message=[string]$res.Content}
   catch{$message=$_.Exception.Message;if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode}}
   [pscustomobject]@{Code=$code;Response=$message}
 }
 $j1=Start-Job -ScriptBlock $jobScript -ArgumentList $url,$a,$payload
 $j2=Start-Job -ScriptBlock $jobScript -ArgumentList $url,$a,$payload
 try{
  $jobs=@($j1,$j2)
  $null=$jobs|Wait-Job -Timeout 100
  if(@($jobs|Where-Object {$_.State -ne 'Completed'}).Count){throw 'Concurrent requests timed out'}
  $out=@($jobs|Receive-Job)
 }finally{foreach($job in @($j1,$j2)){Remove-Job -Job $job -Force -ErrorAction SilentlyContinue}}
 $codes=@($out|ForEach-Object {$_.Code})
 $out|ForEach-Object {[pscustomobject]@{Code=$_.Code;Response=([string]$_.Response).Substring(0,[Math]::Min(500,([string]$_.Response).Length))}} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $Report 'concurrent_responses.json')
 Record 'CONCURRENT HTTP RESPONSES' 'INFO' ($codes -join ',')
 if(@($codes|Where-Object {$_ -ge 500 -or $_ -eq 0}).Count){throw "Server error/timeout in concurrent calls: $($codes -join ',')"}
 if(@($codes|Where-Object {$_ -notin @(200,201,409)}).Count){throw "Unexpected HTTP response: $($codes -join ',')"}
 $state=Sql "SELECT t.status||'|'||i.`"dispatchedQty`"||'|'||i.`"receivedQty`"||'|'||i.`"damagedQty`"||'|'||i.`"shortageQty`" FROM `"StockTransfer`" t JOIN `"StockTransferItem`" i ON i.`"transferId`"=t.id WHERE t.id='$id';"
 if($state -ne 'RECEIVED|2|2|0|0'){throw "Incorrect final state $state"}
 Record 'CUMULATIVE QUANTITY' 'PASS' $state
 $receipt=Sql "SELECT count(*)||'|'||coalesce(sum(`"receivedQty`"),0) FROM `"StockTransferReceipt`" WHERE `"transferId`"='$id';"
 if($receipt -ne '1|2'){throw "Duplicate receipt history: $receipt"}
 Record 'RECEIPT HISTORY' 'PASS' $receipt
 $movement=Sql "SELECT count(*)||'|'||coalesce(sum(`"quantityDelta`"),0) FROM `"StockMovement`" WHERE `"referenceId`"='$id' AND type='TRANSFER_RECEIPT';"
 if($movement -ne '1|2'){throw "Duplicate receipt movements: $movement"}
 Record 'STOCK MOVEMENT' 'PASS' $movement
 $dispatch=Sql "SELECT count(*)||'|'||coalesce(sum(`"quantityDelta`"),0) FROM `"StockMovement`" WHERE `"referenceId`"='$id' AND type='TRANSFER_DISPATCH';"
 if($dispatch -ne '1|-2'){throw "Dispatch mismatch: $dispatch"}
 Record 'DISPATCH MOVEMENT' 'PASS' $dispatch
 Snapshot 'after'
 Record 'DATABASE SNAPSHOTS' 'PASS' 'before, before_race, after saved'
}catch{Record 'EXECUTION' 'FAIL' $_.Exception.Message;Write-Host 'STOP: Do not rerun -Execute. Share report and API errors.' -ForegroundColor Red;try{Snapshot 'failure'}catch{}}finally{
 $Ids|ConvertTo-Json|Set-Content (Join-Path $Report 'ids.json')
 $Checks|Export-Csv (Join-Path $Report 'M113C_SUMMARY.csv') -NoTypeInformation
 Write-Host "Report: $Report" -ForegroundColor Cyan
}
