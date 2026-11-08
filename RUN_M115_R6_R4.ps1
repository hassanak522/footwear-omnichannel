$ErrorActionPreference = "Stop"

$root = "G:\footwear-omnichannel"
$api = Join-Path $root "apps\api"
$reports = Join-Path $root "security-checks\M115\reports"

New-Item -ItemType Directory -Force -Path $reports | Out-Null

$jest = Join-Path $root "node_modules\jest\bin\jest.js"

if (-not (Test-Path $jest)) {
    throw "SAFETY STOP: Jest CLI not found."
}

function Invoke-Check {
    param(
        [string]$Name,
        [string]$Executable,
        [string[]]$Arguments,
        [string]$Report
    )

    Write-Host "`n=== $Name ===" -ForegroundColor Cyan

    $stdout = "$Report.stdout.tmp"
    $stderr = "$Report.stderr.tmp"

    try {
        $p = Start-Process `
            -FilePath $Executable `
            -ArgumentList $Arguments `
            -WorkingDirectory $api `
            -Wait `
            -PassThru `
            -NoNewWindow `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr

        $output = @()

        if (Test-Path $stdout) {
            $output += @(Get-Content $stdout)
        }

        if (Test-Path $stderr) {
            $output += @(Get-Content $stderr)
        }

        $output | Set-Content -Path $Report -Encoding UTF8

        $output | Select-Object -Last 60 | ForEach-Object {
            Write-Host $_
        }

        Write-Host "Exit code: $($p.ExitCode)"

        return $p.ExitCode
    }
    finally {
        Remove-Item $stdout, $stderr `
            -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "`n=== M115-R15-R6-R4 ===" -ForegroundColor Yellow

# 1. Execute focused POS closing unit tests
$jestExit = Invoke-Check `
    -Name "M112-B8 POS closing unit tests" `
    -Executable "node.exe" `
    -Arguments @(
        $jest,
        "--config",
        (Join-Path $api "jest.m112-b8.config.cjs"),
        "--runInBand",
        "--no-coverage"
    ) `
    -Report (Join-Path $reports "M115_R6_R4_JEST.txt")

# 2. Run API production build
# The build may update generated dist/ files.
$buildExit = Invoke-Check `
    -Name "API production build" `
    -Executable "npm.cmd" `
    -Arguments @(
        "run",
        "build",
        "-w",
        "@footwear/api"
    ) `
    -Report (Join-Path $reports "M115_R6_R4_BUILD.txt")

Write-Host "`n=== M115-R6-R4 SUMMARY ===" -ForegroundColor Cyan

if ($jestExit -eq 0) {
    Write-Host "M112-B8 Jest tests: PASS" -ForegroundColor Green
}
else {
    Write-Host "M112-B8 Jest tests: FAIL" -ForegroundColor Red
}

if ($buildExit -eq 0) {
    Write-Host "API production build: PASS" -ForegroundColor Green
}
else {
    Write-Host "API production build: FAIL" -ForegroundColor Red
}

Write-Host "`nReports saved to: $reports"

if ($jestExit -ne 0 -or $buildExit -ne 0) {
    exit 1
}