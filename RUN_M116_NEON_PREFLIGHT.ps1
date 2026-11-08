$ErrorActionPreference = "Stop"

$root = "G:\footwear-omnichannel"
$schema = Join-Path $root "packages\database\prisma\schema.prisma"
$prisma = Join-Path $root "node_modules\prisma\build\index.js"

if (-not (Test-Path $schema)) {
    throw "Prisma schema not found."
}

if (-not (Test-Path $prisma)) {
    throw "Prisma CLI not found."
}

Write-Host "`n=== M116 NEON STAGING PREFLIGHT ===" -ForegroundColor Cyan

# Read connection string without displaying it.
$secureUrl = Read-Host `
    "Paste your Neon DIRECT connection URL" `
    -AsSecureString

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)

try {
    $databaseUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

try {
    $uri = [Uri]$databaseUrl

    if ($uri.Scheme -notin @("postgresql", "postgres")) {
        throw "Expected a PostgreSQL URL."
    }

    if ($uri.Host -notmatch '(^|\.)neon\.tech$') {
        throw "SAFETY STOP: Target is not a Neon host."
    }

    if ($uri.Host -match '-pooler\.') {
        throw "SAFETY STOP: Use the direct Neon URL for migrations."
    }

    $dbName = [Uri]::UnescapeDataString(
        $uri.AbsolutePath.TrimStart('/')
    )

    if ($dbName -ne "footwear_staging") {
        throw "SAFETY STOP: Expected database footwear_staging."
    }

    if ($uri.Query -notmatch '(^\?|&)sslmode=require(&|$)') {
        throw "SAFETY STOP: Add sslmode=require to the connection URL."
    }

    Write-Host "Neon host verified."
    Write-Host "Database: $dbName"
    Write-Host "Direct connection: verified"

    # Override any DATABASE_URL loaded from local .env files.
    $env:DATABASE_URL = $databaseUrl

    Write-Host "`n[1] Prisma schema validation" -ForegroundColor Yellow

    Push-Location $root

    try {
        & node.exe $prisma validate --schema $schema

        if ($LASTEXITCODE -ne 0) {
            throw "Prisma schema validation failed."
        }

        Write-Host "`n[2] Migration status (read-only)" -ForegroundColor Yellow

        & node.exe $prisma migrate status --schema $schema

        $statusCode = $LASTEXITCODE

        Write-Host "`nMigration status exit code: $statusCode"

        if ($statusCode -ne 0) {
            Write-Host "Migration status requires review. No migrations were applied." `
                -ForegroundColor Yellow
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    $databaseUrl = $null
    $secureUrl = $null
}

Write-Host "`n=== PREFLIGHT FINISHED ===" -ForegroundColor Green
Write-Host "No migrations or database writes were performed."