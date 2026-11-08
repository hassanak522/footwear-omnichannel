param([string]$Root='G:\footwear-omnichannel')
$ErrorActionPreference='Stop'
$runner=Join-Path $PSScriptRoot 'm114b-harness.cjs'
$source=Join-Path $Root 'apps\pos-desktop\electron\main.cjs'
$module=Join-Path $Root 'node_modules\sql.js'
if(!(Test-Path $source)){throw "Missing source: $source"}
if(!(Test-Path $module)){throw "Missing sql.js dependency: $module"}
$report=Join-Path $Root ('security-checks\M114B_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Force -Path $report | Out-Null
Write-Host 'M114-B LOCAL PERSISTENCE QA - isolated userData, no API or PostgreSQL writes'
Write-Host "Report: $report"
& node $runner $source $module $report
$exit=$LASTEXITCODE
if($exit -ne 0){throw "M114-B failed (exit $exit). Review $report"}
Write-Host 'M114-B completed; see summary.json in report directory.'
