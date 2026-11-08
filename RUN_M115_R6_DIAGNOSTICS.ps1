$ErrorActionPreference = "Stop"

$root = "G:\footwear-omnichannel"
$api = Join-Path $root "apps\api"
$reportDir = Join-Path $root "security-checks\M115\reports"

Set-Location $root

New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

$tscCli = Join-Path $root "node_modules\typescript\bin\tsc"
$jestCli = Join-Path $root "node_modules\jest\bin\jest.js"

if (-not (Test-Path $tscCli)) {
    throw "TypeScript CLI not found: $tscCli"
}

if (-not (Test-Path $jestCli)) {
    throw "Jest CLI not found: $jestCli"
}

Write-Host "`n=== M115-R6 DIAGNOSTICS ===" -ForegroundColor Cyan

# Run native process and capture stdout/stderr without
# Windows PowerShell treating informational stderr as fatal.
function Invoke-Diagnostic {
    param(
        [string]$Name,
        [string[]]$Arguments,
        [string]$Report
    )

    Write-Host "`n=== $Name ===" -ForegroundColor Yellow

    $stdout = "$Report.stdout.tmp"
    $stderr = "$Report.stderr.tmp"

    try {
        $process = Start-Process `
            -FilePath "node.exe" `
            -ArgumentList $Arguments `
            -WorkingDirectory $api `
            -Wait `
            -PassThru `
            -NoNewWindow `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr

        $lines = @()

        if (Test-Path $stdout) {
            $lines += @(Get-Content $stdout)
        }

        if (Test-Path $stderr) {
            $lines += @(Get-Content $stderr)
        }

        $lines | Set-Content -Path $Report -Encoding UTF8

        if ($lines.Count -gt 0) {
            $lines | Select-Object -First 80 | ForEach-Object {
                Write-Host $_
            }
        }

        Write-Host "Exit code: $($process.ExitCode)"

        return $process.ExitCode
    }
    finally {
        Remove-Item $stdout, $stderr -Force -ErrorAction SilentlyContinue
    }
}

# 1. TypeScript check
$tsReport = Join-Path $reportDir "M115_R6_TYPESCRIPT.txt"

$tsExit = Invoke-Diagnostic `
    -Name "TypeScript compilation check" `
    -Arguments @(
        $tscCli,
        "--project",
        (Join-Path $api "tsconfig.json"),
        "--noEmit",
        "--pretty",
        "false"
    ) `
    -Report $tsReport

# 2. Jest discovery
$jestReport = Join-Path $reportDir "M115_R6_JEST_DISCOVERY.txt"

$jestExit = Invoke-Diagnostic `
    -Name "M112-B8 Jest test discovery" `
    -Arguments @(
        $jestCli,
        "--config",
        (Join-Path $api "jest.m112-b8.config.cjs"),
        "--listTests",
        "--runInBand"
    ) `
    -Report $jestReport

# 3. Summary
Write-Host "`n=== FINAL SUMMARY ===" -ForegroundColor Cyan

if ($tsExit -eq 0) {
    Write-Host "TypeScript: PASS" -ForegroundColor Green
}
else {
    Write-Host "TypeScript: FAIL (exit $tsExit)" -ForegroundColor Red
}

if ($jestExit -eq 0) {
    Write-Host "Jest discovery: PASS" -ForegroundColor Green
}
else {
    Write-Host "Jest discovery: FAIL (exit $jestExit)" -ForegroundColor Red
}

Write-Host "`nReports: $reportDir"
Write-Host "No application source files or databases were modified."