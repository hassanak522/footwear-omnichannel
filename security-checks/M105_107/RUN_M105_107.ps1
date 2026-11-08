param([string]$Root='G:\footwear-omnichannel',[ValidateSet('ALL','M105','M106','M107')][string]$Milestone='ALL')
$ErrorActionPreference='Stop'
$src=Join-Path $Root 'apps\api\src'
$schema=Join-Path $Root 'packages\database\prisma\schema.prisma'
if(!(Test-Path $src) -or !(Test-Path $schema)){throw 'API source or Prisma schema missing.'}
$report=Join-Path $Root 'security-checks\M105_107\reports'
New-Item -ItemType Directory -Force -Path $report | Out-Null
$checks=@(
 @{M='M105';File='auth.ts';Pattern='JwtAuthGuard';Note='Inspect guard behavior and token validation'},
 @{M='M105';File='inventory.ts';Pattern='assertLocation';Note='Test other-branch access with real branch credentials'},
 @{M='M105';File='pos.ts';Pattern='assertLocation';Note='Verify device, shift, sale and return branch ownership'},
 @{M='M105';File='transfers.ts';Pattern='assertLocation';Note='Check source and destination authorization on each transition'},
 @{M='M105';File='online.ts';Pattern='RolesGuard';Note='Verify order-management roles; public checkout is intentional'},
 @{M='M106';File='inventory.ts';Pattern='\$transaction';Note='Inspect atomicity of stock reservation and adjustment'},
 @{M='M106';File='pos.ts';Pattern='\$transaction';Note='Inspect duplicate sync and concurrent stock decrement'},
 @{M='M106';File='online.ts';Pattern='\$transaction';Note='Inspect checkout idempotency and order stock reservation'},
 @{M='M106';File='transfers.ts';Pattern='\$transaction';Note='Inspect double-receive and concurrent transfer transitions'},
 @{M='M107';File='finance-audit.ts';Pattern='audit|event|ledger';Note='Verify durable audit writes with staging DB'},
 @{M='M107';File='finance-audit-read.ts';Pattern='audit|event|ledger';Note='Verify audit read access restrictions'},
 @{M='M107';File='finance-reconciliation.ts';Pattern='reconcil|posting|ledger';Note='Validate reconciliation totals against DB'},
 @{M='M107';File='pos.ts';Pattern='returnSale|refund';Note='Verify returns are linked to original sale and postings'}
)
$selected=@($checks | Where-Object {$Milestone -eq 'ALL' -or $_.M -eq $Milestone})
$results=foreach($c in $selected){
 $path=Join-Path $src $c.File
 $found=$false;$matches=0
 if(Test-Path $path){$matches=@(Select-String -Path $path -Pattern $c.Pattern -AllMatches).Count;$found=$matches -gt 0}
 [pscustomobject]@{Milestone=$c.M;File=$c.File;Check=$c.Pattern;Status=$(if($found){'FOUND_REVIEW_REQUIRED'}else{'NOT_FOUND_REVIEW_REQUIRED'});Matches=$matches;NextStep=$c.Note}
}
$out=Join-Path $report ('{0}_static_review.csv' -f $Milestone)
$results | Export-Csv $out -NoTypeInformation -Encoding UTF8
$results | Format-Table Milestone,File,Status,Matches -AutoSize
Write-Host "Saved: $out"
Write-Warning 'Static evidence only. No runtime tests or production-readiness certification. No application code or database modified.'
