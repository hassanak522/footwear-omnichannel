$ErrorActionPreference = "Stop"

$root = "G:\footwear-omnichannel"
Set-Location $root

$file = Join-Path $root "apps\api\jest.m112-b8.config.cjs"

if (-not (Test-Path -LiteralPath $file)) {
    throw "SAFETY STOP: Jest configuration not found."
}

node --check $file 2>$null

if ($LASTEXITCODE -eq 0) {
    Write-Host "PASS: Jest configuration syntax is already valid."
}
else {
    Write-Host "Invalid Jest configuration detected."

    $backup = "$file.backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Copy-Item -LiteralPath $file -Destination $backup

    $content = @'
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/pos-close.m112-b8.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        diagnostics: false
      }
    ]
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30000
};
'@

    try {
        [System.IO.File]::WriteAllText(
            $file,
            $content,
            (New-Object System.Text.UTF8Encoding($false))
        )

        node --check $file

        if ($LASTEXITCODE -ne 0) {
            throw "Configuration syntax validation failed."
        }

        Write-Host "PASS: Jest configuration repaired." -ForegroundColor Green
        Write-Host "Backup: $backup"
    }
    catch {
        Copy-Item -LiteralPath $backup -Destination $file -Force
        throw "Repair failed. Original configuration restored. $($_.Exception.Message)"
    }
}