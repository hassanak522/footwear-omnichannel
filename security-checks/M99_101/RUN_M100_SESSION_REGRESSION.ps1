param([string]$WebBase='http://localhost:3000',[string]$ApiBase='http://127.0.0.1:3001')
$ErrorActionPreference='Stop'
function Get-Status([string]$Url) {
  try { $r=Invoke-WebRequest -Uri $Url -Method Get -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 25 -ErrorAction Stop; return [int]$r.StatusCode }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }; throw }
}
$tests=@(
  @{Name='API health';Url="$ApiBase/api/v1/health";Expected=@(200)},
  @{Name='Signed-out finance workflow';Url="$WebBase/api/v1/finance-command-center/workflow?locationId=00000000-0000-0000-0000-000000000000";Expected=@(401)},
  @{Name='Signed-out finance cases';Url="$WebBase/api/v1/finance-casework/cases?locationId=00000000-0000-0000-0000-000000000000";Expected=@(401)}
)
$fail=0
foreach($t in $tests) {
  try { $code=Get-Status $t.Url; $ok=$t.Expected -contains $code; Write-Host "$($t.Name): HTTP $code : $(if($ok){'PASS'}else{'FAIL'})"; if(-not $ok){$fail++} }
  catch { Write-Warning "$($t.Name): ERROR $($_.Exception.Message)"; $fail++ }
}
Write-Host 'Run this in a fresh PowerShell session; no browser cookies are sent by the script.'
if($fail -gt 0){ throw "$fail regression check(s) failed" }
Write-Host 'Signed-out regression checks passed.'
