$ErrorActionPreference = 'Stop'

$root = 'G:\footwear-omnichannel'
Set-Location $root

$sha = (git rev-parse HEAD).Trim()

if ($LASTEXITCODE -ne 0) {
    throw 'Cannot determine source commit.'
}

$work = Join-Path $env:TEMP (
    'royal-step-r7c01-' +
    [guid]::NewGuid().ToString('N')
)

$context = Join-Path $work 'context'
$archive = Join-Path $work 'source.zip'

New-Item -ItemType Directory -Path $context -Force |
    Out-Null

try {

    Write-Host "`n=== EXPORT COMMITTED SOURCE ===" -ForegroundColor Cyan
    Write-Host "Source revision: $sha"

    & git archive `
        --format=zip `
        "--output=$archive" `
        HEAD -- `
        package.json `
        package-lock.json `
        apps/api `
        packages/database `
        deployment/M116/backend/Dockerfile `
        deployment/M116/backend/.dockerignore

    if ($LASTEXITCODE -ne 0) {
        throw 'Git archive failed.'
    }

    Expand-Archive `
        -LiteralPath $archive `
        -DestinationPath $context `
        -Force

    $deployment = Join-Path $context 'deployment\M116\backend'

    $dockerfile = Join-Path $deployment 'Dockerfile'
    $dockerignore = Join-Path $deployment '.dockerignore'

    if (-not (Test-Path $dockerfile)) {
        throw 'Dockerfile missing from committed source.'
    }

    if (-not (Test-Path $dockerignore)) {
        throw 'Docker ignore missing from committed source.'
    }

    # Docker reads .dockerignore from the build-context root.
    Copy-Item `
        -LiteralPath $dockerignore `
        -Destination (Join-Path $context '.dockerignore')

    # Verify that the newest committed migration is included.
    $migration = Join-Path $context (
        'packages\database\prisma\migrations\' +
        '20261116154411_r5c13_stock_availability_snapshots\' +
        'migration.sql'
    )

    if (-not (Test-Path $migration)) {
        throw 'STOP: Latest expected migration missing.'
    }

    # Reject secrets or private local databases.
    $unsafe = @(
        Get-ChildItem -LiteralPath $context -Recurse -Force -File |
        Where-Object {
            $_.Name -match '(?i)^\.env($|\.)' -and $_.Name -ne '.env.example' -or
            $_.Name -match '(?i)\.(pem|key|p12|pfx|sqlite|db)$' -or
            $_.Name -match '(?i)(^|[-_.])(credentials|secrets)([-_.]|$)'
        }
    )

    if ($unsafe.Count -gt 0) {
        $unsafe | ForEach-Object {
            Write-Host "BLOCKED: $($_.FullName)" -ForegroundColor Red
        }

        throw 'Sensitive files detected in committed source.'
    }

    Write-Host "`n=== BUILD DOCKER IMAGE ===" -ForegroundColor Cyan

    & docker build `
        --progress=plain `
        --file $dockerfile `
        --tag footwear-api:r7c01 `
        --label "org.opencontainers.image.revision=$sha" `
        $context

    if ($LASTEXITCODE -ne 0) {
        throw 'Docker build failed.'
    }

    Write-Host "`n=== VERIFY IMAGE REVISION ===" -ForegroundColor Cyan

    $builtSha = (
        docker image inspect `
            footwear-api:r7c01 `
            --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
    ).Trim()

    if ($LASTEXITCODE -ne 0 -or $builtSha -ne $sha) {
        throw 'Docker image revision mismatch.'
    }

    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host ' R7-C01B LOCAL BUILD PASSED' -ForegroundColor Green
    Write-Host " Image: footwear-api:r7c01"
    Write-Host " Revision: $builtSha"
    Write-Host ' Active committed source: YES'
    Write-Host ' Uncommitted changes included: NO'
    Write-Host ' Historical backups included: NO'
    Write-Host ' Cloud deployment: NOT PERFORMED'
    Write-Host ' Database migration: NOT PERFORMED'
    Write-Host '========================================' -ForegroundColor Green

}
finally {
    if (Test-Path $work) {
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}