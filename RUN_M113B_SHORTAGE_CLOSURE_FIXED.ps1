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
$Report=Join-Path $Root ('security-checks\M113B_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $Report -Force | Out-Null
$Checks=New-Object System.Collections.Generic.List[object]
$Ids=[ordered]@{TransferId='';CreateKey='';ApproveKey='';DispatchKey='';ReceiveKey='';CloseKey=''}
function Record([string]$Name,[string]$Status,[string]$Detail){$script:Checks.Add([pscustomobject]@{Check=$Name;Status=$Status;Detail=$Detail});Write-Host "$Name : $Status - $Detail" -ForegroundColor $(if($Status -eq 'PASS'){'Green'}elseif($Status -eq 'FAIL'){'Red'}else{'Yellow'})}
function Sql([string]$Query){$o=$Query | docker exec -i footwear-postgres psql -U footwear -d $Db -X -A -t -v ON_ERROR_STOP=1 2>&1;if($LASTEXITCODE -ne 0){throw "SQL failure: $($o -join ' ')"};return (($o -join "`n").Trim())}
function Key([string]$Suffix){return ('m113b-'+$Suffix+'-'+[guid]::NewGuid().ToString('N'))}
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
 Write-Host "M113-B SHORTAGE CLOSURE - $(if($Execute){'EXECUTE'}else{'READ-ONLY'})" -ForegroundColor Cyan
 if((Sql 'SELECT current_database();') -ne $Db){throw 'Wrong database'}
 if((Sql "SELECT count(*) FROM `"Location`" WHERE active=true AND id IN ('$Wh','$Branch');") -ne '2'){throw 'Synthetic locations unavailable'}
 if((Sql "SELECT count(*) FROM `"ProductVariant`" WHERE active=true AND id='$Variant';") -ne '1'){throw 'Synthetic variant unavailable'}
 $stock=Sql "SELECT (`"onHand`"-`"reservedOnline`"-`"reservedReplenish`"-quarantined-`"safetyBuffer`") FROM `"StockBalance`" WHERE `"locationId`"='$Wh' AND `"variantId`"='$Variant';"
 $health=Invoke-WebRequest -Uri "$Base/health" -UseBasicParsing -TimeoutSec 15
 if([int]$health.StatusCode -ne 200){throw 'API health failed'}
 Record 'ISOLATED PREFLIGHT' 'PASS' "Test DB and API 3002 healthy; warehouse available=$stock; API process DB must be independently confirmed"
 if($Execute -and -not $ConfirmApiUsesTestDatabase){throw 'SAFETY STOP: Confirm running API 3002 uses isolated DB'}
 Snapshot 'before'
 if(-not $Execute){Record 'WRITES' 'SKIPPED' 'Read-only mode';return}
 if(-not $ConfirmApiUsesTestDatabase){throw 'SAFETY STOP: Confirm running API 3002 uses isolated DB'}
 if([int]$stock -lt 4){throw 'SAFETY STOP: fewer than 4 available warehouse units'}
 $w=Login 'm109-test@localhost.invalid';$a=Login 'm112-manager-a@localhost.invalid'
 $r=Request 'GET' '/inventory/locations' $w;Expect 'WAREHOUSE ACCESS' $r @(200)
 if(-not @($r.Data|Where-Object {$_.id -eq $Wh}).Count){throw 'Warehouse manager not assigned to test warehouse'}
 $r=Request 'GET' '/inventory/locations' $a;Expect 'BRANCH ACCESS' $r @(200)
 if(-not @($r.Data|Where-Object {$_.id -eq $Branch}).Count){throw 'Branch manager not assigned to test branch'}
 $Ids.CreateKey=Key 'create';$body=@{sourceId=$Wh;destinationId=$Branch;items=@(@{variantId=$Variant;quantity=4});idempotencyKey=$Ids.CreateKey}
 $r=Request 'POST' '/transfers' $w $body;Expect 'CREATE 4' $r @(200,201) 'REQUESTED';$Ids.TransferId=[string]$r.Data.id;if(-not $Ids.TransferId){throw 'No transfer ID returned'}
 $r=Request 'POST' '/transfers' $w $body;Expect 'CREATE REPLAY' $r @(200,201);if($r.Data.id -ne $Ids.TransferId){throw 'Create replay ID mismatch'}
 $id=$Ids.TransferId
 $Ids.ApproveKey=Key 'approve';$r=Request 'POST' "/transfers/$id/approve" $w @{idempotencyKey=$Ids.ApproveKey};Expect 'APPROVE' $r @(200,201) 'APPROVED'
 $Ids.DispatchKey=Key 'dispatch';$r=Request 'POST' "/transfers/$id/dispatch" $w @{idempotencyKey=$Ids.DispatchKey};Expect 'DISPATCH' $r @(200,201) 'DISPATCHED'
 $Ids.ReceiveKey=Key 'receive';$receipt=@{idempotencyKey=$Ids.ReceiveKey;items=@(@{variantId=$Variant;receivedQty=2;damagedQty=0})}
 $r=Request 'POST' "/transfers/$id/receive" $a $receipt;Expect 'PARTIAL RECEIVE 2' $r @(200,201) 'PARTIALLY_RECEIVED'
 $state=Sql "SELECT t.status||'|'||i.`"dispatchedQty`"||'|'||i.`"receivedQty`"||'|'||i.`"shortageQty`" FROM `"StockTransfer`" t JOIN `"StockTransferItem`" i ON i.`"transferId`"=t.id WHERE t.id='$id';"
 if($state -ne 'PARTIALLY_RECEIVED|4|2|0'){throw "Unexpected partial state $state"};Record 'PARTIAL STATE' 'PASS' $state
 Snapshot 'before_closure'
 $r=Request 'POST' "/transfers/$id/close-shortage" $w @{idempotencyKey=(Key 'empty-reason');reason=''};Expect 'EMPTY REASON REJECTED' $r @(400)
 $r=Request 'POST' "/transfers/$id/close-shortage" $a @{idempotencyKey=(Key 'unauthorized');reason='Unauthorized branch closure attempt'};Expect 'BRANCH MANAGER DENIED' $r @(401,403)
 $state=Sql "SELECT status FROM `"StockTransfer`" WHERE id='$id';";if($state -ne 'PARTIALLY_RECEIVED'){throw "Negative tests changed transfer: $state"};Record 'NEGATIVE TESTS NO MUTATION' 'PASS' $state
 $Ids.CloseKey=Key 'close';$reason='QA synthetic shipment: 2 units confirmed missing after reconciliation; test-only shortage closure.';$close=@{idempotencyKey=$Ids.CloseKey;reason=$reason}
 $r=Request 'POST' "/transfers/$id/close-shortage" $w $close;Expect 'SHORTAGE CLOSE' $r @(200,201) 'SHORTAGE_CLOSED'
 $r=Request 'POST' "/transfers/$id/close-shortage" $w $close;Expect 'SHORTAGE CLOSE REPLAY' $r @(200,201) 'SHORTAGE_CLOSED'
 $r=Request 'POST' "/transfers/$id/close-shortage" $w @{idempotencyKey=(Key 'double-close');reason='Attempt to close the same shortage again'};Expect 'SECOND CLOSURE REJECTED' $r @(409)
 $r=Request 'POST' "/transfers/$id/receive" $a @{idempotencyKey=(Key 'after-close-receive');items=@(@{variantId=$Variant;receivedQty=2;damagedQty=0})};Expect 'RECEIPT AFTER CLOSURE REJECTED' $r @(409)
 $state=Sql "SELECT t.status||'|'||i.`"dispatchedQty`"||'|'||i.`"receivedQty`"||'|'||i.`"damagedQty`"||'|'||i.`"shortageQty`" FROM `"StockTransfer`" t JOIN `"StockTransferItem`" i ON i.`"transferId`"=t.id WHERE t.id='$id';"
 if($state -ne 'SHORTAGE_CLOSED|4|2|0|2'){throw "Unexpected closed state $state"};Record 'CUMULATIVE QUANTITIES' 'PASS' $state
 $movement=Sql "SELECT count(*)||'|'||coalesce(sum(`"quantityDelta`"),0) FROM `"StockMovement`" WHERE `"referenceId`"='$id' AND type='TRANSFER_RECEIPT';"
 if($movement -ne '1|2'){throw "Unexpected receipt stock movements $movement"};Record 'NO PHANTOM RECEIPT STOCK' 'PASS' $movement
 $dispatch=Sql "SELECT count(*)||'|'||coalesce(sum(`"quantityDelta`"),0) FROM `"StockMovement`" WHERE `"referenceId`"='$id' AND type='TRANSFER_DISPATCH';"
 if($dispatch -ne '1|-4'){throw "Unexpected dispatch movements $dispatch"};Record 'DISPATCH MOVEMENT' 'PASS' $dispatch
 $events=Sql "SELECT count(*) FROM `"IntegrationEvent`" WHERE `"idempotencyKey`"='$($Ids.CloseKey)' AND source='TRANSFER_SHORTAGE_CLOSE';"
 if($events -ne '1'){throw "Expected one shortage closure idempotency event; got $events"};Record 'CLOSURE IDEMPOTENCY EVENT' 'PASS' 'Exactly one event'
 $audit=Sql "SELECT count(*) FROM `"AuditLog`" WHERE `"entityType`"='StockTransfer' AND `"entityId`"='$id' AND action='TRANSFER_SHORTAGE_CLOSE' AND after::text LIKE '%$reason%';"
 if($audit -ne '1'){throw "Expected one shortage closure audit with reason; got $audit"};Record 'AUDIT REASON' 'PASS' 'Exactly one closure audit with mandatory reason'
 Snapshot 'after'
 Record 'DATABASE SNAPSHOTS' 'PASS' 'before, before_closure and after saved'
}catch{Record 'EXECUTION' 'FAIL' $_.Exception.Message;Write-Host 'STOP: Do not rerun execution; upload report and API error logs.' -ForegroundColor Red;try{Snapshot 'failure'}catch{}}finally{$Ids|ConvertTo-Json | Set-Content (Join-Path $Report 'ids.json');$Checks|Export-Csv (Join-Path $Report 'M113B_SUMMARY.csv') -NoTypeInformation;Write-Host "Report: $Report" -ForegroundColor Cyan}
