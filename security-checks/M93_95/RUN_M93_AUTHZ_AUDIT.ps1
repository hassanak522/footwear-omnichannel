param([string]$Root='G:\footwear-omnichannel')
$ErrorActionPreference='Stop'
$src=Join-Path $Root 'apps\api\src'
if(!(Test-Path $src)){throw "Missing API source: $src"}
$rows=@()
Get-ChildItem -LiteralPath $src -Filter '*.ts' -File | ForEach-Object {
 $code=Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
 if($code -match '@Controller\('){
  $rows += [pscustomobject]@{
   File=$_.Name
   HasUseGuards=($code -match '@UseGuards\(')
   HasRoles=($code -match '@Roles\(')
   HasLocationAssertion=($code -match 'assertLocation\(')
   ControllerDeclarations=([regex]::Matches($code,'@Controller\(')).Count
   RouteDeclarations=([regex]::Matches($code,'@(Get|Post|Put|Patch|Delete)\(')).Count
   ReviewNote=if($code -notmatch '@UseGuards\('){'CHECK GUARDS'}elseif($code -notmatch 'assertLocation\('){'CHECK LOCATION SCOPING'}else{'Manual review still required'}
  }
 }
}
$rows | Sort-Object File | Format-Table -AutoSize
Write-Host "Controller files scanned: $($rows.Count)"
Write-Warning 'Static heuristics only: inherited guards, service-level location filtering and public endpoints may be valid. No security conclusion can be drawn from counts alone.'
