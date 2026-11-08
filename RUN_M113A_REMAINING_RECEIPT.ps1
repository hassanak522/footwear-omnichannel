param(
 [switch]$Execute,
 [switch]$ConfirmApiUsesTestDatabase,
 [string]$Root='G:\footwear-omnichannel'
)
$ErrorActionPreference='Stop'
$Db='footwear_omnichannel_test'
$Base='http://127.0.0.1:3002/api/v1'
$Id='3979feb7-f7bf-4049-8293-2fb6711d254a'
$Variant='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f'
$Wh='87a6cd9a-ff80-41f4-869c-669b63068fce'
$Branch='0b0cc789-66ce-462b-9f94-f3ab33739975'
$Key='m113a-existing-partial8-remaining3-20261105-v1'
$Report=Join-Path $Root ('security-checks\M113A_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $Report -Force | Out-Null
$Checks=New-Object System.Collections.Generic.List[object]
function Check($name,$status,$detail){$script:Checks.Add([pscustomobject]@{Check=$name;Status=$status;Detail=$detail});Write-Host "$name : $status - $detail"}
function Sql([string]$query){$output=$query | docker exec -i footwear-postgres psql -U footwear -d $Db -X -A -t -v ON_ERROR_STOP=1 2>&1;if($LASTEXITCODE -ne 0){throw "SQL failed: $($output -join ' ')"};return (($output -join "`n").Trim())}
function Snapshot(){return (Sql @"
BEGIN READ ONLY;
SELECT 'TRANSFER',t.id,t.status,i."dispatchedQty",i."receivedQty",i."damagedQty",i."shortageQty" FROM "StockTransfer" t JOIN "StockTransferItem" i ON i."transferId"=t.id WHERE t.id='$Id';
SELECT 'BALANCE',"locationId","onHand",quarantined FROM "StockBalance" WHERE "variantId"='$Variant' AND "locationId" IN ('$Wh','$Branch') ORDER BY "locationId";
SELECT 'RECEIPTS',count(*),coalesce(sum("receivedQty"),0),coalesce(sum("damagedQty"),0) FROM "StockTransferReceipt" WHERE "transferId"='$Id';
SELECT 'MOVEMENTS',count(*),coalesce(sum("quantityDelta"),0) FROM "StockMovement" WHERE "referenceId"='$Id' AND type='TRANSFER_RECEIPT';
SELECT 'REPLAY_EVENTS',count(*) FROM "IntegrationEvent" WHERE "idempotencyKey"='$Key';
COMMIT;
"@)}
function ApiCall([string]$method,[string]$path,[string]$token,$data=$null){$args=@{Uri="$Base$path";Method=$method;Headers=@{Authorization="Bearer $token"};UseBasicParsing=$true;TimeoutSec=45};if($null -ne $data){$args.ContentType='application/json';$args.Body=($data|ConvertTo-Json -Depth 10 -Compress)};try{$r=Invoke-WebRequest @args;return [pscustomobject]@{Code=[int]$r.StatusCode;Body=($r.Content|ConvertFrom-Json)}}catch{$status=0;$detail=$_.Exception.Message;if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode;try{$reader=New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream());$detail=$reader.ReadToEnd();$reader.Dispose()}catch{}};throw "HTTP $status $method $path : $detail"}}
try{
 Write-Host "M113-A EXISTING PARTIAL RECEIPT - $(if($Execute){'EXECUTE'}else{'READ ONLY'})" -ForegroundColor Cyan
 if((Sql 'SELECT current_database();') -ne $Db){throw 'Wrong database'}
 $state=Sql "SELECT t.status||'|'||t.`"sourceId`"||'|'||t.`"destinationId`"||'|'||i.`"variantId`"||'|'||i.`"dispatchedQty`"||'|'||i.`"receivedQty`"||'|'||i.`"damagedQty`"||'|'||i.`"shortageQty`" FROM `"StockTransfer`" t JOIN `"StockTransferItem`" i ON i.`"transferId`"=t.id WHERE t.id='$Id';"
 $fields=$state.Split('|')
 if($fields.Count -ne 8 -or $fields[1] -ne $Wh -or $fields[2] -ne $Branch -or $fields[3] -ne $Variant -or $fields[4] -ne '8'){throw "Unexpected transfer identity or quantities: $state"}
 $snapshotBefore=Snapshot
 $snapshotBefore|Set-Content (Join-Path $Report 'before.txt')
 Check 'TEST DATABASE AND TRANSFER' 'PASS' "status=$($fields[0]); dispatched=$($fields[4]); received=$($fields[5]); damaged=$($fields[6]); shortage=$($fields[7])"
 $health=Invoke-WebRequest -Uri "$Base/health" -UseBasicParsing -TimeoutSec 10
 if($health.StatusCode -ne 200){throw 'API health not 200'}
 Check 'API 3002 HEALTH' 'PASS' 'HTTP 200; database connection must be independently verified'
 if(-not $Execute){Check 'WRITES' 'SKIPPED' 'Use -Execute only after verifying API 3002 database connection';return}
 if(-not $ConfirmApiUsesTestDatabase){throw 'Explicit API database confirmation required'}
 if($fields[0] -ne 'PARTIALLY_RECEIVED' -or $fields[5] -ne '5' -or $fields[6] -ne '0' -or $fields[7] -ne '0'){throw 'Transfer is not in the exact expected pre-receipt state; no writes attempted'}
 if((Sql "SELECT count(*) FROM `"IntegrationEvent`" WHERE `"idempotencyKey`"='$Key';") -ne '0'){throw 'Receipt idempotency key already used; no writes attempted'}
 $s=Read-Host 'Password for m112-manager-a@localhost.invalid' -AsSecureString
 $c=[pscredential]::new('m112-manager-a@localhost.invalid',$s)
 $loginBody=@{email='m112-manager-a@localhost.invalid';password=$c.GetNetworkCredential().Password}|ConvertTo-Json
 try{$login=Invoke-RestMethod -Uri "$Base/auth/login" -Method POST -ContentType 'application/json' -Body $loginBody -TimeoutSec 30}finally{$loginBody=$null;$c=$null;$s=$null}
 if(-not $login.accessToken){throw 'Login response missing accessToken'}
 $token=[string]$login.accessToken
 $locations=ApiCall GET '/inventory/locations' $token
 if(-not @($locations.Body|Where-Object {$_.id -eq $Branch}).Count){throw 'Branch A assignment missing'}
 Check 'BRANCH A AUTHORIZATION' 'PASS' 'Login and location assignment verified'
 $body=@{idempotencyKey=$Key;items=@(@{variantId=$Variant;receivedQty=3;damagedQty=0})}
 $first=ApiCall POST "/transfers/$Id/receive" $token $body
 if($first.Code -notin @(200,201) -or $first.Body.id -ne $Id -or $first.Body.status -ne 'RECEIVED'){throw "Unexpected first receipt response: HTTP $($first.Code), status $($first.Body.status)"}
 Check 'REMAINING 3 RECEIVED' 'PASS' "HTTP $($first.Code); status RECEIVED"
 $second=ApiCall POST "/transfers/$Id/receive" $token $body
 if($second.Code -notin @(200,201) -or $second.Body.id -ne $Id -or $second.Body.status -ne 'RECEIVED'){throw 'Receipt replay failed'}
 Check 'RECEIPT REPLAY' 'PASS' "HTTP $($second.Code); status RECEIVED"
 $stateAfter=Sql "SELECT t.status||'|'||i.`"receivedQty`"||'|'||i.`"damagedQty`"||'|'||i.`"shortageQty`" FROM `"StockTransfer`" t JOIN `"StockTransferItem`" i ON i.`"transferId`"=t.id WHERE t.id='$Id';"
 if($stateAfter -ne 'RECEIVED|8|0|0'){throw "Unexpected cumulative quantities: $stateAfter"}
 Check 'CUMULATIVE RECEIPT' 'PASS' $stateAfter
 $keyReceipts=Sql "SELECT count(*)||'|'||coalesce(sum(`"receivedQty`"),0) FROM `"StockTransferReceipt`" WHERE `"transferId`"='$Id' AND `"idempotencyKey`"='$Key';"
 if($keyReceipts -ne '1|3'){throw "Unexpected receipt history: $keyReceipts"}
 Check 'RECEIPT HISTORY' 'PASS' 'Exactly one new receipt of 3'
 $keyMoves=Sql "SELECT count(*)||'|'||coalesce(sum(`"quantityDelta`"),0) FROM `"StockMovement`" WHERE `"referenceId`"='$Id' AND `"idempotencyKey`"='transfer:${Id}:receive:${Key}:${Variant}';"
 if($keyMoves -ne '1|3'){throw "Unexpected stock movements: $keyMoves"}
 Check 'STOCK MOVEMENT' 'PASS' 'Exactly one new +3 movement'
 $snapshotAfter=Snapshot
 $snapshotAfter|Set-Content (Join-Path $Report 'after.txt')
 Check 'DATABASE SNAPSHOTS' 'PASS' 'before.txt and after.txt saved'
}catch{Check 'EXECUTION' 'FAIL' $_.Exception.Message;Write-Host 'STOP: Do not rerun -Execute; share the report.' -ForegroundColor Red}finally{$Checks|Export-Csv (Join-Path $Report 'M113A_SUMMARY.csv') -NoTypeInformation;Write-Host "Report: $Report" -ForegroundColor Cyan}
