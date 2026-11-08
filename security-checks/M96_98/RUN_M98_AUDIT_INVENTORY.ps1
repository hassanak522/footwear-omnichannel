param([string]$Root='G:\footwear-omnichannel')
$ErrorActionPreference='Stop'
$src=Join-Path $Root 'apps\api\src'
if(!(Test-Path -LiteralPath $src)){throw 'API source not found'}
$out=Join-Path $Root 'security-checks\M96_98\reports'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$rows=@()
foreach($f in (Get-ChildItem -LiteralPath $src -Filter '*.ts' -File)){
 $code=Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
 $writes=([regex]::Matches($code,'@(Post|Put|Patch|Delete)\(')).Count
 if(!$writes){continue}
 $rows += [pscustomobject]@{
  File=$f.Name;WriteRouteDecorators=$writes;
  ActorReference=($code -match 'user\.id|actorId|createdById|updatedById|requestedById|openedById');
  LocationReference=($code -match 'locationId|warehouseId|assertLocation');
  EventOrAuditReference=($code -match 'audit|event|history|log');
  TransactionReference=($code -match '\$transaction');
  ManualReview='Inspect every write handler and service; verify durable actor, location, timestamp, action, outcome and transaction ID.'
 }
}
$path=Join-Path $out 'M98_write_audit_inventory.csv'
$rows | Sort-Object File | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $path
$rows | Sort-Object File | Format-Table File,WriteRouteDecorators,ActorReference,LocationReference,EventOrAuditReference,TransactionReference -AutoSize
Write-Host "Saved $path"
Write-Warning 'Text patterns are NOT proof of an audit trail. No database writes or finance operations were performed.'
