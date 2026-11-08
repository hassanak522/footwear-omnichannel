param([string]$Root='G:\footwear-omnichannel')
$ErrorActionPreference='Stop'
$path=Join-Path $Root 'apps\api\src\transfers.ts'
if(-not (Test-Path -LiteralPath $path)){throw "Missing: $path"}
$src=[System.IO.File]::ReadAllText($path)
if($src.Contains('private async retrySerializable<')){throw 'Retry helper already present. No changes made.'}
$start='return this.db.$transaction(async tx=>{'
$end='},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable, maxWait:10000, timeout:30000});'
function Count-Of([string]$s,[string]$needle){return ([regex]::Matches($s,[regex]::Escape($needle))).Count}
if((Count-Of $src $start) -ne 5 -or (Count-Of $src $end) -ne 5){throw 'Unexpected source layout: expected exactly five M113 transactions. No changes made.'}
$helper=@'
 private async retrySerializable<T>(operation:()=>Promise<T>):Promise<T>{
  for(let attempt=0;attempt<3;attempt++){
   try{return await operation();}
   catch(error){
    const e=error as {code?:string;meta?:{code?:string}};
    const retryable=e?.code==='P2034'||(e?.code==='P2010'&&e?.meta?.code==='40001');
    if(!retryable)throw error;
    if(attempt===2)throw new ConflictException('Concurrent transfer update; retry request');
    await new Promise(resolve=>setTimeout(resolve,75*(attempt+1)));
   }
  }
  throw new ConflictException('Concurrent transfer update; retry request');
 }
'@
$anchor=' private requireRole('
if((Count-Of $src $anchor) -ne 1){throw 'Could not locate unique helper insertion point.'}
$src=$src.Replace($anchor,$helper+"`r`n"+$anchor)
$src=$src.Replace($start,'return this.retrySerializable(()=>this.db.$transaction(async tx=>{')
$src=$src.Replace($end,'},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable, maxWait:10000, timeout:30000}));')
$backup=Join-Path $Root ('security-checks\M113_SERIALIZATION_BACKUP_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item -LiteralPath $path -Destination (Join-Path $backup 'transfers.ts')
[System.IO.File]::WriteAllText($path,$src,(New-Object System.Text.UTF8Encoding($false)))
Write-Host 'PASS: Added bounded retries to five serializable transfer transactions.'
Write-Host "Backup: $backup"
Write-Host 'No database operations performed. Build and restart QA API 3002.'
