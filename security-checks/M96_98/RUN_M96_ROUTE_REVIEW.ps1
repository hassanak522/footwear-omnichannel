param([string]$Root='G:\footwear-omnichannel')
$ErrorActionPreference='Stop'
$src=Join-Path $Root 'apps\api\src'
if(!(Test-Path -LiteralPath (Join-Path $src 'auth.ts'))){throw "API source missing: $src"}
$out=Join-Path $Root 'security-checks\M96_98\reports'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$rows=@()
foreach($f in (Get-ChildItem -LiteralPath $src -Filter '*.ts' -File)){
 $code=Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
 if($code -notmatch '@Controller\('){continue}
 $classGuards=($code -match '@UseGuards\(JwtAuthGuard\s*,\s*RolesGuard\)')
 $roles=($code -match '@Roles\(')
 $assert=($code -match 'assertLocation\(')
 $service=($code -match 'this\.[A-Za-z]+Service\.|this\.db\.')
 $writes=([regex]::Matches($code,'@(Post|Put|Patch|Delete)\(')).Count
 $reads=([regex]::Matches($code,'@Get\(')).Count
 $rows += [pscustomobject]@{File=$f.Name;GetRoutes=$reads;WriteRoutes=$writes;HasJwtAndRolesGuardPattern=$classGuards;HasRolesPattern=$roles;HasAssertLocationPattern=$assert;HasServiceOrDbReference=$service;ReviewPriority=if($writes -gt 0 -and !$assert){'HIGH - manual write-scope review'}elseif(!$classGuards -and $f.Name -ne 'auth.ts'){'REVIEW - guard may be elsewhere'}else{'MANUAL REVIEW'}}
}
$path=Join-Path $out 'M96_controller_review.csv'
$rows | Sort-Object File | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $path
$rows | Sort-Object ReviewPriority,File | Format-Table File,GetRoutes,WriteRoutes,HasJwtAndRolesGuardPattern,HasAssertLocationPattern,ReviewPriority -AutoSize
Write-Host "Saved $path"
Write-Warning 'Heuristic source inventory only. No vulnerability, endpoint safety, or authorization guarantee is implied.'
