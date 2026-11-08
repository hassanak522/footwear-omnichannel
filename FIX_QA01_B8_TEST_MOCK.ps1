param([string]$Root = 'G:\footwear-omnichannel')
$ErrorActionPreference = 'Stop'
$target = Join-Path $Root 'apps\api\src\pos-close.m112-b8.spec.ts'
if (-not (Test-Path -LiteralPath $target)) { throw "Missing test file: $target" }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText($target)
$old1 = 'findUniqueOrThrow: jest.fn().mockResolvedValue(shift),'
$new1 = 'findUnique: jest.fn().mockResolvedValue(shift),'
$old2 = 'const current = await tx.posShift.findUniqueOrThrow.mock.results[0].value;'
$new2 = 'const current = await tx.posShift.findUnique.mock.results[0].value;'
if ($content.Contains($new1) -and $content.Contains($new2)) { Write-Host 'Already patched. No changes made.' -ForegroundColor Yellow }
else {
  if (-not $content.Contains($old1) -or -not $content.Contains($old2)) { throw 'Unexpected test file contents. Safety stop: no changes made.' }
  $backup = "$target.QA01.bak"
  if (Test-Path $backup) { throw "Backup already exists: $backup. Safety stop." }
  Copy-Item -LiteralPath $target -Destination $backup
  $updated = $content.Replace($old1,$new1).Replace($old2,$new2)
  [System.IO.File]::WriteAllText($target,$updated,$utf8)
  Write-Host "Patched test mock only. Backup: $backup" -ForegroundColor Green
}
Push-Location (Join-Path $Root 'apps\api')
try {
  & npm.cmd exec -- jest --config jest.m112-b8.config.cjs --runInBand --no-coverage
  if ($LASTEXITCODE -ne 0) { throw "B8 tests failed with exit code $LASTEXITCODE. Review output." }
  Write-Host 'PASS: B8 closing tests' -ForegroundColor Green
} finally { Pop-Location }
