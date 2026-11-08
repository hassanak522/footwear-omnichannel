param([string]$Root = 'G:\footwear-omnichannel')
$ErrorActionPreference = 'Stop'
$path = Join-Path $Root 'apps\api\src\transfers.ts'
if (-not (Test-Path -LiteralPath $path)) { throw "Source not found: $path" }
$source = [System.IO.File]::ReadAllText($path)
$old = 'isolationLevel:Prisma.TransactionIsolationLevel.Serializable}'
$new = 'isolationLevel:Prisma.TransactionIsolationLevel.Serializable, maxWait:10000, timeout:30000}'
$count = ([regex]::Matches($source, [regex]::Escape($old))).Count
if ($count -eq 0) {
  if ($source.Contains($new)) { Write-Host 'Already patched. No changes made.'; exit 0 }
  throw 'Expected transaction configuration not found. No changes made. Inspect transfers.ts manually.'
}
if ($count -ne 5) { throw "Expected 5 transaction configurations, found $count. No changes made." }
$backupDir = Join-Path $Root ('security-checks\M113_TIMEOUT_BACKUP_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Copy-Item -LiteralPath $path -Destination (Join-Path $backupDir 'transfers.ts')
$updated = $source.Replace($old,$new)
[System.IO.File]::WriteAllText($path, $updated, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "PASS: Updated $count Prisma transfer transactions to maxWait=10000ms, timeout=30000ms"
Write-Host "Backup: $backupDir"
Write-Host 'No database operations performed. Rebuild API and restart isolated API 3002 only.'
