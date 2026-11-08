param(
 [string]$ApiBase='http://127.0.0.1:3001/api/v1',
 [Parameter(Mandatory=$true)][guid]$AssignedLocationId,
 [Parameter(Mandatory=$true)][guid]$OtherLocationId
)
$ErrorActionPreference='Stop'
if($AssignedLocationId -eq $OtherLocationId){throw 'Branch IDs must differ.'}
if($ApiBase -notmatch '^http://(127\.0\.0\.1|localhost)(:\d+)?/api/v1/?$'){throw 'Only local HTTP development APIs are supported.'}
Write-Host 'Use a test BRANCH_MANAGER assigned to exactly one location. Do not use SUPER_ADMIN.'
$secret=Read-Host 'Short-lived test JWT (hidden)' -AsSecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{$token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
if([string]::IsNullOrWhiteSpace($token)){throw 'Empty JWT'}
function Status([string]$url,[string]$bearer){
 try{ $r=Invoke-WebRequest -UseBasicParsing -Uri $url -Method Get -Headers @{Authorization="Bearer $bearer"} -TimeoutSec 30; return [int]$r.StatusCode }
 catch{if($_.Exception.Response){return [int]$_.Exception.Response.StatusCode};throw 'API unreachable or request failed.'}
}
try{
 $base=$ApiBase.TrimEnd('/')
 $endpoints=@('finance-guardrails/period-locks','finance-audit/posting-integrity')
 $results=@()
 foreach($ep in $endpoints){
  $url="$base/$ep"+'?locationId='
  $assigned=Status ($url+$AssignedLocationId.ToString()) $token
  $other=Status ($url+$OtherLocationId.ToString()) $token
  $invalid=Status ($url+$AssignedLocationId.ToString()) 'invalid.jwt.value'
  $results += [pscustomobject]@{Endpoint=$ep;Assigned=$assigned;Other=$other;InvalidJwt=$invalid;Pass=($assigned -eq 200 -and $other -eq 403 -and $invalid -eq 401)}
 }
 $results | Format-Table -AutoSize
 if(@($results | Where-Object {-not $_.Pass}).Count -gt 0){throw 'At least one branch regression did not meet expected status codes. Investigate before enforcing new rules.'}
 Write-Host 'PASS: tested HTTP status checks. Inspect returned record scoping separately.'
}finally{$token=$null;$secret.Dispose()}
