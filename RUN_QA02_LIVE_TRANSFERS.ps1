param(
 [string]$Root='G:\footwear-omnichannel',
 [string]$WarehouseEmail='',
 [string]$BranchEmail='m112-manager-a@localhost.invalid',
 [switch]$Execute,
 [switch]$ConfirmApiUsesTestDatabase
)
$ErrorActionPreference='Stop'
$Base='http://127.0.0.1:3002/api/v1'
$Db='footwear_omnichannel_test'
$Wh='87a6cd9a-ff80-41f4-869c-669b63068fce'
$Branch='0b0cc789-66ce-462b-9f94-f3ab33739975'
$Variant='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f'
$Stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
$Report=Join-Path $Root "security-checks\QA02_LIVE_TRANSFERS_$Stamp"
New-Item -ItemType Directory -Path $Report -Force | Out-Null
$Results=New-Object System.Collections.Generic.List[object]
function Record([string]$Name,[string]$Status,[string]$Detail) {
 $script:Results.Add([pscustomobject]@{Check=$Name;Status=$Status;Detail=$Detail})
 Write-Host "$Name : $Status - $Detail" -ForegroundColor $(if($Status -eq 'PASS'){'Green'}elseif($Status -eq 'FAIL'){'Red'}else{'Yellow'})
}
function DbQuery([string]$Sql){
 $output = $Sql | docker exec -i footwear-postgres psql -U footwear -d $Db -X -A -t -v ON_ERROR_STOP=1 2>&1
 if($LASTEXITCODE -ne 0){throw "Database query failed: $($output -join ' ')"}
 return @($output)
}
function Request([string]$Method,[string]$Path,[string]$Token,[object]$Data=$null){
 $args=@{Uri="$Base$Path";Method=$Method;TimeoutSec=45;UseBasicParsing=$true;Headers=@{Authorization="Bearer $Token"}}
 if($null -ne $Data){$args.ContentType='application/json';$args.Body=($Data | ConvertTo-Json -Depth 12 -Compress)}
 try{
  $r=Invoke-WebRequest @args
  $obj=$null
  if($r.Content){try{$obj=$r.Content|ConvertFrom-Json}catch{$obj=$r.Content}}
  return [pscustomobject]@{Code=[int]$r.StatusCode;Data=$obj}
 }catch{
  if($_.Exception.Response){
   $code=[int]$_.Exception.Response.StatusCode
   return [pscustomobject]@{Code=$code;Data=$null}
  }
  throw
 }
}
function Login([string]$Email){
 $s=Read-Host "Password for $Email" -AsSecureString
 $c=[pscredential]::new($Email,$s)
 $body=@{email=$Email;password=$c.GetNetworkCredential().Password}|ConvertTo-Json
 try{$r=Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
  if(-not $r.accessToken){throw 'Missing accessToken'}
  return [string]$r.accessToken
 }finally{$body=$null;$c=$null;$s=$null}
}
function Expect([string]$Name,[object]$Response,[int[]]$Codes){
 if($Response.Code -in $Codes){Record $Name 'PASS' "HTTP $($Response.Code)"}else{Record $Name 'FAIL' "HTTP $($Response.Code); expected $($Codes -join '/')";throw "$Name failed"}
}
function Key([string]$Name){return "qa02-$Name-$([guid]::NewGuid().ToString('N'))"}
function Transfer([string]$Name,[int]$Qty,[int]$Received,[int]$Damaged,[string]$WhToken,[string]$BranchToken){
 $create=@{sourceId=$Wh;destinationId=$Branch;items=@(@{variantId=$Variant;quantity=$Qty});idempotencyKey=(Key "$Name-create")}
 $r=Request 'POST' '/transfers' $WhToken $create;Expect "$Name CREATE" $r @(200,201)
 $id=[string]$r.Data.id;if(-not $id){throw "$Name returned no transfer ID"}
 $r2=Request 'POST' '/transfers' $WhToken $create;Expect "$Name CREATE REPLAY" $r2 @(200,201)
 if($r2.Data.id -ne $id){Record "$Name CREATE REPLAY ID" 'FAIL' 'Different transfer ID';throw 'Replay created duplicate'}
 Record "$Name CREATE REPLAY ID" 'PASS' 'Same transfer ID'
 $a=@{idempotencyKey=(Key "$Name-approve")};$r=Request 'POST' "/transfers/$id/approve" $WhToken $a;Expect "$Name APPROVE" $r @(200,201)
 $r=Request 'POST' "/transfers/$id/approve" $WhToken $a;Expect "$Name APPROVE REPLAY" $r @(200,201)
 $d=@{idempotencyKey=(Key "$Name-dispatch")};$r=Request 'POST' "/transfers/$id/dispatch" $WhToken $d;Expect "$Name DISPATCH" $r @(200,201)
 $r=Request 'POST' "/transfers/$id/dispatch" $WhToken $d;Expect "$Name DISPATCH REPLAY" $r @(200,201)
 $receipt=@{idempotencyKey=(Key "$Name-receive");items=@(@{variantId=$Variant;receivedQty=$Received;damagedQty=$Damaged})}
 $r=Request 'POST' "/transfers/$id/receive" $BranchToken $receipt;Expect "$Name RECEIVE" $r @(200,201)
 $expected=if($Received+$Damaged -eq $Qty){'RECEIVED'}else{'PARTIALLY_RECEIVED'}
 if($r.Data.status -ne $expected){Record "$Name STATUS" 'FAIL' "Expected $expected; got $($r.Data.status)";throw 'Unexpected status'}
 Record "$Name STATUS" 'PASS' $expected
 $r=Request 'POST' "/transfers/$id/receive" $BranchToken $receipt;Expect "$Name RECEIVE REPLAY" $r @(200,201)
 return [pscustomobject]@{Name=$Name;Id=$id;Qty=$Qty;Received=$Received;Damaged=$Damaged;Status=$expected}
}
try {
 Write-Host "QA02 LIVE TRANSFERS - Mode: $(if($Execute){'EXECUTE'}else{'PREFLIGHT'})" -ForegroundColor Cyan
 $identity=(DbQuery 'SELECT current_database();'|Select-Object -First 1).Trim()
 if($identity -ne $Db){throw "SAFETY STOP: Unexpected DB $identity"}
 Record 'TEST DATABASE' 'PASS' $identity
 $locs=DbQuery "SELECT count(*) FROM `"Location`" WHERE active=true AND ((id='$Wh' AND type='WAREHOUSE') OR (id='$Branch' AND type='BRANCH'));"
 if(($locs|Select-Object -First 1).Trim() -ne '2'){throw 'SAFETY STOP: Expected active warehouse and branch missing'}
 Record 'SYNTHETIC LOCATIONS' 'PASS' 'Warehouse and Branch A active'
 $v=DbQuery "SELECT count(*) FROM `"ProductVariant`" WHERE id='$Variant' AND active=true;"
 if(($v|Select-Object -First 1).Trim() -ne '1'){throw 'SAFETY STOP: Test variant not active'}
 Record 'TEST VARIANT' 'PASS' $Variant
 $health=Invoke-WebRequest -Uri "$Base/health" -TimeoutSec 10 -UseBasicParsing
 if($health.StatusCode -ne 200){throw 'Test API health failed'}
 Record 'TEST API HEALTH' 'PASS' 'HTTP 200 on port 3002'
 if(-not $Execute){
  Record 'WRITE TESTS' 'SKIPPED' 'Preflight mode. No API writes attempted.'
  Write-Host 'To execute, restart API 3002 with verified test DATABASE_URL, then run -Execute -ConfirmApiUsesTestDatabase -WarehouseEmail <email>.' -ForegroundColor Yellow
  return
 }
 if(-not $ConfirmApiUsesTestDatabase){throw 'SAFETY STOP: Confirm API 3002 DATABASE_URL points to footwear_omnichannel_test before using -ConfirmApiUsesTestDatabase'}
 if([string]::IsNullOrWhiteSpace($WarehouseEmail)){throw 'Supply -WarehouseEmail (do not supply password on command line)'}
 $whToken=Login $WarehouseEmail
 $branchToken=Login $BranchEmail
 $l=Request 'GET' '/inventory/locations' $whToken
 Expect 'WAREHOUSE LOGIN AND API ACCESS' $l @(200)
 if(-not @($l.Data|Where-Object id -eq $Wh).Count){throw 'SAFETY STOP: warehouse user not assigned to test warehouse'}
 $l=Request 'GET' '/inventory/locations' $branchToken
 Expect 'BRANCH LOGIN AND API ACCESS' $l @(200)
 if(-not @($l.Data|Where-Object id -eq $Branch).Count){throw 'SAFETY STOP: branch user not assigned to Branch A'}
 # Fixture adjustment through the application API; existing reservations remain untouched.
 $fixtureKey=Key 'fixture'
 $adjust=@{locationId=$Wh;variantId=$Variant;delta=40;reason='QA02 isolated synthetic transfer fixture';idempotencyKey=$fixtureKey}
 $r=Request 'POST' '/inventory/adjust' $whToken $adjust
 Expect 'FIXTURE STOCK ADJUSTMENT' $r @(200,201)
 $r=Request 'POST' '/inventory/adjust' $whToken $adjust
 Expect 'FIXTURE ADJUSTMENT REPLAY' $r @(200,201)
 $created=@()
 $created+=Transfer 'NORMAL_10' 10 10 0 $whToken $branchToken
 $created+=Transfer 'PARTIAL_8' 8 5 0 $whToken $branchToken
 $created+=Transfer 'DAMAGED_5' 5 3 2 $whToken $branchToken
 $bad=@{sourceId=$Wh;destinationId=$Branch;items=@(@{variantId=$Variant;quantity=999999});idempotencyKey=(Key 'insufficient-create')}
 $r=Request 'POST' '/transfers' $whToken $bad;Expect 'INSUFFICIENT CREATE' $r @(200,201)
 $badId=[string]$r.Data.id
 $r=Request 'POST' "/transfers/$badId/approve" $whToken @{idempotencyKey=(Key 'insufficient-approve')}
 Expect 'INSUFFICIENT STOCK REJECTION' $r @(409)
 $ids=($created|ForEach-Object {"'$($_.Id)'"}) -join ','
 $sql=@"
BEGIN READ ONLY;
SELECT t.id, t.status, t."sourceId", t."destinationId", i."requestedQty",i."dispatchedQty",i."receivedQty",i."damagedQty",
 (SELECT count(*) FROM "StockMovement" m WHERE m."referenceId"=t.id::text AND m.type='TRANSFER_DISPATCH') AS dispatch_movements,
 (SELECT count(*) FROM "StockMovement" m WHERE m."referenceId"=t.id::text AND m.type='TRANSFER_RECEIPT') AS receipt_movements
FROM "StockTransfer" t JOIN "StockTransferItem" i ON i."transferId"=t.id WHERE t.id IN ($ids) ORDER BY t.id;
SELECT "locationId", "variantId", "onHand", "reservedOnline", "reservedReplenish", quarantined, "safetyBuffer" FROM "StockBalance" WHERE "variantId"='$Variant' AND "locationId" IN ('$Wh','$Branch') ORDER BY "locationId";
COMMIT;
"@
 $sql | Set-Content (Join-Path $Report 'verification.sql') -Encoding UTF8
 $rows=DbQuery $sql
 $rows|Set-Content (Join-Path $Report 'verification_output.txt') -Encoding UTF8
 Record 'READ-ONLY DB VERIFICATION' 'PASS' 'Saved verification_output.txt; inspect quantities and movement counts'
 $created | Export-Csv (Join-Path $Report 'created_transfers.csv') -NoTypeInformation
} catch {
 Record 'EXECUTION' 'FAIL' $_.Exception.Message
 Write-Host 'STOPPED: inspect report and API logs before retrying. Do not rerun -Execute blindly: fixture writes may have committed.' -ForegroundColor Red
} finally {
 $Results | Export-Csv (Join-Path $Report 'QA02_LIVE_SUMMARY.csv') -NoTypeInformation
 $Results|Format-Table -AutoSize
 Write-Host "Report: $Report" -ForegroundColor Cyan
}
