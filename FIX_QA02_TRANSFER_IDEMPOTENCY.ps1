param([string]$Root='G:\footwear-omnichannel')
$ErrorActionPreference='Stop'
$path=Join-Path $Root 'apps\api\src\transfers.ts'
if(-not (Test-Path -LiteralPath $path)){throw "Missing source: $path"}
$source=[System.IO.File]::ReadAllText($path)
$helper=@'
function canonicalJson(value: unknown): string {
 const normalize = (input: any): any => {
  if (Array.isArray(input)) return input.map(normalize);
  if (input !== null && typeof input === 'object') {
   const result: Record<string, any> = {};
   for (const key of Object.keys(input).sort()) result[key] = normalize(input[key]);
   return result;
  }
  return input;
 };
 return JSON.stringify(normalize(value));
}

'@
$anchor='@Injectable()' + "`n" + 'export class TransfersService'
if($source.Contains('function canonicalJson(value: unknown)')){
 Write-Host 'Canonical JSON helper already present; checking comparisons.'
}elseif($source.Contains($anchor)){
 $source=$source.Replace($anchor,$helper+$anchor)
}else{throw 'Source layout differs; no changes made'}
$old1='JSON.stringify(prior.payload)!==JSON.stringify({transferId,payload})'
$old2='JSON.stringify(prior.payload)!==JSON.stringify(dto)'
$source=$source.Replace($old1,'canonicalJson(prior.payload)!==canonicalJson({transferId,payload})')
$source=$source.Replace($old2,'canonicalJson(prior.payload)!==canonicalJson(dto)')
if($source.Contains($old1) -or $source.Contains($old2)){throw 'Some old comparisons remain; no changes made'}
if(-not $source.Contains('canonicalJson(prior.payload)!==canonicalJson(dto)') -or -not $source.Contains('canonicalJson(prior.payload)!==canonicalJson({transferId,payload})')){throw 'Expected comparisons not found; no changes made'}
$backup="$path.qa02-backup-$(Get-Date -Format yyyyMMdd_HHmmss)"
Copy-Item -LiteralPath $path -Destination $backup -ErrorAction Stop
[System.IO.File]::WriteAllText($path,$source,[System.Text.UTF8Encoding]::new($false))
Write-Host "PATCH APPLIED: $path" -ForegroundColor Green
Write-Host "BACKUP: $backup"
Write-Host 'No database changes made. Rebuild/restart isolated API 3002 before replay testing.'
