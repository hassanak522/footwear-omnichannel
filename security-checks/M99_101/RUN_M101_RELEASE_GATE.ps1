param([string]$Root='G:\footwear-omnichannel')
$ErrorActionPreference='Stop'
$reports=Join-Path $Root 'security-checks\M99_101\reports'
New-Item -ItemType Directory -Force -Path $reports | Out-Null
$items=@(
  [pscustomobject]@{Gate='M93 authorization inventory reviewed';Status='UNVERIFIED';Evidence='Review M93 controller audit manually'},
  [pscustomobject]@{Gate='M94/M97 authenticated branch isolation';Status='UNVERIFIED';Evidence='Requires assigned and other REAL branch UUIDs with restricted test account'},
  [pscustomobject]@{Gate='M96 write-route authorization review';Status='UNVERIFIED';Evidence='Review route review CSV and service checks'},
  [pscustomobject]@{Gate='M98 durable finance audit events';Status='UNVERIFIED';Evidence='Inspect audit persistence and actor/location metadata'},
  [pscustomobject]@{Gate='M99 API contract inventory';Status=$(if(Test-Path (Join-Path $reports 'M99_api_route_inventory.csv')){'INVENTORIED'}else{'PENDING'});Evidence='Static source inventory only'},
  [pscustomobject]@{Gate='M100 signed-out session regression';Status='UNVERIFIED';Evidence='Attach console output of M100 run'},
  [pscustomobject]@{Gate='Authorized functional finance workflows';Status='UNVERIFIED';Evidence='Test with safe staging data and authorized accounts'}
)
$path=Join-Path $reports 'M101_release_gate.csv'
$items | Export-Csv -NoTypeInformation -Encoding UTF8 $path
$items | Format-Table -AutoSize
Write-Host "Saved release gate checklist: $path"
Write-Warning 'Not a production readiness certification. Unverified gates must be resolved before release.'
