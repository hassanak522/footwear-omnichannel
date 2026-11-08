param([string]$Root = 'G:\footwear-omnichannel')
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Project folder not found: $Root" }
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$report = Join-Path $Root "security-checks\QA01_RECHECK_$stamp"
New-Item -ItemType Directory -Path $report -Force | Out-Null
$results = @()
function Run-Check {
    param([string]$Name, [string]$WorkingDir, [string[]]$Arguments)
    $stdout = Join-Path $report "$Name.stdout.txt"
    $stderr = Join-Path $report "$Name.stderr.txt"
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    try {
        $p = Start-Process -FilePath 'npm.cmd' -ArgumentList $Arguments -WorkingDirectory $WorkingDir -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $code = $p.ExitCode
        $status = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
    } catch {
        $code = -1
        $status = 'RUNNER_ERROR'
        $_ | Out-String | Set-Content -Path $stderr
    }
    $script:results += [pscustomobject]@{ Check=$Name; Status=$status; ExitCode=$code; Stdout=$stdout; Stderr=$stderr }
    Write-Host "$Name : $status (exit $code)"
    if ($status -ne 'PASS') {
        if (Test-Path $stderr) { Get-Content $stderr -Tail 12 }
        if (Test-Path $stdout) { Get-Content $stdout -Tail 12 }
    }
}
$api = Join-Path $Root 'apps\api'
Run-Check 'API_BUILD' $Root @('run','build','-w','@footwear/api')
Run-Check 'POS_BUILD' $Root @('run','build','-w','@footwear/pos-desktop')
Run-Check 'AUTH_M108_UNIT' $api @('exec','--','jest','--config','jest.m108.config.cjs','--runInBand','--no-coverage')
Run-Check 'B6_RETRY' $api @('exec','--','jest','--config','jest.m112-b6.config.cjs','--runInBand','--no-coverage')
Run-Check 'B8_CLOSING' $api @('exec','--','jest','--config','jest.m112-b8.config.cjs','--runInBand','--no-coverage')
$csv = Join-Path $report 'QA01_RECHECK_SUMMARY.csv'
$results | Export-Csv -NoTypeInformation -Path $csv
$results | Format-Table Check,Status,ExitCode -AutoSize
Write-Host "`nReports: $report" -ForegroundColor Yellow
Write-Host 'No HTTP write requests or database migrations were executed.'
