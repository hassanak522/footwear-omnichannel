param(
    [string]$Root = "G:\footwear-omnichannel"
)

$ErrorActionPreference = "Stop"

$targetDb = "footwear_m115_api_b16z_20261107"
$targetPort = 3102
$tag = "m115_b16z_isolated_api"

Set-Location $Root

Write-Host "=== M115-R15-R2B ISOLATED API ==="

# Verify port availability.
$listener = Get-NetTCPConnection `
    -LocalPort $targetPort `
    -State Listen `
    -ErrorAction SilentlyContinue

if ($listener) {
    throw "SAFETY STOP: Port 3102 is already occupied."
}

# Load the current DATABASE_URL from the process environment.
# This avoids printing the connection string.
$url = [Environment]::GetEnvironmentVariable(
    "DATABASE_URL",
    "Process"
)

if ([string]::IsNullOrWhiteSpace($url)) {
    throw "SAFETY STOP: DATABASE_URL not set in this PowerShell process."
}

# Parse and verify database identity.
$uri = [System.Uri]$url
$databaseName = $uri.AbsolutePath.TrimStart('/')

if ($databaseName -cne $targetDb) {
    throw "SAFETY STOP: DATABASE_URL does not target disposable database."
}

if ($uri.Host -notin @("127.0.0.1", "localhost")) {
    throw "SAFETY STOP: Unexpected PostgreSQL host."
}

if ($uri.Port -ne 5433) {
    throw "SAFETY STOP: Unexpected PostgreSQL port."
}

# Add an identifiable PostgreSQL application name.
$separator = if ($url.Contains("?")) { "&" } else { "?" }

$env:DATABASE_URL = $url +
    $separator +
    "application_name=$tag"

$env:PORT = "$targetPort"

Write-Host "Database target: VERIFIED"
Write-Host "Database host: VERIFIED"
Write-Host "Database port: VERIFIED"
Write-Host "API port: $targetPort"
Write-Host "Connection tag: $tag"

Write-Host "Starting isolated API..."

npm run dev -w @footwear/api
