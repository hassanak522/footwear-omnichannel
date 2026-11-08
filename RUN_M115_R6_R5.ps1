$ErrorActionPreference = "Stop"

$root = "G:\footwear-omnichannel"
$api = Join-Path $root "apps\api"
$reports = Join-Path $root "security-checks\M115\reports"

New-Item -ItemType Directory -Force -Path $reports | Out-Null

$jest = Join-Path $root "node_modules\jest\bin\jest.js"
$config = Join-Path $api "jest.config.cjs"

if (-not (Test-Path $jest)) {
    throw "SAFETY STOP: Jest CLI not found."
}

if (-not (Test-Path $config)) {
    throw "SAFETY STOP: Main Jest configuration not found."
}

Write-Host "`n=== M115-R15-R6-R5 ===" -ForegroundColor Cyan

Write-Host "`n[1] Discovering API tests..." -ForegroundColor Yellow

Push-Location $api

try {
    $tests = @(
        & node.exe $jest `
            --config $config `
            --listTests `
            --runInBand
    )

    if ($LASTEXITCODE -ne 0) {
        throw "Jest test discovery failed."
    }

    $tests | Set-Content `
        (Join-Path $reports "M115_R6_R5_TEST_INVENTORY.txt")

    Write-Host "Discovered test files: $($tests.Count)"

    if ($tests.Count -eq 0) {
        throw "SAFETY STOP: No tests discovered."
    }

    Write-Host "`n[2] Executing API unit regression tests..." -ForegroundColor Yellow

    $stdout = Join-Path $reports "M115_R6_R5.stdout.tmp"
    $stderr = Join-Path $reports "M115_R6_R5.stderr.tmp"
    $report = Join-Path $reports "M115_R6_R5_RESULTS.txt"

    try {
        $process = Start-Process `
            -FilePath "node.exe" `
            -ArgumentList @(
                $jest,
                "--config",
                $config,
                "--runInBand",
                "--no-coverage"
            ) `
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

        $output | Set-Content $report -Encoding UTF8

        $output | Select-Object -Last 80 |
            ForEach-Object { Write-Host $_ }

        Write-Host "`nJest exit code: $($process.ExitCode)"

        if ($process.ExitCode -eq 0) {
            Write-Host "M115-R6-R5: PASS" -ForegroundColor Green
        }
        else {
            Write-Host "M115-R6-R5: FAIL" -ForegroundColor Red
        }
    }
    finally {
        Remove-Item $stdout, $stderr `
            -Force -ErrorAction SilentlyContinue
    }
}
finally {
    Pop-Location
}

Write-Host "`nReports saved to: $reports"