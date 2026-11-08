param([string]$Root="G:\footwear-omnichannel")
$ErrorActionPreference="Stop"
$schema=Join-Path $Root "packages\database\prisma\schema.prisma"
$module=Join-Path $Root "apps\api\src\module.ts"
$api=Join-Path $Root "apps\api\src\retail-finance.ts"
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
if(!(Test-Path $schema) -or !(Test-Path $module)){throw "Royal Step project not found at $Root"}
$schemaText=Get-Content $schema -Raw
$moduleText=Get-Content $module -Raw
if($schemaText -notmatch 'model FinanceJournal\s*\{'){throw "Milestone 40 schema missing; install earlier milestones first"}
if($schemaText -match 'model InventoryCostBasis\s*\{' -or $schemaText -match 'model SupplierInvoice\s*\{'){throw "One or more M42-44 models already exist. Review and merge manually."}
if($moduleText -notmatch 'export class AppModule'){throw "Unexpected module.ts layout"}
if($moduleText -match 'RetailFinanceController'){throw "RetailFinanceController already registered; review manually."}
$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
Copy-Item $schema "$schema.backup_$stamp"
Copy-Item $module "$module.backup_$stamp"
if(Test-Path $api){Copy-Item $api "$api.backup_$stamp"}
Add-Content -Path $schema -Value ("`n"+(Get-Content (Join-Path $here 'SCHEMA_APPEND.prisma.txt') -Raw))
$moduleText="import { RetailFinanceController } from './retail-finance';`n"+$moduleText
$moduleText=$moduleText.Replace('controllers:[','controllers:[RetailFinanceController,')
Set-Content -Path $module -Value $moduleText -Encoding UTF8
Copy-Item (Join-Path $here 'apps\api\src\retail-finance.ts') $api
Write-Host "Milestones 42-44 source staged. Original schema/module backups saved. DO NOT migrate until drift is resolved."
