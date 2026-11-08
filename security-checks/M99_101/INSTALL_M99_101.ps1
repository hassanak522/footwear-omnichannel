param([string]$Root='G:\footwear-omnichannel')
$ErrorActionPreference='Stop'
$src=Join-Path $Root 'apps\api\src'
if (-not (Test-Path $src)) { throw "NestJS source not found: $src" }
$dest=Join-Path $Root 'security-checks\M99_101'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem $PSScriptRoot -Filter '*.ps1' | Copy-Item -Destination $dest -Force
Copy-Item (Join-Path $PSScriptRoot 'README_M99_101.md') $dest -Force
Write-Host "Installed read-only verification scripts at $dest"
Write-Host 'No application, database, or environment files changed.'
