$ErrorActionPreference = "Stop"

$root = "G:\footwear-omnichannel"
$out = Join-Path $root "deployment\M116\backend"

Set-Location $root

Write-Host "`n=== M116 DOCKER PACKAGE PREPARATION ===" -ForegroundColor Cyan

# Check workspace dependencies before packaging.
$rootPackage = Get-Content ".\package.json" -Raw | ConvertFrom-Json
$apiPackage = Get-Content ".\apps\api\package.json" -Raw | ConvertFrom-Json
$dbPackage = Get-Content ".\packages\database\package.json" -Raw | ConvertFrom-Json

Write-Host "`n[1] Checking required packages..."

foreach ($path in @(
    "package-lock.json",
    "apps\api\package.json",
    "apps\api\tsconfig.json",
    "packages\database\package.json",
    "packages\database\prisma\schema.prisma"
)) {
    if (-not (Test-Path $path)) {
        throw "Required file missing: $path"
    }
}

$workspaceNames = @(
    "@footwear/api",
    "@footwear/database"
)

foreach ($pkg in @($apiPackage, $dbPackage)) {
    foreach ($section in @("dependencies", "devDependencies")) {
        $deps = $pkg.$section

        if ($null -eq $deps) {
            continue
        }

        foreach ($dep in $deps.PSObject.Properties) {
            if (
                $dep.Name -like "@footwear/*" -and
                $dep.Name -notin $workspaceNames
            ) {
                throw "Additional workspace dependency found: $($dep.Name). Review packaging before proceeding."
            }
        }
    }
}

Write-Host "Package dependency check passed."

Write-Host "`n[2] Preparing isolated build context..."

if (Test-Path $out) {
    throw "Deployment context already exists: $out. Review it before recreating."
}

New-Item -ItemType Directory -Path $out -Force | Out-Null

foreach ($file in @("package.json", "package-lock.json")) {
    Copy-Item $file $out
}

foreach ($folder in @(
    "apps\api",
    "packages\database"
)) {
    $destination = Join-Path $out $folder

    New-Item -ItemType Directory -Path $destination -Force |
        Out-Null

    robocopy `
        (Join-Path $root $folder) `
        $destination `
        /E `
        /XD node_modules dist coverage .next reports `
        /XF .env .env.* *.log *.bak *.backup *.zip *.rar *.pem *.key

    if ($LASTEXITCODE -ge 8) {
        throw "Copy failed: $folder"
    }
}

Write-Host "`n[3] Writing Docker ignore rules..."

@'
**/.env
**/.env.*
**/node_modules
**/dist
**/coverage
**/.next
**/*.log
**/*.bak
**/*.backup
**/*.pem
**/*.key
**/*.zip
**/*.rar
**/security-checks
**/reports
**/.git
'@ | Set-Content (Join-Path $out ".dockerignore")

Write-Host "`nDeployment context created:"
Write-Host $out

Write-Host "`nNo Docker build or cloud upload was performed." `
    -ForegroundColor Green