param([switch]$Execute,[switch]$ConfirmApiUsesTestDatabase)
$ErrorActionPreference='Stop'
$root='G:\footwear-omnichannel'; $api='http://127.0.0.1:3002/api/v1'
$wh='87a6cd9a-ff80-41f4-869c-669b63068fce';$br='0b0cc789-66ce-462b-9f94-f3ab33739975';$variant='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f'
$report=Join-Path $root ('security-checks\M113C_FINAL_'+(Get-Date -Format yyyyMMdd_HHmmss));New-Item -ItemType Directory -Force -Path $report|Out-Null
$results=New-Object System.Collections.Generic.List[object];$ids=New-Object System.Collections.Generic.List[object]
function Log($name,$ok,$detail){$state=if($ok){'PASS'}else{'FAIL'};Write-Host "$name : $state - $detail";$results.Add([pscustomobject]@{Check=$name;Result=$state;Detail=[string]$detail});Save;if(-not $ok){throw "STOP at $name : $detail"}}
function Save{$results|Export-Csv (Join-Path $report 'summary.csv') -NoTypeInformation;ConvertTo-Json -InputObject @($ids.ToArray()) -Depth 6|Set-Content (Join-Path $report 'ids.json')}
function SQL([string]$q){$out=$q|docker exec -i footwear-postgres psql -U footwear -d footwear_omnichannel_test -X -v ON_ERROR_STOP=1 -A -t -F '|' 2>&1;if($LASTEXITCODE -ne 0){throw "Database query failed: $out"};return (($out|Out-String).Trim())}
function Key([string]$prefix){return "m113cf-$prefix-$([guid]::NewGuid().ToString('N'))"}
function Login([string]$email,[string]$password){$body=@{email=$email;password=$password}|ConvertTo-Json; $r=Invoke-RestMethod -Uri "$api/auth/login" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 45; $t=$r.access_token;if(-not $t){$t=$r.accessToken};if(-not $t){$t=$r.token};if(-not $t -and $r.data){$t=$r.data.accessToken};if(-not $t){throw "Login response did not include recognized access token field"};return [string]$t}
function Post([string]$path,[object]$body,[string]$token){$json=ConvertTo-Json -InputObject $body -Depth 12 -Compress;try{$r=Invoke-WebRequest -UseBasicParsing -Uri "$api$path" -Method Post -ContentType 'application/json' -Headers @{Authorization="Bearer $token"} -Body $json -TimeoutSec 90;return [pscustomobject]@{Code=[int]$r.StatusCode;Body=($r.Content|ConvertFrom-Json)}}catch{ $code=0;if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode};return [pscustomobject]@{Code=$code;Error=$_.Exception.Message}}}
function ExpectPost($label,$path,$body,$token){$r=Post $path $body $token;Log $label ($r.Code -eq 201) "HTTP $($r.Code)";return $r.Body}
function CreateTransfer([int]$qty,[string]$token,[string]$label){$dto=@{sourceId=$wh;destinationId=$br;items=@(@{variantId=$variant;quantity=$qty});idempotencyKey=(Key 'create')};$t=ExpectPost "$label create" '/transfers' $dto $token;$id=[string]$t.id;if($id -notmatch '^[0-9a-fA-F-]{36}$'){throw 'Create returned invalid transfer ID'};$ids.Add([pscustomobject]@{Scenario=$label;TransferId=$id;Quantity=$qty});Save;return $id}
function Approve($id,$token,$label){[void](ExpectPost "$label approve" "/transfers/$id/approve" @{idempotencyKey=(Key 'approve')} $token)}
function Dispatch($id,$token,$label){[void](ExpectPost "$label dispatch" "/transfers/$id/dispatch" @{idempotencyKey=(Key 'dispatch')} $token)}
function Receive($id,$qty,$token,$label){[void](ExpectPost "$label receive" "/transfers/$id/receive" @{idempotencyKey=(Key 'receive');items=@(@{variantId=$variant;receivedQty=$qty;damagedQty=0})} $token)}
function State($id){return SQL "SELECT t.status::text || '|' || i.`"dispatchedQty`" || '|' || i.`"receivedQty`" || '|' || i.`"damagedQty`" || '|' || i.`"shortageQty`" FROM `"StockTransfer`" t JOIN `"StockTransferItem`" i ON i.`"transferId`"=t.id WHERE t.id='$id'::uuid"}
function Count($table,$id,$where='TRUE'){return [int](SQL "SELECT count(*) FROM `"$table`" WHERE `"transferId`"='$id'::uuid AND ($where)")}
function Movement($id,$type){return (SQL "SELECT count(*)::text || '|' || COALESCE(sum(`"quantityDelta`"),0)::text FROM `"StockMovement`" WHERE `"referenceType`"='STOCK_TRANSFER' AND `"referenceId`"='$id' AND type='$type'")}
function Race($label,$pathA,$bodyA,$tokenA,$pathB,$bodyB,$tokenB){$requests=@(@{Path=$pathA;Body=$bodyA;Token=$tokenA},@{Path=$pathB;Body=$bodyB;Token=$tokenB});$jobs=@();foreach($req in $requests){$jobs+=Start-Job -ArgumentList $api,$req.Path,($req.Body|ConvertTo-Json -Depth 12 -Compress),$req.Token -ScriptBlock {param($base,$path,$json,$token);try{$r=Invoke-WebRequest -UseBasicParsing -Uri "$base$path" -Method Post -ContentType 'application/json' -Headers @{Authorization="Bearer $token"} -Body $json -TimeoutSec 90;[pscustomobject]@{Code=[int]$r.StatusCode;Error=''}}catch{$c=0;if($_.Exception.Response){$c=[int]$_.Exception.Response.StatusCode};[pscustomobject]@{Code=$c;Error=$_.Exception.Message}}}};try{$done=$jobs|Wait-Job -Timeout 115;if(@($done).Count -ne 2){throw "Timed out waiting for concurrent requests"};$responses=@($jobs|Receive-Job);$codes=@($responses|ForEach-Object {$_.Code});Write-Host "$label : INFO - HTTP $($codes -join ',')";($responses|ConvertTo-Json -Depth 5)|Set-Content (Join-Path $report (($label -replace '[^A-Za-z0-9]','_')+'.json'));return $codes}finally{$jobs|Remove-Job -Force -ErrorAction SilentlyContinue}}
}
try{
Write-Host ('M113-C FINAL RACES - '+$(if($Execute){'EXECUTE'}else{'READ-ONLY'}))
$stock=SQL "SELECT `"onHand`"-`"reservedOnline`"-`"reservedReplenish`"-`"quarantined`"-`"safetyBuffer`" FROM `"StockBalance`" WHERE `"locationId`"='$wh' AND `"variantId`"='$variant'";Log 'QA DATABASE' ($stock -match '^\d+$') "Warehouse available=$stock; isolated database queried directly"
$health=Invoke-WebRequest -UseBasicParsing -Uri "$api/health" -TimeoutSec 12;Log 'API HEALTH' ($health.StatusCode -eq 200) 'HTTP 200 (does NOT prove API database isolation)'
if(-not $Execute){Write-Host 'WRITES : SKIPPED - Read-only mode';Write-Host "Report: $report";return}
if(-not $ConfirmApiUsesTestDatabase){throw 'SAFETY STOP: -ConfirmApiUsesTestDatabase required'}
if([int]$stock -lt 10){throw 'SAFETY STOP: Need >=10 available units for these scenarios'}
Write-Host 'SAFETY: You must independently verify that API 3002 points to footwear_omnichannel_test before running.'
$wpass=Read-Host 'Password for m109-test@localhost.invalid' -AsSecureString;$bpass=Read-Host 'Password for m112-manager-a@localhost.invalid' -AsSecureString
function Plain($secure){$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}}
$wt=Login 'm109-test@localhost.invalid' (Plain $wpass);$bt=Login 'm112-manager-a@localhost.invalid' (Plain $bpass);Remove-Variable wpass,bpass -ErrorAction SilentlyContinue
Log 'AUTH' ($wt.Length -gt 20 -and $bt.Length -gt 20) 'Warehouse and branch authenticated'
# A: two different keys race for the final 2 units of a 2-unit transfer.
$a=CreateTransfer 2 $wt 'A';Approve $a $wt 'A';Dispatch $a $wt 'A'
$ra=@{idempotencyKey=(Key 'receiveA');items=@(@{variantId=$variant;receivedQty=2;damagedQty=0})};$rb=@{idempotencyKey=(Key 'receiveB');items=@(@{variantId=$variant;receivedQty=2;damagedQty=0})}
$codes=Race 'A_DifferentKeyReceive' "/transfers/$a/receive" $ra $bt "/transfers/$a/receive" $rb $bt
Log 'A HTTP' ((@($codes|Where-Object {$_ -eq 201}).Count -eq 1) -and (@($codes|Where-Object {$_ -in @(409,400)}).Count -eq 1)) "codes=$($codes -join ',')"
Log 'A state' ((State $a) -eq 'RECEIVED|2|2|0|0') (State $a)
Log 'A receipt history' ((Count 'StockTransferReceipt' $a) -eq 1) 'Exactly one'
Log 'A movement' ((Movement $a 'TRANSFER_RECEIPT') -eq '1|2') (Movement $a 'TRANSFER_RECEIPT')
# B: race receipt of final 2 units versus shortage close, after receiving first unit.
$b=CreateTransfer 3 $wt 'B';Approve $b $wt 'B';Dispatch $b $wt 'B';Receive $b 1 $bt 'B initial'
$rec=@{idempotencyKey=(Key 'raceReceive');items=@(@{variantId=$variant;receivedQty=2;damagedQty=0})};$close=@{idempotencyKey=(Key 'raceClose');reason='M113C controlled synthetic shortage race test'}
$codes=Race 'B_ReceiptVsClose' "/transfers/$b/receive" $rec $bt "/transfers/$b/close-shortage" $close $wt
Log 'B HTTP' ((@($codes|Where-Object {$_ -eq 201}).Count -eq 1) -and (@($codes|Where-Object {$_ -in @(409,400)}).Count -eq 1)) "codes=$($codes -join ',')"
$bs=State $b;Log 'B consistent final state' ($bs -in @('RECEIVED|3|3|0|0','SHORTAGE_CLOSED|3|1|0|2')) $bs
$expectedMovement=if($bs.StartsWith('RECEIVED')){'2|3'}else{'1|1'};Log 'B movement' ((Movement $b 'TRANSFER_RECEIPT') -eq $expectedMovement) (Movement $b 'TRANSFER_RECEIPT')
$expectedReceipt=if($bs.StartsWith('RECEIVED')){2}else{1};Log 'B receipt history' ((Count 'StockTransferReceipt' $b) -eq $expectedReceipt) "count=$(Count 'StockTransferReceipt' $b)"
# C: two different keys try to close same outstanding 1 unit.
$c=CreateTransfer 2 $wt 'C';Approve $c $wt 'C';Dispatch $c $wt 'C';Receive $c 1 $bt 'C initial'
$c1=@{idempotencyKey=(Key 'close1');reason='M113C synthetic closure attempt number one'};$c2=@{idempotencyKey=(Key 'close2');reason='M113C synthetic closure attempt number two'}
$codes=Race 'C_TwoShortageClosures' "/transfers/$c/close-shortage" $c1 $wt "/transfers/$c/close-shortage" $c2 $wt
Log 'C HTTP' ((@($codes|Where-Object {$_ -eq 201}).Count -eq 1) -and (@($codes|Where-Object {$_ -in @(409,400)}).Count -eq 1)) "codes=$($codes -join ',')"
Log 'C state' ((State $c) -eq 'SHORTAGE_CLOSED|2|1|0|1') (State $c)
$eventCount=[int](SQL "SELECT count(*) FROM `"IntegrationEvent`" WHERE source='TRANSFER_SHORTAGE_CLOSE' AND payload->>'transferId'='$c'");Log 'C single closure event' ($eventCount -eq 1) "count=$eventCount"
# D: two concurrent approvals, each wants more than half remaining stock; only one reservation can succeed.
$available=[int](SQL "SELECT `"onHand`"-`"reservedOnline`"-`"reservedReplenish`"-`"quarantined`"-`"safetyBuffer`" FROM `"StockBalance`" WHERE `"locationId`"='$wh' AND `"variantId`"='$variant'")
$q=[int][math]::Floor($available*0.65);if($q -lt 1 -or (2*$q) -le $available){throw "Insufficient stock to create approval contention (available=$available)"}
$d1=CreateTransfer $q $wt 'D1';$d2=CreateTransfer $q $wt 'D2'
$codes=Race 'D_CompetingApprovals' "/transfers/$d1/approve" @{idempotencyKey=(Key 'approve1')} $wt "/transfers/$d2/approve" @{idempotencyKey=(Key 'approve2')} $wt
Log 'D HTTP' ((@($codes|Where-Object {$_ -eq 201}).Count -eq 1) -and (@($codes|Where-Object {$_ -in @(409,400)}).Count -eq 1)) "codes=$($codes -join ',')"
$ds=SQL "SELECT string_agg(status::text,',' ORDER BY status::text) FROM `"StockTransfer`" WHERE id IN ('$d1'::uuid,'$d2'::uuid)";Log 'D one approval' ($ds -eq 'APPROVED,REQUESTED') $ds
$reserved=SQL "SELECT `"reservedReplenish`" FROM `"StockBalance`" WHERE `"locationId`"='$wh' AND `"variantId`"='$variant'";Log 'D reservations within stock' ([int]$reserved -le [int](SQL "SELECT `"onHand`" FROM `"StockBalance`" WHERE `"locationId`"='$wh' AND `"variantId`"='$variant'")) "reserved=$reserved"
# Release synthetic reservation by completing the approved transfer.
$approvedId=if((SQL "SELECT status::text FROM `"StockTransfer`" WHERE id='$d1'::uuid") -eq 'APPROVED'){$d1}else{$d2}
Dispatch $approvedId $wt 'D cleanup';Receive $approvedId $q $bt 'D cleanup'
Log 'D reservation released' ([int](SQL "SELECT `"reservedReplenish`" FROM `"StockBalance`" WHERE `"locationId`"='$wh' AND `"variantId`"='$variant'") -eq 0) 'No residual replenish reservation'
Write-Host "COMPLETE: All M113-C final race checks passed. Report: $report"
}catch{Write-Host "STOP: $($_.Exception.Message)";Write-Host 'Do not rerun -Execute; inspect report and transfer IDs.';Write-Host "Report: $report";exit 1}finally{Save}
