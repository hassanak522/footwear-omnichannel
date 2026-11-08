param(
 [string]$ApiBase='http://127.0.0.1:3001/api/v1',
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$AssignedLocationId,
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$OtherLocationId
)
$ErrorActionPreference='Stop'
if($AssignedLocationId -eq $OtherLocationId){throw 'Assigned and other location IDs must differ.'}
if($ApiBase -notmatch '^https?://(127\.0\.0\.1|localhost)(:\d+)?/api/v1/?$'){throw 'For safety, run against a local development API only.'}
Write-Host 'Use a BRANCH_MANAGER test account assigned ONLY to AssignedLocationId.'
Write-Host 'Do not paste credentials or token into chat, logs, or screenshots.'
$secret=Read-Host 'Paste short-lived manager access token (input hidden)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
if([string]::IsNullOrWhiteSpace($token)){throw 'Empty token.'}
$endpoint=$ApiBase.TrimEnd('/')+'/finance-guardrails/period-locks?locationId='
function Get-Status([string]$url,[string]$bearer){
 try {
  $r=Invoke-WebRequest -Uri $url -Method Get -Headers @{Authorization="Bearer $bearer"} -UseBasicParsing -TimeoutSec 30
  return [int]$r.StatusCode
 }catch{
  if($_.Exception.Response){return [int]$_.Exception.Response.StatusCode}
  throw "Request failed (network or server unavailable): $($_.Exception.Message)"
 }
}
try{
 $assigned=Get-Status ($endpoint+$AssignedLocationId) $token
 $other=Get-Status ($endpoint+$OtherLocationId) $token
 $expired=Get-Status ($endpoint+$AssignedLocationId) 'intentionally.invalid.jwt'
 $results=@(
  [pscustomobject]@{Test='Assigned location GET';Actual=$assigned;Expected='200';Pass=($assigned -eq 200)},
  [pscustomobject]@{Test='Other location GET';Actual=$other;Expected='403';Pass=($other -eq 403)},
  [pscustomobject]@{Test='Invalid JWT GET';Actual=$expired;Expected='401';Pass=($expired -eq 401)}
 )
 $results | Format-Table -AutoSize
 if($results.Where({-not $_.Pass}).Count){throw 'Authorization tests failed. Do not proceed with role changes until investigated.'}
 Write-Host 'PASS: all three read-only branch authorization checks.'
}finally{$token=$null;$secret.Dispose()}
