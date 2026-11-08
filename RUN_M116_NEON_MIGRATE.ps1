$ErrorActionPreference = "Stop"

$root = "G:\footwear-omnichannel"
$schema = Join-Path $root "packages\database\prisma\schema.prisma"
$prisma = Join-Path $root "node_modules\prisma\build\index.js"

if (-not (Test-Path $schema)) {
    throw "SAFETY STOP: Prisma schema missing."
}

if (-not (Test-Path $prisma)) {
    throw "SAFETY STOP: Prisma CLI missing."
}

Write-Host "`n=== M116 NEON MIGRATION ===" -ForegroundColor Cyan

$previousUrl = [Environment]::GetEnvironmentVariable(
    "DATABASE_URL", "Process"
)

$secureUrl = Read-Host "Paste Neon DIRECT connection URL" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)

try {
    $databaseUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

try {
    $uri = [Uri]$databaseUrl
    $dbName = [Uri]::UnescapeDataString(
        $uri.AbsolutePath.TrimStart("/")
    )

    if ($uri.Scheme -notin @("postgres", "postgresql")) {
        throw "SAFETY STOP: Invalid PostgreSQL scheme."
    }

    if ($uri.Host -notmatch '(^|\.)neon\.tech$') {
        throw "SAFETY STOP: Not a Neon host."
    }

    if ($uri.Host -match '-pooler\.') {
        throw "SAFETY STOP: Use a direct Neon connection."
    }

    if ($dbName -ne "footwear_staging") {
        throw "SAFETY STOP: Wrong database name."
    }

    if ($uri.Query -notmatch '(^\?|&)sslmode=require(&|$)') {
        throw "SAFETY STOP: sslmode=require is missing."
    }

    $env:DATABASE_URL = $databaseUrl

    Push-Location $root

    try {
        Write-Host "`n[1] Validating schema..." -ForegroundColor Yellow

        & node.exe $prisma validate --schema $schema

        if ($LASTEXITCODE -ne 0) {
            throw "Schema validation failed."
        }

        Write-Host "`n[2] Checking migrations..." -ForegroundColor Yellow

        & node.exe $prisma migrate status --schema $schema

        Write-Host "`nTarget database: $dbName"
        Write-Host "Target host: $($uri.Host)"

        Write-Host "`nWARNING: This operation will modify the Neon staging database." `
            -ForegroundColor Yellow

        $confirmation = Read-Host "Type DEPLOY-FOOTWEAR-STAGING to continue"

        if ($confirmation -cne "DEPLOY-FOOTWEAR-STAGING") {
            throw "Migration cancelled."
        }

        Write-Host "`n[3] Deploying migrations..." -ForegroundColor Cyan

        & node.exe $prisma migrate deploy --schema $schema

        if ($LASTEXITCODE -ne 0) {
            throw "Migration deployment failed. Do not retry until reviewed."
        }

        Write-Host "`n[4] Final migration verification..." -ForegroundColor Cyan

        & node.exe $prisma migrate status --schema $schema

        if ($LASTEXITCODE -ne 0) {
            throw "Final migration verification failed."
        }

        Write-Host "`nM116 NEON MIGRATION: PASS" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}
finally {
    [Environment]::SetEnvironmentVariable(
        "DATABASE_URL", $previousUrl, "Process"
    )

    $databaseUrl = $null
    $secureUrl = $null
}