$ErrorActionPreference = "Continue"

$root = "G:\footwear-omnichannel"
Set-Location $root

Write-Host "`n=== M116 BACKEND DEPLOYMENT PREFLIGHT ===" -ForegroundColor Cyan

Write-Host "`n[1] Node.js version"
node --version

Write-Host "`n[2] Docker availability"
if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker --version
    docker info --format '{{.OSType}}' 2>&1
} else {
    Write-Host "Docker CLI not installed."
}

Write-Host "`n[3] API entrypoint"
Get-Content ".\apps\api\src\main.ts"

Write-Host "`n[4] Prisma generator and datasource"
Select-String `
    -Path ".\packages\database\prisma\schema.prisma" `
    -Pattern 'generator client|datasource db|provider\s*=|output\s*=|binaryTargets\s*=' `
    -Context 0,5

Write-Host "`n[5] Root package scripts"
$p = Get-Content ".\package.json" -Raw | ConvertFrom-Json
$p.scripts | Format-List

Write-Host "`n[6] Deployment-related configuration filenames"

Get-ChildItem -Path ".\apps\api", ".\packages\database" `
    -Recurse -File `
    -Include "Dockerfile","docker-compose.yml","prisma.config.ts" `
    -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch '\\node_modules\\|\\dist\\'
    } |
    Select-Object -ExpandProperty FullName

Write-Host "`n[7] Auth environment variable names (no values)"

Get-ChildItem ".\apps\api\src" -Filter "*.ts" |
    Select-String -Pattern 'process\.env\.[A-Z][A-Z0-9_]*' -AllMatches |
    ForEach-Object { $_.Matches.Value } |
    Sort-Object -Unique

Write-Host "`n=== PREFLIGHT COMPLETE ===" -ForegroundColor Green
