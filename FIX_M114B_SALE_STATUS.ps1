param([string]$Root = 'G:\footwear-omnichannel')
$ErrorActionPreference = 'Stop'
$target = Join-Path $Root 'apps\pos-desktop\electron\main.cjs'
if (-not (Test-Path -LiteralPath $target)) { throw "Missing source: $target" }
$source = [System.IO.File]::ReadAllText($target)
$old = "ipcMain.handle('sales:result',(_,id,status,error)=>{if(!['ACCEPTED','STOCK_CONFLICT','PENDING'].includes(status))throw Error('Invalid status');db.run('BEGIN');try{db.run('UPDATE sales SET status=?,error=? WHERE id=?',[status,error||null,id]);if(status!=='PENDING')db.run('DELETE FROM outbox WHERE sale_id=?',[id]);else db.run('UPDATE outbox SET attempts=attempts+1,last_error=? WHERE sale_id=?',[error||null,id]);db.run('COMMIT');persist();}catch(e){db.run('ROLLBACK');throw e;}});"
$new = @'
ipcMain.handle('sales:result',(_,id,status,error)=>{
 if(!['ACCEPTED','STOCK_CONFLICT','PENDING'].includes(status))throw Error('Invalid status');
 const sale=rows('SELECT status FROM sales WHERE id=?',[id])[0];
 if(!sale)throw Error('Unknown sale ID');
 if(sale.status!=='PENDING'){
  if(sale.status===status)return true; // Exact terminal-state replay: no mutation.
  throw Error('Finalized sale cannot change status');
 }
 db.run('BEGIN');
 try{
  db.run('UPDATE sales SET status=?,error=? WHERE id=?',[status,error||null,id]);
  if(status!=='PENDING')db.run('DELETE FROM outbox WHERE sale_id=?',[id]);
  else db.run('UPDATE outbox SET attempts=attempts+1,last_error=? WHERE sale_id=?',[error||null,id]);
  db.run('COMMIT');persist();return true;
 }catch(e){db.run('ROLLBACK');throw e;}
});
'@
$count = ([regex]::Matches($source,[regex]::Escape($old))).Count
if ($count -ne 1) { throw "Expected exactly one known sales:result handler; found $count. No changes made." }
$backupDir = Join-Path $Root ('security-checks\M114B_PATCH_BACKUP_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item -LiteralPath $target -Destination (Join-Path $backupDir 'main.cjs')
$updated = $source.Replace($old,$new.TrimEnd("`r","`n"))
[System.IO.File]::WriteAllText($target,$updated,[System.Text.UTF8Encoding]::new($false))
Write-Host "Patched: $target"
Write-Host "Backup: $backupDir"
Write-Host 'No API, database, or existing POS userData modified.'
