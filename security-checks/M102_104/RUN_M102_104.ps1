param([string]$Root='G:\footwear-omnichannel', [ValidateSet('M102','M103','M104','ALL')][string]$Milestone='ALL')
$ErrorActionPreference='Stop'
$target=Join-Path $Root 'security-checks\M102_104'
$reports=Join-Path $target 'reports'
New-Item -ItemType Directory -Force -Path $reports | Out-Null
$areas=@{
 M102=@('apps\api\src\online.ts','apps\api\src\checkout-foundation.ts','apps\api\src\pos.ts','apps\api\src\retail-ops.ts')
 M103=@('apps\api\src\inventory.ts','apps\api\src\transfers.ts','apps\api\src\pos.ts')
 M104=@('apps\api\src\finance-reconciliation.ts','apps\api\src\retail-finance.ts','apps\api\src\cash-reconciliation.ts','apps\api\src\finance-audit.ts')
}
$patterns=@{
 M102=@(@('Order lifecycle terms','order|fulfill|cancel|return'),@('Authentication guards','UseGuards|JwtAuthGuard'),@('Transaction boundary','\$transaction'),@('Idempotency controls','idempotencyKey|idempotent'))
 M103=@(@('Stock movement','stockMovement|StockMovement'),@('Reservation','stockReservation|StockReservation'),@('Concurrency control','advisory_xact_lock|Serializable|version'),@('Location authorization','assertLocation|locationId'))
 M104=@(@('Financial ledger/reconciliation','ledger|reconcil'),@('Refund/payment handling','refund|payment'),@('Audit evidence','auditLog|auditEvent|Audit'),@('Transaction boundary','\$transaction'))
}
$selected=if($Milestone -eq 'ALL'){@('M102','M103','M104')}else{@($Milestone)}
foreach($m in $selected){
 $rows=@()
 foreach($rel in $areas[$m]){
  $file=Join-Path $Root $rel
  if(-not(Test-Path -LiteralPath $file)){
   $rows += [pscustomobject]@{Milestone=$m;File=$rel;Check='File exists';Status='MISSING';Evidence='Source file not found'}
   continue
  }
  $content=Get-Content -LiteralPath $file -Raw
  foreach($check in $patterns[$m]){
   $matches=[regex]::Matches($content,$check[1],[System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
   $rows += [pscustomobject]@{Milestone=$m;File=$rel;Check=$check[0];Status=$(if($matches.Count){'FOUND_REVIEW_REQUIRED'}else{'NOT_FOUND_REVIEW_REQUIRED'});Evidence="Matches: $($matches.Count)"}
  }
 }
 $out=Join-Path $reports "${m}_static_evidence.csv"
 $rows | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $out
 Write-Host "$m : $($rows.Count) static checks -> $out"
}
$gates=@(
 [pscustomobject]@{Gate='Authenticated checkout/order/returns end-to-end';Status='UNVERIFIED';Requirement='Run isolated staging tests with authorized roles'},
 [pscustomobject]@{Gate='Concurrent stock reservation and transfer';Status='UNVERIFIED';Requirement='Exercise parallel transactions on staging DB'},
 [pscustomobject]@{Gate='Branch isolation for POS and warehouse';Status='UNVERIFIED';Requirement='Use restricted branch accounts and two locations'},
 [pscustomobject]@{Gate='Payment, refund, reconciliation and audit';Status='UNVERIFIED';Requirement='Use test payment flows and verify DB ledger'},
 [pscustomobject]@{Gate='Prior M101 release gates';Status='UNVERIFIED';Requirement='Resolve prior unverified release gates'}
)
$gates | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $reports 'M104_release_gate.csv')
Write-Warning 'Source-pattern evidence only. No runtime workflows were executed; FOUND is not PASS. Database and application files were not modified.'
