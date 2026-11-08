param(
  [switch]$Execute,
  [switch]$ConfirmApiUsesTestDatabase,
  [string]$Root = 'G:\footwear-omnichannel'
)
$ErrorActionPreference = 'Stop'
$DbName='footwear_omnichannel_test'
$Warehouse='87a6cd9a-ff80-41f4-869c-669b63068fce'
$Branch='0b0cc789-66ce-462b-9f94-f3ab33739975'
$Variant='4c49064f-5d8a-40ee-8a1d-b5c2ad7a0e8f'
$Api='http://127.0.0.1:3002/api/v1'
$Report=Join-Path $Root ('security-checks\M113C_D_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Force -Path $Report | Out-Null
$results=New-Object System.Collections.Generic.List[object]
$ids=[ordered]@{transferA='';transferB='';winner='';loser='';createA='';createB='';approveA='';approveB='';dispatch='';receive=''}
function Record([string]$name,[string]$status,[string]$detail) {
  $results.Add([pscustomobject]@{Test=$name;Status=$status;Detail=$detail})
  Write-Host "$name : $status - $detail"
}
function Sql([string]$statement) {
  $output = $statement | & docker exec -i footwear-postgres psql -U footwear -d $DbName -X -q -t -A -v ON_ERROR_STOP=1 2>&1
  if($LASTEXITCODE -ne 0){throw "QA SQL error: $($output -join ' ')"}
  return (($output | Out-String).Trim())
}
function ApiCall([string]$method,[string]$path,[object]$body,[string]$token) {
  $headers=@{}; if($token){$headers.Authorization="Bearer $token"}
  $params=@{Uri="$Api$path";Method=$method;Headers=$headers;UseBasicParsing=$true;TimeoutSec=60;ErrorAction='Stop'}
  if($null -ne $body){$params.ContentType='application/json';$params.Body=($body|ConvertTo-Json -Depth 12 -Compress)}
  try {
    $r=Invoke-WebRequest @params
    $data=$null; if($r.Content){$data=$r.Content|ConvertFrom-Json}
    return [pscustomobject]@{Status=[int]$r.StatusCode;Data=$data}
  } catch {
    $code=0
    if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode}
    return [pscustomobject]@{Status=$code;Data=$null}
  }
}
function Require([bool]$condition,[string]$label,[string]$detail) {
  if(-not $condition){Record $label 'FAIL' $detail;throw $detail}
  Record $label 'PASS' $detail
}
function NewKey([string]$prefix){return "m113cd-$prefix-$([guid]::NewGuid().ToString('N'))"}
function Login([string]$email,[securestring]$password) {
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
  try {$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $r=ApiCall 'POST' '/auth/login' @{email=$email;password=$plain} ''
  $plain=$null
  if($r.Status -ne 200 -and $r.Status -ne 201){throw "Login failed HTTP $($r.Status) for $email"}
  $token=$null
  foreach($field in @('accessToken','access_token','token')){if($r.Data.PSObject.Properties.Name -contains $field){$token=$r.Data.$field;break}}
  if(-not $token -and $r.Data.data){foreach($field in @('accessToken','access_token','token')){if($r.Data.data.PSObject.Properties.Name -contains $field){$token=$r.Data.data.$field;break}}}
  if(-not $token){throw 'Login response token field not recognized; no writes made'}
  return $token
}
try {
  Write-Host "M113-C SCENARIO D - $(if($Execute){'EXECUTE'}else{'READ-ONLY'})"
  $availableRaw=Sql @"
SELECT ("onHand"-"reservedOnline"-"reservedReplenish"-"quarantined"-"safetyBuffer")
FROM "StockBalance" WHERE "locationId"='$Warehouse' AND "variantId"='$Variant';
"@
  $available=0
  Require ([int]::TryParse($availableRaw,[ref]$available)) 'QA database' "available=$availableRaw"
  $health=ApiCall 'GET' '/health' $null ''
  Require ($health.Status -eq 200) 'API health' 'HTTP 200 (does not verify DB isolation)'
  if(-not $Execute){Record 'Writes' 'SKIPPED' 'Read-only preflight';return}
  if(-not $ConfirmApiUsesTestDatabase){throw 'SAFETY STOP: -ConfirmApiUsesTestDatabase is required'}
  if($available -ne 3){throw "SAFETY STOP: expected exactly 3 available units, found $available; no writes performed"}
  Write-Host 'SAFETY: Confirm independently that the running API 3002 uses footwear_omnichannel_test.'
  $whPass=Read-Host 'Password for m109-test@localhost.invalid' -AsSecureString
  $brPass=Read-Host 'Password for m112-manager-a@localhost.invalid' -AsSecureString
  $whToken=Login 'm109-test@localhost.invalid' $whPass
  $brToken=Login 'm112-manager-a@localhost.invalid' $brPass
  $whPass=$null;$brPass=$null
  Record 'Authentication' 'PASS' 'Both QA accounts authenticated'
  $ids.createA=NewKey 'createa';$ids.createB=NewKey 'createb'
  $ids.approveA=NewKey 'approvea';$ids.approveB=NewKey 'approveb'
  foreach($name in @('A','B')){
    $key=if($name -eq 'A'){$ids.createA}else{$ids.createB}
    $r=ApiCall 'POST' '/transfers' @{sourceId=$Warehouse;destinationId=$Branch;items=@(@{variantId=$Variant;quantity=2});idempotencyKey=$key} $whToken
    if($r.Status -ne 201 -or -not $r.Data.id){throw "Create $name failed HTTP $($r.Status); stop without retry"}
    if($name -eq 'A'){$ids.transferA=[string]$r.Data.id}else{$ids.transferB=[string]$r.Data.id}
    Record "Create $name" 'PASS' "HTTP 201; transfer=$($r.Data.id)"
  }
  $ids|ConvertTo-Json|Set-Content (Join-Path $Report 'ids.json')
  $before=Sql "SELECT `"onHand`",`"reservedReplenish`" FROM `"StockBalance`" WHERE `"locationId`"='$Warehouse' AND `"variantId`"='$Variant';"
  $before|Set-Content (Join-Path $Report 'before_race.txt')
  $jobs=@()
  foreach($name in @('A','B')){
    $transfer=if($name -eq 'A'){$ids.transferA}else{$ids.transferB}
    $key=if($name -eq 'A'){$ids.approveA}else{$ids.approveB}
    $jobs+=Start-Job -ArgumentList $name,"$Api/transfers/$transfer/approve",$key,$whToken -ScriptBlock {
      param($name,$url,$key,$token)
      $body=@{idempotencyKey=$key}|ConvertTo-Json -Compress
      try {
        $r=Invoke-WebRequest -Uri $url -Method POST -Headers @{Authorization="Bearer $token"} -Body $body -ContentType 'application/json' -UseBasicParsing -TimeoutSec 65
        [pscustomobject]@{Name=$name;Code=[int]$r.StatusCode}
      }catch{
        $code=0;if($_.Exception.Response){$code=[int]$_.Exception.Response.StatusCode}
        [pscustomobject]@{Name=$name;Code=$code}
      }
    }
  }
  $null=$jobs|Wait-Job -Timeout 85
  $responses=@($jobs|Receive-Job)
  $jobs|Remove-Job -Force
  $responses|Export-Csv (Join-Path $Report 'concurrent_approvals.csv') -NoTypeInformation
  $description=($responses|ForEach-Object{"$($_.Name)=$($_.Code)"}) -join ','
  Record 'Concurrent approval responses' 'INFO' $description
  Require ($responses.Count -eq 2 -and @($responses|Where-Object Code -eq 201).Count -eq 1 -and @($responses|Where-Object Code -eq 409).Count -eq 1) 'Approval contention' "Expected one HTTP 201 and one HTTP 409; got $description"
  $winnerName=($responses|Where-Object Code -eq 201|Select-Object -First 1).Name
  $ids.winner=if($winnerName -eq 'A'){$ids.transferA}else{$ids.transferB}
  $ids.loser=if($winnerName -eq 'A'){$ids.transferB}else{$ids.transferA}
  $reserved=Sql "SELECT `"reservedReplenish`" FROM `"StockBalance`" WHERE `"locationId`"='$Warehouse' AND `"variantId`"='$Variant';"
  Require ($reserved -eq '2') 'Reservation integrity' "reservedReplenish=$reserved (expected 2)"
  $states=Sql "SELECT id::text || '|' || status::text FROM `"StockTransfer`" WHERE id IN ('$($ids.transferA)'::uuid,'$($ids.transferB)'::uuid) ORDER BY id;"
  $states|Set-Content (Join-Path $Report 'transfer_states.txt')
  Require ($states -match 'APPROVED' -and $states -match 'REQUESTED') 'Transfer states' 'One APPROVED, one REQUESTED'
  $ids.dispatch=NewKey 'dispatch';$ids.receive=NewKey 'receive'
  $ids|ConvertTo-Json|Set-Content (Join-Path $Report 'ids.json')
  $dispatch=ApiCall 'POST' "/transfers/$($ids.winner)/dispatch" @{idempotencyKey=$ids.dispatch} $whToken
  Require ($dispatch.Status -eq 201 -and $dispatch.Data.status -eq 'DISPATCHED') 'Winner dispatch' "HTTP $($dispatch.Status)"
  $receipt=ApiCall 'POST' "/transfers/$($ids.winner)/receive" @{idempotencyKey=$ids.receive;items=@(@{variantId=$Variant;receivedQty=2;damagedQty=0})} $brToken
  Require ($receipt.Status -eq 201 -and $receipt.Data.status -eq 'RECEIVED') 'Winner receipt' "HTTP $($receipt.Status)"
  $after=Sql "SELECT `"onHand`" || '|' || `"reservedReplenish`" FROM `"StockBalance`" WHERE `"locationId`"='$Warehouse' AND `"variantId`"='$Variant';"
  $after|Set-Content (Join-Path $Report 'after.txt')
  Require ($after -eq '1|0') 'Final warehouse balance' "onHand|reservedReplenish=$after (expected 1|0)"
  $movement=Sql "SELECT COUNT(*)::text || '|' || COALESCE(SUM(`"quantityDelta`"),0)::text FROM `"StockMovement`" WHERE `"referenceType`"='STOCK_TRANSFER' AND `"referenceId`"='$($ids.winner)'::uuid AND type='TRANSFER_DISPATCH';"
  Require ($movement -eq '1|-2') 'Single dispatch movement' $movement
  $loserState=Sql "SELECT status::text FROM `"StockTransfer`" WHERE id='$($ids.loser)'::uuid;"
  Require ($loserState -eq 'REQUESTED') 'Losing transfer unchanged' $loserState
  Record 'M113-C scenario D' 'PASS' 'Approval contention prevented oversubscription; reservation released through dispatch'
}catch{
  Record 'Execution' 'FAIL' $_.Exception.Message
  Write-Host 'STOP: Do not rerun -Execute; inspect report and transfer IDs.'
}finally{
  $ids|ConvertTo-Json|Set-Content (Join-Path $Report 'ids.json')
  $results|Export-Csv (Join-Path $Report 'summary.csv') -NoTypeInformation
  Write-Host "Report: $Report"
}
