$ErrorActionPreference = 'Stop'
$root = 'G:\footwear-omnichannel'
$ctx = Join-Path $root 'deployment\M116\backend'
if (-not (Test-Path (Join-Path $ctx 'package-lock.json'))) { throw 'Deployment context missing. Run preparation first.' }
if (-not (Test-Path (Join-Path $ctx 'apps\api\src\main.ts'))) { throw 'API source missing.' }
Write-Host '=== M116 LOCAL DOCKER BUILD ===' -ForegroundColor Cyan
# Delete backups ONLY in the isolated deployment context.
$backupFiles = @(Get-ChildItem -LiteralPath $ctx -Recurse -File | Where-Object { $_.Name -match '(?i)(\.backup($|_)|\.bak$|[-.]backup[-.]|\.qa\d+[-.]backup|\.b\d+-backup)' })
foreach ($f in $backupFiles) { Remove-Item -LiteralPath $f.FullName -Force }
Write-Host "Removed $($backupFiles.Count) backup file(s) from isolated deployment context."
# Stop if unexpected files are present; never send secrets or test artifacts to Docker.
$unsafe = @(Get-ChildItem -LiteralPath $ctx -Recurse -Force -File | Where-Object {
    $_.Name -match '(?i)^\.env($|\.)|\.(pem|key|p12|pfx|sqlite|db|zip|rar)$|(^|[-_.])(credentials|secrets)([-_.]|$)' -or
    $_.FullName -match '(?i)\\(security-checks|reports|node_modules|\.git)\\'
})
if ($unsafe.Count) {
    $unsafe | ForEach-Object { Write-Host "BLOCKED FILE: $($_.FullName)" -ForegroundColor Red }
    throw 'Unsafe files found in deployment context. No Docker build started.'
}
$dockerfile = @'
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm ci --workspace @footwear/api --workspace @footwear/database --include-workspace-root --no-audit --no-fund
COPY apps/api apps/api
COPY packages/database packages/database
RUN ./node_modules/.bin/prisma generate --schema=packages/database/prisma/schema.prisma
RUN npm run build -w @footwear/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
'@
Set-Content -LiteralPath (Join-Path $ctx 'Dockerfile') -Value $dockerfile -Encoding utf8
$ignore = @'
**/.env
**/.env.*
**/node_modules
**/dist
**/coverage
**/.next
**/*.log
**/*.bak
**/*.backup*
**/*-backup*
**/*.pem
**/*.key
**/*.zip
**/*.rar
**/security-checks
**/reports
**/.git
**/*spec.ts
**/test
**/scripts
**/README.md
'@
Set-Content -LiteralPath (Join-Path $ctx '.dockerignore') -Value $ignore -Encoding utf8
Write-Host 'Building Linux Docker image locally; no cloud upload and no database changes.' -ForegroundColor Yellow
& docker build --progress=plain --tag footwear-api:m116-staging $ctx
if ($LASTEXITCODE -ne 0) { throw "Docker build failed (exit $LASTEXITCODE). Send the last 50 lines, without secrets." }
Write-Host 'LOCAL DOCKER BUILD PASSED. Image: footwear-api:m116-staging' -ForegroundColor Green
Write-Host 'Do not push the image yet; image content and hosting privacy still need review.'
