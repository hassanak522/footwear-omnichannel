param(
    [string]$Root = "G:\footwear-omnichannel"
)

$ErrorActionPreference = "Continue"

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$reportDir = Join-Path $Root "security-checks\RELEASE_GATE_$stamp"

New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
Set-Location $Root

$results = [System.Collections.Generic.List[object]]::new()

function Run-Check {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Host "`n=== $Name ===" -ForegroundColor Cyan

    $log = Join-Path $reportDir "$Name.txt"
    $timer = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        $global:LASTEXITCODE = 0

        $output = & $Command 2>&1
        $exitCode = $LASTEXITCODE

        $output | Out-File $log -Encoding UTF8

        if ($null -eq $exitCode) {
            $exitCode = 0
        }

        $status = if ($exitCode -eq 0) { "PASS" } else { "FAIL" }
    }
    catch {
        $_ | Out-File $log -Append
        $status = "FAIL"
        $exitCode = -1
    }

    $timer.Stop()

    $results.Add([pscustomobject]@{
        Check = $Name
        Status = $status
        ExitCode = $exitCode
        Seconds = [math]::Round($timer.Elapsed.TotalSeconds, 1)
        Log = $log
    })

    Write-Host "$Name : $status" -ForegroundColor $(
        if ($status -eq "PASS") { "Green" } else { "Red" }
    )
}

# 1. Toolchain
Run-Check "NODE_VERSION" {
    node --version
    npm --version
}

# 2. Prisma schema validation (no migration)
Run-Check "PRISMA_VALIDATE" {
    npm exec -w @footwear/database -- prisma validate
}

# 3. API production build
Run-Check "API_BUILD" {
    npm run build -w @footwear/api
}

# 4. Desktop POS production build
Run-Check "POS_DESKTOP_BUILD" {
    npm run build -w @footwear/pos-desktop
}

# 5. API test suite
Run-Check "API_TESTS" {
    npm run test -w @footwear/api -- --runInBand --passWithNoTests
}

# 6. B6 retry regression
Run-Check "B6_RETRY" {
    npm exec -w @footwear/api -- jest `
        --config jest.m112-b6.config.cjs `
        --runInBand
}

# 7. B8 closing regression (mocked)
Run-Check "B8_CLOSING" {
    npm exec -w @footwear/api -- jest `
        --config jest.m112-b8.config.cjs `
        --runInBand
}

# 8. B8 authorization regression
Run-Check "B8_AUTHORIZATION" {
    npm exec -w @footwear/api -- jest `
        --config jest.m112-b8.config.cjs `
        --testMatch "**/pos-auth.m112-b8.spec.ts" `
        --runInBand
}

# 9. Dependency audit (non-mutating)
Run-Check "DEPENDENCY_AUDIT" {
    npm audit --omit=dev --audit-level=high
}

# 10. Test API health
Run-Check "TEST_API_HEALTH" {
    $response = Invoke-WebRequest `
        -Uri "http://127.0.0.1:3002/api/v1/health" `
        -UseBasicParsing `
        -TimeoutSec 10

    Write-Output "HTTP $($response.StatusCode)"

    if ($response.StatusCode -ne 200) {
        throw "Unexpected API status"
    }
}

# 11. Test database health
Run-Check "TEST_DATABASE" {
    docker exec footwear-postgres `
        pg_isready -U footwear -d footwear_omnichannel_test
}

# 12. Check Git working tree
Run-Check "GIT_STATUS" {
    git status --short
}

# Generate report
$csv = Join-Path $reportDir "RELEASE_GATE_SUMMARY.csv"
$results | Export-Csv $csv -NoTypeInformation -Encoding UTF8

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "CONSOLIDATED RELEASE RESULTS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$results | Format-Table -AutoSize

Write-Host "`nReports: $reportDir" -ForegroundColor Yellow

$failed = @($results | Where-Object Status -eq "FAIL")

if ($failed.Count -gt 0) {
    Write-Host "RELEASE GATE: FAIL - $($failed.Count) checks failed" -ForegroundColor Red
    exit 1
}

Write-Host "RELEASE GATE: AUTOMATED CHECKS PASSED" -ForegroundColor Green
exit 0
