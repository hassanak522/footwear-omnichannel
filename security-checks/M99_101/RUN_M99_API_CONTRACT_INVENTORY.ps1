param([string]$Root='G:\footwear-omnichannel')
$ErrorActionPreference='Stop'
$src=Join-Path $Root 'apps\api\src'
if (-not (Test-Path $src)) { throw "Missing source: $src" }
$report=Join-Path $Root 'security-checks\M99_101\reports'
New-Item -ItemType Directory -Force -Path $report | Out-Null
$rows=@(Get-ChildItem $src -Recurse -Filter '*.ts' -File | ForEach-Object {
  $content=Get-Content $_.FullName -Raw
  if ($content -notmatch '@Controller\s*\(') { return }
  $controllerMatches=[regex]::Matches($content,'@Controller\s*\(\s*[\x27\x22]([^\x27\x22]*)')
  $routes=[regex]::Matches($content,'@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:[\x27\x22]([^\x27\x22]*)[\x27\x22])?')
  foreach($r in $routes) {
    [pscustomobject]@{File=$_.Name;ControllerPrefixes=(($controllerMatches | ForEach-Object {$_.Groups[1].Value}) -join ';');Method=$r.Groups[1].Value.ToUpperInvariant();Route=$r.Groups[2].Value;RequiresManualGuardReview=$true}
  }
})
$path=Join-Path $report 'M99_api_route_inventory.csv'
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 $path
Write-Host "Inventoried $($rows.Count) route decorators. Report: $path"
Write-Warning 'Static inventory: does not resolve dynamic paths, inherited decorators, or effective permissions.'
