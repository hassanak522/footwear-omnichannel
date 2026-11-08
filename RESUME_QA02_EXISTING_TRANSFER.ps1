param(
 [switch]$Execute,
 [switch]$ConfirmApiUsesTestDatabase,
 [string]$Root='G:\footwear-omnichannel'
)
$ErrorActionPreference='Stop'
$Base='http://127.0.0.1:3002/api/v1'
$TransferId='a95ba4e3-fc3b-4e30-918b-bb41d4098add'
$CreateKey='qa02-NORMAL_10-create-2a9eabdd136241da8cb62f7300a2f807'
$Wh='87a6cd9a-ff80-41f4-869c-669b63068fce'
$Branch='0b0cc789-66ce-462b-9f94-f3ab33739975'
$Variant='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f'
$Db='footwear_omnichannel_test'
$Report=Join-Path $Root ('security-checks\QA02_RESUME_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $Report -Force | Out-Null
$Checks=New-Object System.Collections.Generic.List[object]
function Check($name,$status,$detail){$script:Checks.Add([pscustomobject]@{Check=$name;Status=$status;Detail=$detail});Write-Host "$name : $status - $detail"}
function Sql($query){$result=$query | docker exec -i footwear-postgres psql -U footwear -d $Db -X -A -t -v ON_ERROR_STOP=1 2>&1;if($LASTEXITCODE -ne 0){throw "SQL failure: $($result -join ' ')"};return ($result -join "`n").Trim()}
function Login($email){$s=Read-Host "Password for $email" -AsSecureString;$c=[pscredential]::new($email,$s);$body=@{email=$email;password=$c.GetNetworkCredential().Password}|ConvertTo-Json;try{$response=Invoke-RestMethod -Uri "$Base/auth/login" -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 30;if(-not $response.accessToken){throw 'Login response missing accessToken'};return [string]$response.accessToken}finally{$body=$null;$c=$null;$s=$null}}
function Call($method,$path,$token,$data=$null){$args=@{Uri="$Base$path";Method=$method;Headers=@{Authorization="Bearer $token"};UseBasicParsing=$true;TimeoutSec=40};if($null -ne $data){$args.ContentType='application/json';$args.Body=$data|ConvertTo-Json -Depth 12 -Compress};try{$r=Invoke-WebRequest @args;return [pscustomobject]@{Code=[int]$r.StatusCode;Body=($r.Content|ConvertFrom-Json)}}catch{$status=0;$detail=$_.Exception.Message;if($_.Exception.Response){$status=[int]$_.Exception.Response.StatusCode;try{$stream=$_.Exception.Response.GetResponseStream();$reader=New-Object IO.StreamReader($stream);$detail=$reader.ReadToEnd();$reader.Dispose()}catch{}};throw "HTTP $status $method $path : $detail"}}
function AssertResponse($label,$response,$status,$id){if($response.Code -notin @(200,201)){throw "$label returned HTTP $($response.Code)"};if($response.Body.status -ne $status){throw "$label unexpected status $($response.Body.status), expected $status"};if($response.Body.id -ne $id){throw "$label returned different transfer id"};Check $label 'PASS' "HTTP $($response.Code), $status, same transfer ID"}
try{
 Write-Host "QA02 EXISTING TRANSFER RESUME - $(if($Execute){'EXECUTE'}else{'READ ONLY'})" -ForegroundColor Cyan
 if((Sql 'SELECT current_database();') -ne $Db){throw 'Safety stop: wrong DB'}
 $state=Sql "SELECT status||'|'||`"sourceId`"||'|'||`"destinationId`"||'|'||(SELECT `"requestedQty`" FROM `"StockTransferItem`" WHERE `"transferId`"=t.id LIMIT 1) FROM `"StockTransfer`" t WHERE id='$TransferId';"
 if(-not $state){throw 'Expected transfer missing'}
 $fields=$state.Split('|')
 if($fields[1] -ne $Wh -or $fields[2] -ne $Branch -or $fields[3] -ne '10'){throw "Safety stop: transfer mismatch: $state"}
 $keyCount=Sql "SELECT count(*) FROM `"IntegrationEvent`" WHERE `"idempotencyKey`"='$CreateKey' AND source='TRANSFER_CREATE' AND `"eventType`"='$TransferId';"
 if($keyCount -ne '1'){throw 'Safety stop: original idempotency event missing or ambiguous'}
 Check 'ISOLATED DB AND TRANSFER' 'PASS' "Current status $($fields[0]); exact original event present"
 $snapshot=@'
BEGIN READ ONLY;
SELECT t.id,t.status,i."requestedQty",i."dispatchedQty",i."receivedQty",i."damagedQty" FROM "StockTransfer" t JOIN "StockTransferItem" i ON i."transferId"=t.id WHERE t.id='a95ba4e3-fc3b-4e30-918b-bb41d4098add';
SELECT "locationId","variantId","onHand","reservedOnline","reservedReplenish",quarantined FROM "StockBalance" WHERE "variantId"='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f' AND "locationId" IN ('87a6cd9a-ff80-41f4-869c-669b63068fce','0b0cc789-66ce-462b-9f94-f3ab33739975');
SELECT type,"quantityDelta","locationId","referenceId" FROM "StockMovement" WHERE "referenceId"='a95ba4e3-fc3b-4e30-918b-bb41d4098add' ORDER BY "createdAt";
COMMIT;
'@
 $snapshot|Set-Content (Join-Path $Report 'verification.sql')
 (Sql $snapshot)|Set-Content (Join-Path $Report 'before.txt')
 if(-not $Execute){Check 'WRITES' 'SKIPPED' 'Run with -Execute -ConfirmApiUsesTestDatabase after verifying API process environment';return}
 if(-not $ConfirmApiUsesTestDatabase){throw 'Safety stop: explicit API 3002 DB confirmation required'}
 if($fields[0] -ne 'REQUESTED'){throw "Safety stop: transfer already $($fields[0]); no write attempted"}
 $health=Invoke-WebRequest -Uri "$Base/health" -UseBasicParsing -TimeoutSec 10
 if($health.StatusCode -ne 200){throw 'API 3002 unhealthy'}
 $whToken=Login 'm109-test@localhost.invalid'
 $branchToken=Login 'm112-manager-a@localhost.invalid'
 $w=Call GET '/inventory/locations' $whToken
 if(-not @($w.Body|Where-Object id -eq $Wh).Count){throw 'Warehouse account missing assignment'}
 $b=Call GET '/inventory/locations' $branchToken
 if(-not @($b.Body|Where-Object id -eq $Branch).Count){throw 'Branch account missing assignment'}
 Check 'ROLE AND LOCATION ACCESS' 'PASS' 'Warehouse and Branch A assigned'
 $create=@{sourceId=$Wh;destinationId=$Branch;items=@(@{variantId=$Variant;quantity=10});idempotencyKey=$CreateKey}
 $r=Call POST '/transfers' $whToken $create
 AssertResponse 'ORIGINAL CREATE REPLAY' $r 'REQUESTED' $TransferId
 $count=Sql "SELECT count(*) FROM `"StockTransfer`" WHERE id='$TransferId';"
 if($count -ne '1'){throw 'Unexpected transfer count'}
 # Each action uses a stable deterministic key, making replays traceable.
 $approve=@{idempotencyKey='qa02-resume-normal10-approve-20261105'}
 $r=Call POST "/transfers/$TransferId/approve" $whToken $approve
 AssertResponse 'APPROVE' $r 'APPROVED' $TransferId
 $r=Call POST "/transfers/$TransferId/approve" $whToken $approve
 AssertResponse 'APPROVE REPLAY' $r 'APPROVED' $TransferId
 $dispatch=@{idempotencyKey='qa02-resume-normal10-dispatch-20261105'}
 $r=Call POST "/transfers/$TransferId/dispatch" $whToken $dispatch
 AssertResponse 'DISPATCH' $r 'DISPATCHED' $TransferId
 $r=Call POST "/transfers/$TransferId/dispatch" $whToken $dispatch
 AssertResponse 'DISPATCH REPLAY' $r 'DISPATCHED' $TransferId
 $receive=@{idempotencyKey='qa02-resume-normal10-receive-20261105';items=@(@{variantId=$Variant;receivedQty=10;damagedQty=0})}
 $r=Call POST "/transfers/$TransferId/receive" $branchToken $receive
 AssertResponse 'RECEIVE' $r 'RECEIVED' $TransferId
 $r=Call POST "/transfers/$TransferId/receive" $branchToken $receive
 AssertResponse 'RECEIVE REPLAY' $r 'RECEIVED' $TransferId
 (Sql $snapshot)|Set-Content (Join-Path $Report 'after.txt')
 Check 'DATABASE SNAPSHOT' 'PASS' 'before.txt and after.txt saved'
}catch{Check 'EXECUTION' 'FAIL' $_.Exception.Message;Write-Host 'STOP: do not rerun write mode; send report first' -ForegroundColor Red}finally{$Checks|Export-Csv (Join-Path $Report 'QA02_RESUME_SUMMARY.csv') -NoTypeInformation;Write-Host "Report: $Report" -ForegroundColor Cyan}
