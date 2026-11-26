const {app,BrowserWindow,ipcMain,session}=require('electron');
const path=require('node:path');const fs=require('node:fs');const crypto=require('node:crypto');
// M114-E: Isolate Electron QA data from operational POS data.
if (process.env.POS_QA_MODE === '1') {
  const qaUserData = path.join(
    app.getPath('appData'),
    'royal-step-pos-qa-m114e'
  );

  app.setPath('userData', qaUserData);
}
let db;let SQL;const allowed=['config','catalog','sales','outbox'];
/* R10_1B_DURABLE_POS_STORAGE */
function databaseFile(){
 return path.join(app.getPath('userData'),'pos.sqlite');
}

function verifyDatabase(database){
 const result=database.exec('PRAGMA integrity_check');
 const value=result?.[0]?.values?.[0]?.[0];

 if(value!=='ok')
  throw Error('POS database integrity verification failed');
}

async function init(){
 const mod=await import('sql.js');

 SQL=await mod.default({
  locateFile:f=>require.resolve('sql.js/dist/'+f)
 });

 const file=databaseFile();

 db=fs.existsSync(file)
  ?new SQL.Database(fs.readFileSync(file))
  :new SQL.Database();

 verifyDatabase(db);

 db.run(`
  CREATE TABLE IF NOT EXISTS config (
   key TEXT PRIMARY KEY,
   value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS catalog (
   id TEXT PRIMARY KEY,
   barcode TEXT,
   sku TEXT,
   title TEXT,
   size TEXT,
   color TEXT,
   price REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sales (
   id TEXT PRIMARY KEY,
   payload TEXT NOT NULL,
   status TEXT NOT NULL,
   created_at TEXT NOT NULL,
   error TEXT
  );
  CREATE TABLE IF NOT EXISTS outbox (
   id TEXT PRIMARY KEY,
   sale_id TEXT NOT NULL UNIQUE,
   attempts INTEGER NOT NULL DEFAULT 0,
   last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS clearance_attempts (
   id TEXT PRIMARY KEY,
   payload TEXT NOT NULL,
   status TEXT NOT NULL,
   created_at TEXT NOT NULL,
   server_response TEXT,
   error TEXT
  );
   CREATE TABLE IF NOT EXISTS exchange_resolutions (
    attempt_id TEXT PRIMARY KEY,
    response TEXT NOT NULL,
    resolved_at TEXT NOT NULL
   );
CREATE TABLE IF NOT EXISTS refund_resolutions (
 attempt_id TEXT PRIMARY KEY,
 response TEXT NOT NULL,
 resolved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refund_attempts (
 id TEXT PRIMARY KEY,
 location_id TEXT NOT NULL,
 payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK(
  status IN ('PREPARED','UNKNOWN','PAID','ACCEPTED')
 ),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 server_response TEXT
);
CREATE TABLE IF NOT EXISTS exchange_attempts (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PREPARED','UNKNOWN','ACCEPTED')),
    created_at TEXT NOT NULL,
    server_response TEXT,
    error TEXT
   );
  CREATE TABLE IF NOT EXISTS discount_attempts (
   id TEXT PRIMARY KEY,
   payload TEXT NOT NULL,
   status TEXT NOT NULL,
   created_at TEXT NOT NULL,
   server_response TEXT,
   error TEXT
  );
 `);

 // Restore queue entries for locally pending sales.
 // Accepted and conflicted sales are never requeued.
 db.run(`
  INSERT INTO outbox(id,sale_id,attempts,last_error)
  SELECT lower(hex(randomblob(16))),s.id,0,NULL
  FROM sales s
  WHERE s.status='PENDING'
   AND NOT EXISTS (
    SELECT 1 FROM outbox o WHERE o.sale_id=s.id
   )
 `);

 // Remove stale queue entries for finalized sales.
 db.run(`
  DELETE FROM outbox
  WHERE NOT EXISTS (
   SELECT 1 FROM sales s
   WHERE s.id=outbox.sale_id
    AND s.status='PENDING'
  )
 `);

 verifyDatabase(db);
 persist();
}

function persist(){
 const file=databaseFile();
 const temp=file+'.tmp';
 const backup=file+'.bak';
 const bytes=Buffer.from(db.export());

 // Verify exported database before replacing the active file.
 const candidate=new SQL.Database(bytes);

 try{
  verifyDatabase(candidate);
 }finally{
  candidate.close();
 }

 // Keep the previous committed database as a recovery copy.
 // Never overwrite it with a known-corrupt database.
 if(fs.existsSync(file)){
  const existing=new SQL.Database(fs.readFileSync(file));

  try{
   verifyDatabase(existing);
  }finally{
   existing.close();
  }

  fs.copyFileSync(file,backup);
 }

 // Flush temporary database bytes before atomic rename.
 let fd;

 try{
  fd=fs.openSync(temp,'w');
  fs.writeFileSync(fd,bytes);
  fs.fsyncSync(fd);
 }finally{
  if(fd!==undefined)fs.closeSync(fd);
 }

 fs.renameSync(temp,file);
}
function rows(sql,params=[]){const st=db.prepare(sql);st.bind(params);const result=[];while(st.step())result.push(st.getAsObject());st.free();return result;}
function saveConfig(key,value){db.run('INSERT INTO config(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,JSON.stringify(value)]);persist();}
function readConfig(key){const r=rows('SELECT value FROM config WHERE key=?',[key])[0];return r?JSON.parse(r.value):null;}
function window(){
  const devURL='http://127.0.0.1:5173/';
  const useBuiltUI=process.env.POS_USE_BUILT_UI==='1' || app.isPackaged;
  const win=new BrowserWindow({
    width:1400,height:880,minWidth:1000,minHeight:680,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  // Do not cancel the initial Vite navigation. Only block navigation away from the POS origin.
  win.webContents.on('will-navigate',(event,url)=>{
    const allowed=useBuiltUI?url.startsWith('file://'):new URL(url).origin===new URL(devURL).origin;
    if(!allowed){event.preventDefault();console.warn('[POS] Blocked navigation:',url);}
  });
  win.webContents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{
    if(isMainFrame && code!==-3)console.error('[POS] Page load failed:',code,description,url);
  });
  win.webContents.on('preload-error',(_event,preloadPath,error)=>console.error('[POS] Preload failed:',preloadPath,error));
  win.webContents.on('render-process-gone',(_event,details)=>console.error('[POS] Renderer exited:',details));
  win.webContents.on('did-finish-load',()=>console.log('[POS] Loaded:',win.webContents.getURL()));
  const loading=useBuiltUI
    ?win.loadFile(path.join(__dirname,'../dist/index.html'))
    :win.loadURL(devURL);
  loading.catch(error=>console.error('[POS] Navigation failed:',error));
  return win;
}
app.whenReady().then(async()=>{
ipcMain.handle('qa:is-offline', () => {
  if (process.env.POS_QA_MODE !== '1') return false;
  return fs.existsSync(
    path.join(app.getPath('userData'), 'M114E_QA_OFFLINE.flag')
  );
});
if (process.env.POS_QA_MODE === '1') {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {

      let url;
      try {
        url = new URL(details.url);
      } catch {
        callback({ cancel: true });
        return;
      }

      const isQaApi =
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname) &&
        url.port === '3002' &&
        (url.pathname === '/api/v1' ||
         url.pathname.startsWith('/api/v1/'));

      const isVite =
        url.protocol === 'http:' &&
        url.hostname === '127.0.0.1' &&
        url.port === '5173';

      callback({ cancel: !(isQaApi || isVite) });
    }
  );
}
session.defaultSession.webRequest.onHeadersReceived((details,callback)=>{if(details.resourceType==='mainFrame'){callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[`default-src 'self'; script-src 'self'${process.env.POS_QA_MODE === '1' ? " 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://royal-step-api-production.up.railway.app http://127.0.0.1:3001 http://localhost:3001${process.env.POS_QA_MODE === '1' ? ' http://127.0.0.1:3002 http://localhost:3002' : ''}; object-src 'none'; base-uri 'none'; form-action 'none'`]}});}else callback({responseHeaders:details.responseHeaders});});await init();ipcMain.handle('config:get',(_,k)=>readConfig(k));ipcMain.handle('config:set',(_,k,v)=>{if(!['apiUrl','deviceId','locationId','shiftId','session'].includes(k))throw Error('Invalid setting');saveConfig(k,v);return true;});ipcMain.handle('catalog:list',()=>rows('SELECT * FROM catalog ORDER BY title,size,color'));ipcMain.handle('catalog:replace',(_,items)=>{if(!Array.isArray(items)||items.length>100000)throw Error('Invalid catalog');db.run('BEGIN');try{db.run('DELETE FROM catalog');for(const i of items){if(!i.id||!i.barcode||!Number.isFinite(Number(i.price)))throw Error('Invalid product variant');db.run('INSERT INTO catalog VALUES (?,?,?,?,?,?,?)',[i.id,i.barcode,i.sku,i.title,i.size,i.color,Number(i.price)]);}db.run('COMMIT');persist();return items.length;}catch(e){db.run('ROLLBACK');throw e;}});/* R10_1_STANDARD_SALE_INTEGRITY */
ipcMain.handle('sales:save',(_,payload)=>{
 if(!payload||typeof payload!=='object')
  throw Error('Invalid sale payload');

 if(payload.localSaleId||payload.soldAt)
  throw Error('Sale identity must be generated by the POS');

 if(
  typeof payload.deviceId!=='string'||
  typeof payload.shiftId!=='string'||
  !Array.isArray(payload.lines)||
  !payload.lines.length||
  !Array.isArray(payload.tenders)||
  !payload.tenders.length
 )throw Error('Incomplete sale payload');

 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

 if(!uuid.test(payload.deviceId)||!uuid.test(payload.shiftId))
  throw Error('Invalid POS device or shift identity');

 const configuredDevice=readConfig('deviceId');
 const configuredShift=readConfig('shiftId');

 if(configuredDevice!==payload.deviceId||
    configuredShift!==payload.shiftId)
  throw Error('Sale identity does not match this terminal');

 const variants=new Set();
 let totalCents=0;

 for(const line of payload.lines){
  if(!line||!uuid.test(line.variantId)||
     !Number.isSafeInteger(line.quantity)||
     line.quantity<=0||
     !Number.isFinite(line.unitPrice)||
     line.unitPrice<0)
   throw Error('Invalid sale line');

  if(variants.has(line.variantId))
   throw Error('Duplicate sale variant');

  variants.add(line.variantId);

  const priceCents=Math.round(line.unitPrice*100);

  if(Math.abs(line.unitPrice*100-priceCents)>0.000001)
   throw Error('Unit price must have at most two decimals');

  totalCents+=priceCents*line.quantity;
 }

 if(!Number.isSafeInteger(totalCents)||totalCents<=0)
  throw Error('Invalid sale total');

 let tenderCents=0;

 for(const tender of payload.tenders){
  if(!tender||
     !['CASH','CARD','EASYPAISA','JAZZCASH'].includes(tender.type)||
     !Number.isFinite(tender.amount)||
     tender.amount<=0)
   throw Error('Invalid sale tender');

  const cents=Math.round(tender.amount*100);

  if(Math.abs(tender.amount*100-cents)>0.000001)
   throw Error('Tender amount must have at most two decimals');

  tenderCents+=cents;
 }

 if(!Number.isSafeInteger(tenderCents)||
    tenderCents!==totalCents)
  throw Error('Tender total does not match sale total');

 const id=crypto.randomUUID();

 const saved={
  ...payload,
  localSaleId:id,
  soldAt:new Date().toISOString()
 };

 db.run('BEGIN');

 try{
  db.run(
   'INSERT INTO sales VALUES (?,?,?,?,?)',
   [
    id,
    JSON.stringify(saved),
    'PENDING',
    saved.soldAt,
    null
   ]
  );

  db.run(
   'INSERT INTO outbox(id,sale_id) VALUES (?,?)',
   [crypto.randomUUID(),id]
  );

  db.run('COMMIT');
  persist();

  return id;
 }catch(error){
  try{db.run('ROLLBACK');}catch(_){}
  throw error;
 }
});
ipcMain.handle('receipt:print',async(_,id)=>{const sale=rows('SELECT * FROM sales WHERE id=?',[id])[0];if(!sale)throw Error('Unknown receipt');if(sale.status!=='ACCEPTED')throw Error('Receipt unavailable until central sale acceptance');const payload=JSON.parse(sale.payload);const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false}});const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const catalog=new Map(rows('SELECT * FROM catalog').map(x=>[x.id,x]));const total=payload.tenders.reduce((n,t)=>n+Math.round(t.amount*100),0)/100;const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font:13px monospace;width:76mm;margin:5mm}table{width:100%;border-collapse:collapse}td{padding:4px 0;border-bottom:1px dashed #bbb}h2{text-align:center}</style></head><body><h2>ROYAL STEP</h2><p>Receipt: ${esc(id)}<br>Sale: ${esc(payload.soldAt)}<br>Status: ${esc(sale.status)}${payload.customerId?`<br>Customer ID: ${esc(payload.customerId.slice(0,8))}`:""}</p><table>${payload.lines.map(l=>{const v=catalog.get(l.variantId)||{};return `<tr><td>${esc(v.title||l.variantId)}<br>${esc(v.sku||'')} / ${esc(v.size||'')}</td><td>${esc(l.quantity)} ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${esc(l.unitPrice)}</td></tr>`}).join('')}</table><h3>Total: Rs ${esc(total.toFixed(2))}</h3><p>${payload.tenders.map(t=>esc(t.type)+': Rs '+esc(t.amount)).join('<br>')}</p><p>Thank you for shopping at Royal Step.</p><hr><p style="text-align:center;font-size:10px">Software by 7Solutions<br>03313621464</p></body></html>`;await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));return new Promise(resolve=>win.webContents.print({silent:false,printBackground:false},(success,reason)=>{win.close();resolve({success,reason});}));});/* R8_01G_4B5B_CLEARANCE_LEDGER */

ipcMain.handle('clearance:prepare',(_,payload)=>{
 if(
  !payload||
  !payload.deviceId||
  !payload.shiftId||
  !payload.locationId||
  !Array.isArray(payload.lines)||
  !payload.lines.length||
  !Array.isArray(payload.tenders)||
  !payload.tenders.length
 ){
  throw Error('Invalid clearance checkout payload');
 }

 if(
  payload.localSaleId||
  payload.promotionCode||
  payload.clearanceCampaignId
 ){
  throw Error('Clearance attempt must receive a new local sale ID');
 }

 const id=crypto.randomUUID();

 const saved={
  ...payload,
  localSaleId:id
 };

 db.run(
  'INSERT INTO clearance_attempts '+
  '(id,payload,status,created_at,server_response,error) '+
  'VALUES (?,?,?,?,?,?)',
  [
   id,
   JSON.stringify(saved),
   'PREPARED',
   new Date().toISOString(),
   null,
   null
  ]
 );

 persist();

 return {
  id,
  payload:saved
 };
});

ipcMain.handle('clearance:list',()=>rows(
 'SELECT * FROM clearance_attempts '+
 'ORDER BY created_at DESC LIMIT 100'
));

ipcMain.handle('clearance:update',(_,id,status,response,error)=>{
 if(!['PREPARED','UNKNOWN','ACCEPTED','REJECTED'].includes(status)){
  throw Error('Invalid clearance attempt status');
 }

 const existing=rows(
  'SELECT status FROM clearance_attempts WHERE id=?',
  [id]
 )[0];

 if(!existing){
  throw Error('Unknown clearance attempt');
 }

 if(
  existing.status==='ACCEPTED'&&
  status!=='ACCEPTED'
 ){
  throw Error('Accepted clearance sale cannot be downgraded');
 }

 if(
  existing.status==='REJECTED'&&
  status!=='REJECTED'
 ){
  throw Error('Rejected clearance sale cannot be reopened');
 }

 if(
  status==='ACCEPTED'&&
  (
   !response||
   response.found!==true||
   response.clearanceSale!==true||
   response.status!=='ACCEPTED'||
   response.paymentState!=='SALE_RECORDED'||
   response.integrity?.allocationValid!==true
  )
 ){
  throw Error(
   'Server-confirmed clearance receipt required before acceptance'
  );
 }

 db.run(
  'UPDATE clearance_attempts '+
  'SET status=?,server_response=?,error=? WHERE id=?',
  [
   status,
   response?JSON.stringify(response):null,
   error||null,
   id
  ]
 );

 persist();

 return true;
});
// R10_3D23B_DURABLE_EXCHANGE

function persistExchangeMutation(action){
 const before=db.export();

 try{
  action();
  persist();
 }catch(error){
  db.close();
  db=new SQL.Database(before);
  throw error;
 }
}

// R10_3D24C_REFUND_JOURNAL

ipcMain.handle('refund:prepare',(_,locationId,payload)=>{

 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

 if(
  !uuid.test(locationId||'')||
  locationId!==readConfig('locationId')||
  !payload||
  !uuid.test(payload.returnId||'')||
  payload.idempotencyKey
 ){
  throw Error('Invalid refund identity');
 }

 if(rows(
  "SELECT id FROM refund_attempts WHERE status!='ACCEPTED' AND id NOT IN (SELECT attempt_id FROM refund_resolutions)"
 ).length){
  throw Error('Reconcile the existing refund payout first');
 }

 if(!['CASH','CARD','OTHER'].includes(payload.method)){
  throw Error('Invalid refund method');
 }

 const cents=Math.round(payload.amount*100);

 if(
  typeof payload.amount!=='number'||
  !Number.isFinite(payload.amount)||
  !Number.isSafeInteger(cents)||
  cents<=0||
  cents>999999999999||
  Math.abs(payload.amount*100-cents)>0.000001
 ){
  throw Error('Invalid refund amount');
 }

 const reference=String(payload.reference||'').trim();

 if(reference.length>200){
  throw Error('Refund reference is too long');
 }

 if(payload.method==='CASH'){
  if(
   !uuid.test(payload.payoutShiftId||'')||
   payload.payoutShiftId!==readConfig('shiftId')
  ){
   throw Error('Refund requires the configured payout shift');
  }
 }else{
  if(!reference||payload.payoutShiftId){
   throw Error('Invalid external refund details');
  }
 }

 // R10_3D24C_DURABLE_REFUND_IDENTITY
 const deviceId=readConfig('deviceId');
 const shiftId=readConfig('shiftId');

 if(
  !uuid.test(deviceId||'')||
  !uuid.test(shiftId||'')
 ){
  throw Error(
   'A registered terminal and open operational shift are required'
  );
 }

 const id=crypto.randomUUID();

 const saved={
  returnId:payload.returnId,
  idempotencyKey:id,
  locationId,
  deviceId,
  shiftId,
  method:payload.method,
  amount:cents/100,
  ...(payload.method==='CASH'
   ?{payoutShiftId:payload.payoutShiftId}:{}
  ),
  ...(reference?{reference}:{})
 };

 const now=new Date().toISOString();

 persistExchangeMutation(()=>{
  db.run(
   'INSERT INTO refund_attempts VALUES (?,?,?,?,?,?,?)',
   [
    id,
    locationId,
    JSON.stringify(saved),
    'PREPARED',
    now,
    now,
    null
   ]
  );
 });

 return {id,payload:saved};
});

ipcMain.handle('refund:list',()=>rows(
 "SELECT * FROM refund_attempts "+
 "WHERE status!='ACCEPTED' AND id NOT IN (SELECT attempt_id FROM refund_resolutions) "+
 "ORDER BY created_at ASC"
));

// R10_3D24C_LOCAL_REFUND_RESOLUTION
ipcMain.handle('refund:resolve',(_,id,response)=>{

 const attempt=rows(
  'SELECT * FROM refund_attempts WHERE id=?',
  [id]
 )[0];

 if(!attempt){
  throw Error('Local refund attempt not found');
 }

 if(attempt.status==='ACCEPTED'||attempt.status==='PAID'){
  throw Error(
   'Paid or accepted refunds cannot be cancelled'
  );
 }

 const payload=JSON.parse(attempt.payload);

 if(
  !response||
  response.found!==true||
  response.idempotencyKey!==id||
  response.status!=='RESOLVED_NO_PAYMENT'||
  response.paymentState!=='NOT_PAID'||
  response.locationId!==attempt.location_id||
  response.returnId!==payload.returnId||
  response.method!==payload.method||
  Math.round(Number(response.amount)*100)!==
   Math.round(Number(payload.amount)*100)||
  (payload.deviceId&&response.deviceId!==payload.deviceId)||
  (payload.shiftId&&response.shiftId!==payload.shiftId)||
  !response.resolvedById||
  !response.resolvedAt||
  !response.resolutionReason
 ){
  throw Error('Central refund resolution mismatch');
 }

 const existing=rows(
  'SELECT * FROM refund_resolutions WHERE attempt_id=?',
  [id]
 )[0];

 if(existing)return true;

 persistExchangeMutation(()=>{
  db.run(
   'INSERT INTO refund_resolutions(attempt_id,response,resolved_at) VALUES(?,?,?)',
   [
    id,
    JSON.stringify(response),
    new Date().toISOString()
   ]
  );
 });

 return true;
});

ipcMain.handle('refund:update',(_,id,status,response)=>{

 const attempt=rows(
  'SELECT * FROM refund_attempts WHERE id=?',
  [id]
 )[0];

 if(!attempt){
  throw Error('Refund attempt not found');
 }

 if(rows(
  'SELECT attempt_id FROM refund_resolutions WHERE attempt_id=?',
  [id]
 ).length){
  throw Error('Resolved refund cannot be reopened');
 }

 if(attempt.status==='ACCEPTED'){
  if(status==='ACCEPTED')return true;
  throw Error('Accepted refund cannot be reopened');
 }

 const allowed={
  PREPARED:['UNKNOWN'],
  UNKNOWN:['PAID'],
  PAID:['ACCEPTED']
 };

 if(!(allowed[attempt.status]||[]).includes(status)){
  throw Error('Invalid refund journal transition');
 }

 const payload=JSON.parse(attempt.payload);

 if(status==='ACCEPTED'){

  if(
   !response||
   !response.id||
   response.found!==true||
   response.status!=='ACCEPTED'||
   response.integrityVerified!==true||
   response.centralAttemptVerified!==true||
   response.locationId!==attempt.location_id||
   (payload.deviceId&&response.deviceId!==payload.deviceId)||
   (payload.shiftId&&response.shiftId!==payload.shiftId)||
   response.idempotencyKey!==id||
   response.returnId!==payload.returnId||
   response.method!==payload.method||
   Math.round(Number(response.amount)*100)!==
    Math.round(payload.amount*100)||
   (response.payoutShiftId||null)!==
    (payload.payoutShiftId||null)||
   (response.reference||null)!==
    (payload.reference||null)
  ){
   throw Error('Central refund confirmation mismatch');
  }
 }

 persistExchangeMutation(()=>{
  db.run(
   'UPDATE refund_attempts SET status=?,updated_at=?,server_response=? WHERE id=?',
   [
    status,
    new Date().toISOString(),
    status==='ACCEPTED'?JSON.stringify(response):null,
    id
   ]
  );
 });

 return true;
});

ipcMain.handle('exchange:prepare',(_,payload)=>{

 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

 if(!payload||typeof payload!=='object'){
  throw Error('Invalid exchange payload');
 }

 if(payload.idempotencyKey){
  throw Error('Exchange identity must be generated locally');
 }

 for(const field of [
  'deviceId','locationId','shiftId','originalSaleId'
 ]){
  if(!uuid.test(payload[field]||'')){
   throw Error('Invalid exchange identity: '+field);
  }
 }

 if(
  readConfig('deviceId')!==payload.deviceId||
  readConfig('locationId')!==payload.locationId||
  readConfig('shiftId')!==payload.shiftId
 ){
  throw Error('Exchange does not match terminal configuration');
 }

 if(rows(
  "SELECT id FROM exchange_attempts WHERE status!='ACCEPTED' AND id NOT IN (SELECT attempt_id FROM exchange_resolutions)"
 ).length){
  throw Error('Reconcile existing exchange before continuing');
 }

 for(const field of ['returnLines','replacementLines']){

  const lines=payload[field];

  if(!Array.isArray(lines)||!lines.length||lines.length>100){
   throw Error('Invalid merchandise lines');
  }

  const variants=new Set();

  for(const line of lines){

   if(
    !line||
    !uuid.test(line.variantId||'')||
    !Number.isSafeInteger(line.quantity)||
    line.quantity<1||
    line.quantity>1000||
    variants.has(line.variantId)
   ){
    throw Error('Invalid or duplicate merchandise variant');
   }

   variants.add(line.variantId);
  }
 }

 if(
  typeof payload.reason!=='string'||
  payload.reason.trim().length<3||
  payload.reason.length>500
 ){
  throw Error('Invalid exchange reason');
 }

 const cents=value=>{

  const n=Math.round(value*100);

  if(
   typeof value!=='number'||
   !Number.isSafeInteger(n)||
   n<0||
   n>999999999999||
   Math.abs(value*100-n)>0.000001
  ){
   throw Error('Invalid monetary amount');
  }

  return n;
 };

 const returned=cents(payload.expectedReturnValue);
 const replacement=cents(payload.expectedReplacementValue);

 if(replacement<=0){
  throw Error('Replacement value must be positive');
 }

 if(
  !Array.isArray(payload.additionalTenders)||
  payload.additionalTenders.length>10
 ){
  throw Error('Invalid additional payment');
 }

 let payment=0;

 for(const tender of payload.additionalTenders){

  if(!tender||!['CASH','CARD','OTHER'].includes(tender.type)){
   throw Error('Invalid physical payment method');
  }

  const amount=cents(tender.amount);

  if(amount<=0){
   throw Error('Payment must be positive');
  }

  if(
   tender.type!=='CASH'&&
   (
    typeof tender.reference!=='string'||
    !tender.reference.trim()||
    tender.reference.length>100
   )
  ){
   throw Error('External payment reference required');
  }

  payment+=amount;
 }

 if(payment!==Math.max(0,replacement-returned)){
  throw Error('Additional payment does not match exchange');
 }

 const id=crypto.randomUUID();
 const saved={...payload,idempotencyKey:id};

 persistExchangeMutation(()=>{
  db.run(
   'INSERT INTO exchange_attempts VALUES (?,?,?,?,?,?)',
   [
    id,
    JSON.stringify(saved),
    'PREPARED',
    new Date().toISOString(),
    null,
    null
   ]
  );
 });

 return {id,payload:saved};
});

// R10_3D23B_LOCAL_RESOLUTION
ipcMain.handle('exchange:list',()=>rows(
 "SELECT a.id,a.payload,"+
 "CASE WHEN r.attempt_id IS NOT NULL "+
 "THEN 'RESOLVED_NO_EXCHANGE' ELSE a.status END AS status,"+
 "a.created_at,COALESCE(r.response,a.server_response) AS server_response,"+
 "CASE WHEN r.attempt_id IS NOT NULL THEN NULL ELSE a.error END AS error "+
 "FROM exchange_attempts a "+
 "LEFT JOIN exchange_resolutions r ON r.attempt_id=a.id "+
 "ORDER BY CASE WHEN a.status='ACCEPTED' OR "+
 "r.attempt_id IS NOT NULL THEN 1 ELSE 0 END,a.created_at DESC"
));

ipcMain.handle('exchange:resolve',(_,id,response)=>{

 const attempt=rows(
  'SELECT * FROM exchange_attempts WHERE id=?',[id]
 )[0];

 if(!attempt||attempt.status==='ACCEPTED'){
  throw Error('Exchange cannot be locally resolved');
 }

 const payload=JSON.parse(attempt.payload);

 if(
  !response||
  // R10_3D24C_EXCHANGE_JOURNAL_INTEGRITY
  response.found!==true||
  response.status!=='RESOLVED_NO_EXCHANGE'||
  response.idempotencyKey!==id||
  response.locationId!==payload.locationId||
  response.deviceId!==payload.deviceId||
  response.shiftId!==payload.shiftId||
  response.originalSaleId!==payload.originalSaleId||
  (
   response.paymentState==='REVERSED'
    ?response.reversalStatus!=='CONFIRMED'
    :response.reversalStatus!=='NONE'
  )||
  !response.resolvedById||
  !response.resolvedAt||
  !response.resolutionReason||
  !['NOT_COLLECTED','REVERSED','NO_PAYMENT_REQUIRED'].includes(
   response.paymentState
  )
 ){
  throw Error('Verified central resolution required');
 }

 const existing=rows(
  'SELECT * FROM exchange_resolutions WHERE attempt_id=?',[id]
 )[0];

 if(existing)return true;

 persistExchangeMutation(()=>{
  db.run(
   'INSERT INTO exchange_resolutions VALUES (?,?,?)',
   [id,JSON.stringify(response),response.resolvedAt]
  );
 });

 return true;
});

// R10_3D23B_THERMAL_RECEIPT

ipcMain.handle('exchange:receipt',async(_,id)=>{

 const attempt=rows(
  'SELECT * FROM exchange_attempts WHERE id=?',
  [id]
 )[0];

 if(
  !attempt||
  attempt.status!=='ACCEPTED'||
  !attempt.server_response
 ){
  throw Error('Verified exchange receipt unavailable');
 }

 const r=JSON.parse(attempt.server_response);
 const payload=JSON.parse(attempt.payload);

 if(
  r.status!=='ACCEPTED'||
  r.integrityVerified!==true||
  r.idempotencyKey!==id||
  r.originalSaleId!==payload.originalSaleId||
  r.locationId!==payload.locationId||
  r.deviceId!==payload.deviceId||
  r.shiftId!==payload.shiftId
 ){
  throw Error('Refresh verified central exchange status before printing');
 }

 const esc=value=>String(value??'').replace(
  /[&<>"']/g,
  char=>({
   '&':'&amp;',
   '<':'&lt;',
   '>':'&gt;',
   '"':'&quot;',
   "'":'&#39;'
  }[char])
 );

 const money=value=>{
  const amount=Number(value);
  if(!Number.isFinite(amount)||amount<0){
   throw Error('Invalid receipt monetary amount');
  }
  return amount.toFixed(2);
 };

 const fields=[
  ['Returned merchandise',r.returnValue],
  ['Replacement merchandise',r.replacementValue],
  ['Exchange credit',r.exchangeCredit],
  ['Additional payment',r.additionalPayment],
  ['Residual refund due',r.residualRefund],
  ['Refund recorded',r.residualRefundPaid],
  ['Refund outstanding',r.residualRefundOutstanding]
 ];

 const amounts=fields.map(([label,value])=>
  `<tr><td>${esc(label)}</td><td>${esc(money(value))}</td></tr>`
 ).join('');

 const catalog=new Map(
  rows('SELECT * FROM catalog').map(item=>[item.id,item])
 );

 const items=(lines)=>lines.map(line=>{

  const item=catalog.get(line.variantId)||{};

  return `<tr>
   <td>
    ${esc(item.title||line.variantId)}<br>
    ${esc(item.sku||'')} ${esc(item.size||'')}
   </td>
   <td>${esc(line.quantity)}</td>
  </tr>`;

 }).join('');

 const html=`<!doctype html>
 <html>
 <head>
 <meta charset="utf-8">
 <style>
 @page { size:80mm auto; margin:3mm; }
 body {
  width:72mm;
  margin:0;
  color:#000;
  font:11px monospace;
  overflow-wrap:anywhere;
 }
 h2,h3,.center { text-align:center; }
 table { width:100%; border-collapse:collapse; }
 td { padding:4px 0; border-bottom:1px dashed #bbb; }
 td:last-child { text-align:right; }
 hr { border:0; border-top:1px dashed #000; }
 .small { font-size:9px; }
 </style>
 </head>
 <body>

 <h2>ROYAL STEP</h2>
 <h3>MERCHANDISE EXCHANGE</h3>

 <p class="small">
 Exchange: ${esc(r.id)}<br>
 Transaction: ${esc(id)}<br>
 Original sale: ${esc(r.originalSaleId)}<br>
 Return: ${esc(r.returnId)}<br>
 Replacement sale: ${esc(r.replacementSaleId)}<br>
 Branch: ${esc(r.locationId)}<br>
 Recorded: ${esc(r.createdAt)}<br>
 Verified: ${esc(r.verifiedAt)}<br>
 Status: ACCEPTED
 </p>

 <hr>

 <h3>Returned items</h3>
 <table>${items(payload.returnLines)}</table>

 <h3>Replacement items</h3>
 <table>${items(payload.replacementLines)}</table>

 <hr>

 <table>${amounts}</table>

 <p>All amounts in PKR.</p>

 <p class="small">
 Refund information is as of the verification timestamp.
 This receipt does not authorize an additional refund.
 </p>

 <hr>

 <p class="center">
 Thank you for shopping at Royal Step.
 </p>

 </body>
 </html>`;

 const win=new BrowserWindow({
  show:false,
  webPreferences:{
   sandbox:true,
   nodeIntegration:false,
   contextIsolation:true
  }
 });

 try{

  await win.loadURL(
   'data:text/html;charset=utf-8,'+
   encodeURIComponent(html)
  );

  return await new Promise(resolve=>{

   win.webContents.print(
    {
     silent:false,
     printBackground:false
    },
    (success,reason)=>resolve({success,reason})
   );

  });

 }finally{

  if(!win.isDestroyed())win.close();

 }
});
ipcMain.handle('exchange:update',(_,id,status,response,error)=>{

 if(!['UNKNOWN','ACCEPTED'].includes(status)){
  throw Error('Invalid exchange status');
 }

 const existing=rows(
  'SELECT * FROM exchange_attempts WHERE id=?',[id]
 )[0];

 if(!existing){
  throw Error('Unknown exchange attempt');
 }

 if(rows(
  'SELECT attempt_id FROM exchange_resolutions WHERE attempt_id=?',
  [id]
 ).length){
  throw Error('Resolved exchange cannot be reopened');
 }

 // R10_3D23B_RECEIPT_REFRESH
 if(existing.status==='ACCEPTED'&&status!=='ACCEPTED'){
  throw Error('Accepted exchange cannot be downgraded');
 }

 if(existing.status==='ACCEPTED'&&status==='ACCEPTED'){

  const previous=JSON.parse(existing.server_response||'null');

  if(
   !previous||
   !response||
   previous.id!==response.id||
   previous.returnId!==response.returnId||
   previous.replacementSaleId!==response.replacementSaleId
  ){
   throw Error('Accepted exchange identity cannot be changed');
  }
 }

 if(rows(
  'SELECT attempt_id FROM exchange_resolutions WHERE attempt_id=?',
  [id]
 ).length){
  throw Error('Resolved exchange cannot be modified');
 }

const payload=JSON.parse(existing.payload);

 if(status==='ACCEPTED'){

  if(
   !response||
   // R10_3D24C_EXCHANGE_ACCEPTANCE_BOUNDARY

   response.found!==true||
   response.integrityVerified!==true||
   response.centralAttemptVerified!==true||
   response.paymentExecutionAuthorized!==false||
   response.reversalStatus!=='NONE'||
   !['CONFIRMED','NO_PAYMENT_REQUIRED'].includes(response.paymentState)||
   response.deviceId!==payload.deviceId||
   response.shiftId!==payload.shiftId||
   response.status!=='ACCEPTED'||
   response.idempotencyKey!==id||
   response.originalSaleId!==payload.originalSaleId||
   response.locationId!==payload.locationId||
   !response.returnId||
   !response.replacementSaleId||
   Number(response.returnValue)!==payload.expectedReturnValue||
   Number(response.replacementValue)!==payload.expectedReplacementValue||
   Number(response.exchangeCredit)!==Math.min(
    payload.expectedReturnValue,
    payload.expectedReplacementValue
   )||
   Math.round(Number(response.additionalPayment)*100)!==
    Math.max(
     0,
     Math.round(payload.expectedReplacementValue*100)-
     Math.round(payload.expectedReturnValue*100)
    )
  ){
   throw Error('Verified central exchange required');
  }
 }

 persistExchangeMutation(()=>{
  db.run(
   'UPDATE exchange_attempts SET status=?,server_response=?,error=? WHERE id=?',
   [
    status,
    response?JSON.stringify(response):null,
    error?String(error).slice(0,2000):null,
    id
   ]
  );
 });

 return true;
});

ipcMain.handle('discounted:prepare',(_,payload)=>{
 if(!payload||!payload.deviceId||!payload.shiftId||!payload.locationId||!payload.promotionCode||
 !Array.isArray(payload.lines)||!payload.lines.length||!Array.isArray(payload.tenders)||!payload.tenders.length)throw Error('Invalid discounted checkout');
 const id=crypto.randomUUID();
 const saved={...payload,localSaleId:id};
 db.run('INSERT INTO discount_attempts(id,payload,status,created_at,server_response,error) VALUES (?,?,?,?,?,?)',
 [id,JSON.stringify(saved),'PREPARED',new Date().toISOString(),null,null]);persist();
 return {id,payload:saved};
});
ipcMain.handle('discounted:list',()=>rows('SELECT * FROM discount_attempts ORDER BY created_at DESC LIMIT 100'));
ipcMain.handle('discounted:update',(_,id,status,response,error)=>{
 if(!['PREPARED','UNKNOWN','ACCEPTED','REJECTED'].includes(status))throw Error('Invalid discounted status');
 const existing=rows('SELECT status FROM discount_attempts WHERE id=?',[id])[0];
 if(!existing)throw Error('Unknown attempt');
 if(existing.status==='ACCEPTED'&&status!=='ACCEPTED')throw Error('Accepted checkout cannot be downgraded');
 db.run('UPDATE discount_attempts SET status=?,server_response=?,error=? WHERE id=?',
 [status,response?JSON.stringify(response):null,error||null,id]);persist();return true;
});
/* R8_01G_4B5B2_CLEARANCE_RECEIPT */
ipcMain.handle('clearance:receipt',async(_,id)=>{
 const attempt=rows(
  'SELECT * FROM clearance_attempts WHERE id=?',
  [id]
 )[0];

 if(
  !attempt||
  attempt.status!=='ACCEPTED'||
  !attempt.server_response
 ){
  throw Error('Server-accepted clearance sale required');
 }

 const result=JSON.parse(attempt.server_response);

 if(
  result.found!==true||
  result.clearanceSale!==true||
  result.status!=='ACCEPTED'||
  result.paymentState!=='SALE_RECORDED'||
  result.integrity?.allocationValid!==true||
  !result.receipt
 ){
  throw Error('Verified clearance receipt unavailable');
 }

 const esc=value=>String(value??'').replace(
  /[&<>"']/g,
  c=>({
   '&':'&amp;',
   '<':'&lt;',
   '>':'&gt;',
   '"':'&quot;',
   "'":'&#39;'
  }[c])
 );

 const catalog=new Map(
  rows('SELECT * FROM catalog').map(v=>[v.id,v])
 );

 const receipt=result.receipt;

 const lineRows=receipt.lines.map(line=>{
  const product=catalog.get(line.variantId)||{};

  return `
   <tr>
    <td>
     ${esc(product.title||line.variantId)}
     <br>${esc(product.sku||'')}
     <br>${esc(line.clearanceCampaign?.code||'Standard')}
    </td>
    <td>${esc(line.quantity)}</td>
    <td>${esc(line.gross)}</td>
    <td>-${esc(line.discount)}</td>
    <td>${esc(line.net)}</td>
   </tr>
  `;
 }).join('');

 const tenders=receipt.tenders.map(t=>
  `<p>${esc(t.type)}: Rs ${esc(t.amount)}</p>`
 ).join('');

 const html=`
 <!doctype html>
 <html>
 <head>
 <meta charset="utf-8">
 <style>
 body{font:12px monospace;width:76mm;margin:4mm}
 table{width:100%;border-collapse:collapse}
 td,th{padding:4px 2px;border-bottom:1px dashed #aaa}
 h2{text-align:center}
 .total{font-size:16px;font-weight:bold}
 </style>
 </head>
 <body>
 <h2>ROYAL STEP</h2>
 <p>CLEARANCE SALE RECEIPT</p>
 <p>Transaction: ${esc(attempt.id)}</p>
 <p>Central sale: ${esc(result.id)}</p>
 <p>Recorded: ${esc(result.soldAt)}</p>
 <hr>
 <table>
 <thead>
 <tr>
 <th>Item</th><th>Qty</th>
 <th>Gross</th><th>Disc</th><th>Net</th>
 </tr>
 </thead>
 <tbody>${lineRows}</tbody>
 </table>
 <p>Subtotal: Rs ${esc(receipt.subtotal)}</p>
 <p>Clearance discount: Rs ${esc(receipt.discount)}</p>
 <p class="total">TOTAL: Rs ${esc(receipt.total)}</p>
 <hr>
 ${tenders}
 <p>Thank you for shopping at Royal Step.</p>
 </body>
 </html>`;

 const win=new BrowserWindow({
  show:false,
  webPreferences:{
   sandbox:true,
   nodeIntegration:false
  }
 });

 try{
  await win.loadURL(
   'data:text/html;charset=utf-8,'+
   encodeURIComponent(html)
  );

  return await new Promise(resolve=>
   win.webContents.print(
    {silent:false,printBackground:false},
    (success,reason)=>resolve({success,reason})
   )
  );
 }finally{
  if(!win.isDestroyed())win.close();
 }
});
ipcMain.handle('discounted:receipt',async(_,id)=>{
 const a=rows('SELECT * FROM discount_attempts WHERE id=?',[id])[0];
 if(!a||a.status!=='ACCEPTED'||!a.server_response)throw Error('Only server-accepted discounted sales can be printed');
 const p=JSON.parse(a.payload),r=JSON.parse(a.server_response);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\"':'&quot;',"'":'&#39;'}[c]));
 const catalog=new Map(rows('SELECT * FROM catalog').map(x=>[x.id,x]));
 const subtotal=p.lines.reduce((n,l)=>n+Math.round(l.unitPrice*100)*l.quantity,0)/100;
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false}});
 const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{font:13px monospace;width:76mm;margin:5mm}table{width:100%}td{padding:4px 0;border-bottom:1px dashed #bbb}h2{text-align:center}</style></head><body><h2>ROYAL STEP</h2><p>Receipt: ${esc(id)}<br>Central sale: ${esc(r.id)}<br>Accepted: ${esc(a.created_at)}<br>Status: ACCEPTED</p><table>${p.lines.map(l=>{const v=catalog.get(l.variantId)||{};return `<tr><td>${esc(v.title||l.variantId)}<br>${esc(v.sku||'')}</td><td>${esc(l.quantity)} ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${esc(l.unitPrice)}</td></tr>`}).join('')}</table><p>Subtotal: Rs ${esc(subtotal.toFixed(2))}<br>Promotion: ${esc(p.promotionCode)}<br>Discount: Rs ${esc(r.discount)}<br><strong>PAID TOTAL: Rs ${esc(r.total)}</strong></p><p>${p.tenders.map(t=>esc(t.type)+': Rs '+esc(t.amount)).join('<br>')}</p><p>Thank you for shopping at Royal Step.</p><hr><p style="text-align:center;font-size:10px">Software by 7Solutions<br>03313621464</p></body></html>`;
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
 return new Promise(resolve=>win.webContents.print({silent:false,printBackground:false},(success,reason)=>{win.close();resolve({success,reason})}));
});
ipcMain.handle('sales:list',()=>rows('SELECT id,status,created_at,error,payload FROM sales ORDER BY created_at DESC LIMIT 100'));ipcMain.handle('sales:pending',()=>rows('SELECT s.id,s.payload,o.attempts FROM sales s JOIN outbox o ON o.sale_id=s.id ORDER BY s.created_at ASC'));ipcMain.handle('sales:result',(_,id,status,error)=>{
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
});window();});app.on('window-all-closed',()=>{app.quit();});
