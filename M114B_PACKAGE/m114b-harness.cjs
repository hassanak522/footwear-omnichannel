'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),Module=require('node:module');
const [source,sqlModule,report]=process.argv.slice(2);
if(!source||!sqlModule||!report)throw Error('Expected source, sqlModule, report');
const userData=path.join(report,'isolated-electron-userdata');fs.mkdirSync(userData,{recursive:true});
const log=[];const check=(name,condition,detail)=>{log.push({name,result:condition?'PASS':'FAIL',detail});console.log(`${condition?'PASS':'FAIL'} ${name}${detail?' - '+detail:''}`)};
const makePayload=()=>({deviceId:crypto.randomUUID(),shiftId:crypto.randomUUID(),lines:[{variantId:crypto.randomUUID(),quantity:1,unitPrice:100}],tenders:[{type:'CASH',amount:100}]});
async function launch(){
 const handlers=new Map();const app={getPath:(k)=>{if(k!=='userData')throw Error('Unexpected path '+k);return userData},isPackaged:false,whenReady:()=>Promise.resolve(),on:()=>{}};
 const webContents={setWindowOpenHandler:()=>{},on:()=>{},getURL:()=>'',print:(_opts,cb)=>cb(true,'')};
 class BrowserWindow{constructor(){this.webContents=webContents}loadURL(){return Promise.resolve()}loadFile(){return Promise.resolve()}close(){}}
 const electron={app,BrowserWindow,ipcMain:{handle:(k,fn)=>handlers.set(k,fn)},session:{defaultSession:{webRequest:{onHeadersReceived:()=>{}}}}};
 const req=Module.createRequire(source);const sqlRequire=Module.createRequire(path.join(sqlModule,'package.json'));
 const customRequire=(name)=>name==='electron'?electron:name==='sql.js'?sqlRequire('sql.js'):req(name);
 customRequire.resolve=(name)=>name.startsWith('sql.js/')?sqlRequire.resolve(name):req.resolve(name);
 // Source dynamic import('sql.js') resolves from the original source path. Verify package is available there.
 const oldLoad=Module._load;Module._load=function(request,parent,isMain){if(request==='electron')return electron;return oldLoad.call(this,request,parent,isMain)};
 try{delete require.cache[require.resolve(source)];require(source);await new Promise(r=>setTimeout(r,1500));if(!handlers.has('sales:save'))throw Error('Electron initialization failed; check sql.js install and source.');return {call:(name,...args)=>{const fn=handlers.get(name);if(!fn)throw Error('Missing IPC '+name);return fn({},...args)},handlers};}finally{Module._load=oldLoad}
}
(async()=>{
 let ipc=await launch();const payload=makePayload();const id=await ipc.call('sales:save',payload);
 check('SAVE_UUID',/^[0-9a-f-]{36}$/.test(id));
 let pending=await ipc.call('sales:pending');check('OUTBOX_INSERT',pending.length===1&&pending[0].id===id);
 check('DISK_FILE_EXISTS',fs.existsSync(path.join(userData,'pos.sqlite')));
 // Restart simulated by re-evaluating the Electron entry point with the same isolated userData.
 ipc=await launch();pending=await ipc.call('sales:pending');check('RESTART_PRESERVES_PENDING',pending.length===1&&pending[0].id===id);
 await ipc.call('sales:result',id,'PENDING','simulated network outage');
 pending=await ipc.call('sales:pending');check('NETWORK_FAILURE_PRESERVES_OUTBOX',pending.length===1&&pending[0].attempts===1);
 ipc=await launch();pending=await ipc.call('sales:pending');check('RESTART_PRESERVES_RETRY',pending.length===1&&pending[0].attempts===1);
 await ipc.call('sales:result',id,'ACCEPTED');pending=await ipc.call('sales:pending');check('ACCEPTED_REMOVES_OUTBOX',pending.length===0);
 const history=await ipc.call('sales:list');check('ACCEPTED_PRESERVED_IN_HISTORY',history.some(x=>x.id===id&&x.status==='ACCEPTED'));
 // Negative tests on isolated storage only.
 let unknownAllowed=false;try{await ipc.call('sales:result',crypto.randomUUID(),'ACCEPTED');unknownAllowed=true}catch{}
 check('UNKNOWN_RESULT_REJECTED',!unknownAllowed,unknownAllowed?'DEFECT: unknown ID silently accepted':'rejected');
 let downgradeAllowed=false;try{await ipc.call('sales:result',id,'PENDING','late response');downgradeAllowed=true}catch{}
 check('TERMINAL_DOWNGRADE_REJECTED',!downgradeAllowed,downgradeAllowed?'DEFECT: ACCEPTED can be reverted to PENDING':'rejected');
 const after=await ipc.call('sales:pending');check('NO_REQUEUE_AFTER_ACCEPTANCE',after.length===0,after.length?'DEFECT: accepted sale requeued':'not requeued');
 const summary={scope:'LOCAL_ONLY',operationalDatabaseTouched:false,isolatedUserData:userData,checks:log,passed:log.filter(x=>x.result==='PASS').length,failed:log.filter(x=>x.result==='FAIL').length};
 fs.writeFileSync(path.join(report,'summary.json'),JSON.stringify(summary,null,2));
 console.log(`RESULT: ${summary.passed} passed, ${summary.failed} failed. Known defects are expected in this baseline audit.`);
 // Expected negative findings should not prevent saving report.
})().catch(e=>{console.error(e.stack||e);fs.writeFileSync(path.join(report,'fatal-error.txt'),String(e.stack||e));process.exitCode=1});
