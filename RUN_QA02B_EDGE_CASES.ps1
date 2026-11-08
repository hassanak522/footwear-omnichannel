param(
 [string]$Root='G:\footwear-omnichannel',
 [switch]$Execute,
 [switch]$ConfirmApiUsesTestDatabase,
 [switch]$TestBranchB
)
$ErrorActionPreference='Stop'
$Base='http://127.0.0.1:3002/api/v1'
$Db='footwear_omnichannel_test'
$Wh='87a6cd9a-ff80-41f4-869c-669b63068fce'
$Branch='0b0cc789-66ce-462b-9f94-f3ab33739975'
$BranchB='46d6e7fe-8733-422e-83db-bd6b40bdb7d1'
$Variant='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f'
$Prefix='qa02b-edge-20261105'
$Report=Join-Path $Root ('security-checks\QA02B_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $Report -Force | Out-Null
$Results=New-Object System.Collections.Generic.List[object]
$Transfers=New-Object System.Collections.Generic.List[object]
function Record([string]$Name,[string]$Status,[string]$Detail){$script:Results.Add([pscustomobject]@{Test=$Name;Status=$Status;Detail=$Detail});Write-Host "$Name : $Status - $Detail" -ForegroundColor $(if($Status -eq 'PASS'){'Green'}elseif($Status -eq 'FAIL'){'Red'}else{'Yellow'})}
function Sql([string]$Query){$r=$Query | docker exec -i footwear-postgres psql -U footwear -d $Db -X -A -t -v ON_ERROR_STOP=1 2>&1;if($LASTEXITCODE -ne 0){throw "SQL error: $($r -join ' ')"};return ($r -join "`n").Trim()}
function Login([string]$Email){$s=Read-Host "Password for $Email" -AsSecureString;$c=[pscredential]::new($Email,$s);$body=@{email=$Email;password=$c.GetNetworkCredential().Password}|ConvertTo-Json;try{$r=Invoke-RestMethod -Uri "$Base/auth/login" -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 30;if(-not $r.accessToken){throw 'Login missing accessToken'};return [string]$r.accessToken}finally{$body=$null;$c=$null;$s=$null}}
function Request([string]$Method,[string]$Path,[string]$Token,[object]$Data=$null){$a=@{Uri="$Base$Path";Method=$Method;UseBasicParsing=$true;TimeoutSec=45;Headers=@{Authorization="Bearer $Token"}};if($null -ne $Data){$a.ContentType='application/json';$a.Body=($Data|ConvertTo-Json -Depth 12 -Compress)};try{$r=Invoke-WebRequest @a;$raw=$r.Content;$code=[int]$r.StatusCode}catch{$code=0;$raw=$_.Exception.Message;if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode;try{$rd=New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream());$raw=$rd.ReadToEnd();$rd.Dispose()}catch{}}};$obj=$null;try{if($raw){$obj=$raw|ConvertFrom-Json}}catch{};return [pscustomobject]@{Code=$code;Data=$obj;Message=([string]$raw).Substring(0,[Math]::Min(500,([string]$raw).Length))}}
function Expect([string]$Name,$Response,[int[]]$Codes,[string]$Status=''){if($Response.Code -notin $Codes){Record $Name 'FAIL' "HTTP $($Response.Code), expected $($Codes -join '/'): $($Response.Message)";throw "$Name failed"};if($Status -and $Response.Data.status -ne $Status){Record $Name 'FAIL' "Expected status $Status; got $($Response.Data.status)";throw "$Name failed"};Record $Name 'PASS' "HTTP $($Response.Code) $(if($Status){$Status})"}
function Key([string]$Label){return "$Prefix-$Label-$([guid]::NewGuid().ToString('N'))"}
function Create([string]$Label,[int]$Qty,[string]$Token){$dto=@{sourceId=$Wh;destinationId=$Branch;items=@(@{variantId=$Variant;quantity=$Qty});idempotencyKey=(Key "$Label-create")};$r=Request 'POST' '/transfers' $Token $dto;Expect "$Label CREATE" $r @(200,201) 'REQUESTED';$id=[string]$r.Data.id;if(-not $id){throw "$Label missing transfer ID"};$script:Transfers.Add([pscustomobject]@{Label=$Label;Id=$id;CreateKey=$dto.idempotencyKey;Quantity=$Qty});$r=Request 'POST' '/transfers' $Token $dto;Expect "$Label CREATE REPLAY" $r @(200,201);if($r.Data.id -ne $id){throw "$Label replay ID mismatch"};return $id}
function Action([string]$Label,[string]$Id,[string]$Verb,[string]$Token,[string]$Status){$dto=@{idempotencyKey=(Key "$Label-$Verb")};$r=Request 'POST' "/transfers/$Id/$Verb" $Token $dto;Expect "$Label $Verb" $r @(200,201) $Status;$r=Request 'POST' "/transfers/$Id/$Verb" $Token $dto;Expect "$Label $Verb REPLAY" $r @(200,201) $Status}
function Receive([string]$Label,[string]$Id,[int]$Received,[int]$Damaged,[string]$Token,[string]$Status){$dto=@{idempotencyKey=(Key "$Label-receive");items=@(@{variantId=$Variant;receivedQty=$Received;damagedQty=$Damaged})};$r=Request 'POST' "/transfers/$Id/receive" $Token $dto;Expect "$Label RECEIVE" $r @(200,201) $Status;$r=Request 'POST' "/transfers/$Id/receive" $Token $dto;Expect "$Label RECEIVE REPLAY" $r @(200,201) $Status}
function Snapshot([string]$Name){$q=@"
BEGIN READ ONLY;
SELECT 'BALANCE',"locationId","onHand","reservedOnline","reservedReplenish",quarantined,"safetyBuffer" FROM "StockBalance" WHERE "variantId"='$Variant' AND "locationId" IN ('$Wh','$Branch') ORDER BY "locationId";
SELECT 'TRANSFER',t.id,t.status,i."requestedQty",i."dispatchedQty",i."receivedQty",i."damagedQty" FROM "StockTransfer" t JOIN "StockTransferItem" i ON i."transferId"=t.id WHERE t."transferNumber" LIKE 'TR-%' AND t."createdAt" > NOW()-INTERVAL '2 days' ORDER BY t."createdAt" DESC LIMIT 15;
SELECT 'MOVEMENT',m."referenceId",m.type,m."quantityDelta",m."locationId" FROM "StockMovement" m WHERE m."referenceId" IN (SELECT id::text FROM "StockTransfer" WHERE "createdAt" > NOW()-INTERVAL '2 days') ORDER BY m."createdAt" DESC LIMIT 30;
COMMIT;
"@;Sql $q | Set-Content (Join-Path $Report "$Name.txt")}
try{
 Write-Host "QA02B EDGE CASES - $(if($Execute){'EXECUTE'}else{'READ-ONLY PREFLIGHT'})" -ForegroundColor Cyan
 if((Sql 'SELECT current_database();') -ne $Db){throw 'SAFETY STOP: unexpected database'}
 if((Sql "SELECT count(*) FROM `"Location`" WHERE active=true AND id IN ('$Wh','$Branch');") -ne '2'){throw 'SAFETY STOP: synthetic locations missing'}
 if((Sql "SELECT count(*) FROM `"ProductVariant`" WHERE active=true AND id='$Variant';") -ne '1'){throw 'SAFETY STOP: variant missing'}
 $health=Invoke-WebRequest -Uri "$Base/health" -UseBasicParsing -TimeoutSec 10;if($health.StatusCode -ne 200){throw 'API 3002 not healthy'}
 Record 'ISOLATED PREFLIGHT' 'PASS' 'Test DB, locations, variant and API 3002 verified (API database must also be checked separately)'
 $stock=Sql "SELECT (COALESCE(`"onHand`",0)-COALESCE(`"reservedOnline`",0)-COALESCE(`"reservedReplenish`",0)-COALESCE(quarantined,0)-COALESCE(`"safetyBuffer`",0)) FROM `"StockBalance`" WHERE `"locationId`"='$Wh' AND `"variantId`"='$Variant';"
 Record 'WAREHOUSE AVAILABLE STOCK' 'INFO' "$stock units; 13 required for partial + damaged tests"
 Snapshot 'before'
 $prior=Sql "SELECT count(*) FROM `"IntegrationEvent`" WHERE `"idempotencyKey`" LIKE '$Prefix%';"
 if($prior -ne '0'){throw "SAFETY STOP: QA02B keys already exist ($prior). Do not repeat this batch; inspect earlier report."}
 if(-not $Execute){Record 'WRITES' 'SKIPPED' 'No changes made; use -Execute only after confirming API 3002 database isolation';return}
 if(-not $ConfirmApiUsesTestDatabase){throw 'SAFETY STOP: confirm running API 3002 DATABASE_URL points to isolated test DB'}
 if([int]$stock -lt 13){throw "SAFETY STOP: only $stock units available. No automatic stock adjustment; inspect inventory first."}
 $w=Login 'm109-test@localhost.invalid';$a=Login 'm112-manager-a@localhost.invalid'
 $r=Request GET '/inventory/locations' $w;Expect 'WAREHOUSE ACCESS' $r @(200);if(-not @($r.Data|Where-Object id -eq $Wh).Count){throw 'Warehouse account lacks test warehouse access'}
 $r=Request GET '/inventory/locations' $a;Expect 'BRANCH A ACCESS' $r @(200);if(-not @($r.Data|Where-Object id -eq $Branch).Count){throw 'Branch A account lacks Branch A access'}
 $b=$null;if($TestBranchB){$b=Login 'm111-branch-b@localhost.invalid';$r=Request GET '/inventory/locations' $b;Expect 'BRANCH B ACCESS' $r @(200);if(-not @($r.Data|Where-Object id -eq $BranchB).Count){throw 'Branch B user lacks Branch B access'}}
 $partial=Create 'PARTIAL8' 8 $w
 if($b){$r=Request POST "/transfers/$partial/approve" $b @{idempotencyKey=(Key 'unauth-approve')};Expect 'BRANCH B APPROVE DENIED' $r @(401,403)}
 Action 'PARTIAL8' $partial 'approve' $w 'APPROVED'
 Action 'PARTIAL8' $partial 'dispatch' $w 'DISPATCHED'
 if($b){$r=Request POST "/transfers/$partial/receive" $b @{idempotencyKey=(Key 'unauth-receive');items=@(@{variantId=$Variant;receivedQty=5;damagedQty=0})};Expect 'BRANCH B RECEIVE DENIED' $r @(401,403)}
 Receive 'PARTIAL8' $partial 5 0 $a 'PARTIALLY_RECEIVED'
 $r=Request POST "/transfers/$partial/receive" $a @{idempotencyKey=(Key 'partial-followup');items=@(@{variantId=$Variant;receivedQty=3;damagedQty=0})}
 if($r.Code -eq 409){Record 'PARTIAL FOLLOW-UP' 'OBSERVATION' 'HTTP 409: application currently blocks further receipt after PARTIALLY_RECEIVED; requires product decision'}elseif($r.Code -in @(200,201)){Record 'PARTIAL FOLLOW-UP' 'OBSERVATION' "HTTP $($r.Code): follow-up accepted; inspect totals carefully"}else{Record 'PARTIAL FOLLOW-UP' 'FAIL' "HTTP $($r.Code): $($r.Message)";throw 'Unexpected follow-up response'}
 $damaged=Create 'DAMAGED5' 5 $w
 Action 'DAMAGED5' $damaged 'approve' $w 'APPROVED'
 Action 'DAMAGED5' $damaged 'dispatch' $w 'DISPATCHED'
 Receive 'DAMAGED5' $damaged 3 2 $a 'RECEIVED'
 $insufficient=Create 'INSUFFICIENT' 999999 $w
 $r=Request POST "/transfers/$insufficient/approve" $w @{idempotencyKey=(Key 'insufficient-approve')};Expect 'INSUFFICIENT STOCK REJECTED' $r @(409)
 $state=Sql "SELECT status FROM `"StockTransfer`" WHERE id='$insufficient';";if($state -ne 'REQUESTED'){throw "Insufficient transfer unexpectedly $state"};Record 'INSUFFICIENT STATE UNCHANGED' 'PASS' 'REQUESTED'
 Snapshot 'after'
 $Transfers|Export-Csv (Join-Path $Report 'transfer_ids.csv') -NoTypeInformation
 Record 'DATABASE SNAPSHOT' 'PASS' 'before.txt and after.txt saved; reconcile stock and movements'
}catch{Record 'EXECUTION' 'FAIL' $_.Exception.Message;Write-Host 'STOP: do not rerun -Execute; upload report for review.' -ForegroundColor Red;try{Snapshot 'failure_snapshot'}catch{}}finally{$Transfers|Export-Csv (Join-Path $Report 'transfer_ids.csv') -NoTypeInformation;$Results|Export-Csv (Join-Path $Report 'QA02B_SUMMARY.csv') -NoTypeInformation;Write-Host "Report: $Report" -ForegroundColor Cyan}
