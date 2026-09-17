// Read-only diagnosis using the account already saved by Mesima on this PC.
// Credentials and document contents stay in memory and are never logged.
const {app,net,safeStorage,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const probeDir=path.join(root,'test-results','sync-diagnostic-session');
fs.mkdirSync(probeDir,{recursive:true});
// Chromium's protected encryption key is profile-specific. Use a disposable copy;
// the original application profile is never opened or written by this process.
const localState=path.join(app.getPath('appData'),'Mesima','Local State');
if(fs.existsSync(localState))fs.copyFileSync(localState,path.join(probeDir,'Local State'));
app.setPath('userData',probeDir);
app.whenReady().then(async()=>{
 let win,browser,page,stage='configuration';
 try{
  const config=JSON.parse(fs.readFileSync(path.join(root,'desktop/firebase-config.json'),'utf8'));
  const saved=path.join(app.getPath('appData'),'Mesima','account.bin');
  if(!fs.existsSync(saved)){console.log(JSON.stringify({accountAvailable:false}));return;}
  stage='saved-session';const account=JSON.parse(safeStorage.decryptString(fs.readFileSync(saved)));
  let token=account.token;
  if(account.expires<Date.now()+60000){stage='refresh';
   const r=await net.fetch('https://securetoken.googleapis.com/v1/token?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:account.refresh}),signal:AbortSignal.timeout(20000)});
   if(!r.ok){console.log(JSON.stringify({stage:'session-refresh',status:r.status}));return;}
   token=(await r.json()).id_token;
  }
  stage='browser-origin';protocol.handle('https',req=>req.url==='https://appassets.androidplatform.net/diagnostic/'?new Response('<!doctype html><title>Connection check</title>'):net.fetch(req,{bypassCustomProtocolHandlers:true}));
  win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadURL('https://appassets.androidplatform.net/diagnostic/');
  const {chromium}=await import(require('node:url').pathToFileURL(process.env.MESIMA_PLAYWRIGHT).href);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  page=await browser.newPage();await page.route('https://appassets.androidplatform.net/diagnostic/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Connection check</title>'}));await page.goto('https://appassets.androidplatform.net/diagnostic/');
  const doc=`https://firestore.googleapis.com/v1/projects/${config.project}/databases/(default)/documents/users/${account.uid}/sync/state`;
  let objectPath;
  async function check(label,url,authorization){
   stage=label+'-native';const r=await net.fetch(url,{headers:{Authorization:authorization},bypassCustomProtocolHandlers:true,signal:AbortSignal.timeout(20000)});
   const result={stage:label,nativeStatus:r.status,allowOrigin:r.headers.get('access-control-allow-origin')};
   if(label==='firestore'&&r.ok)objectPath=(await r.json()).fields?.path?.stringValue;
   else await r.arrayBuffer();
   stage=label+'-browser';result.browser=await win.webContents.executeJavaScript(`(async()=>{try{const r=await fetch(${JSON.stringify(url)},{headers:{Authorization:${JSON.stringify(authorization)}},signal:AbortSignal.timeout(20000)});await r.arrayBuffer();return {status:r.status};}catch(e){return {error:e.name+': '+e.message};}})()`);
   result.chrome=await page.evaluate(async({url,authorization})=>{try{const r=await fetch(url,{headers:{Authorization:authorization},signal:AbortSignal.timeout(20000)});await r.arrayBuffer();return {status:r.status};}catch(e){return {error:e.name+': '+e.message};}},{url,authorization});
   console.log(JSON.stringify(result));
  }
  await check('firestore',doc,'Bearer '+token);
  if(typeof objectPath==='string'&&objectPath.startsWith('users/'+account.uid+'/sync/')){
   const url=`https://firebasestorage.googleapis.com/v0/b/${config.bucket}/o/${encodeURIComponent(objectPath)}?alt=media`;
   stage='storage-http1';
   try{const r=await fetch(url,{headers:{Authorization:'Firebase '+token},signal:AbortSignal.timeout(20000)});const body=await r.arrayBuffer();console.log(JSON.stringify({stage,nativeStatus:r.status,bytes:body.byteLength,allowOrigin:r.headers.get('access-control-allow-origin')}));}
   catch(e){console.log(JSON.stringify({stage,code:e.cause?.code||e.name}));}
   await check('storage-download',url,'Firebase '+token);
   const repaired=await require('../desktop/sync-http.cjs').send({url,method:'GET',expectedUid:account.uid},async()=>({uid:account.uid,token,project:config.project,bucket:config.bucket}),(address,options)=>net.fetch(address,{...options,bypassCustomProtocolHandlers:true}));
   console.log(JSON.stringify({stage:'repaired-sync-transport',status:repaired.status,error:repaired.error,bytes:repaired.body?Buffer.byteLength(repaired.body):0}));
   if(repaired.status!==200||JSON.parse(repaired.body).schema!==1)throw Error('Repaired transport check failed');
  }
  else console.log(JSON.stringify({stage:'storage-download',skipped:'No current sync snapshot'}));
 }catch(e){console.log(JSON.stringify({stage,diagnosticError:e.code||e.name||'Error',networkCode:String(e.message).match(/net::ERR_[A-Z_]+/)?.[0]||'unclassified'}));process.exitCode=1;}
 finally{await browser?.close();win?.destroy();app.quit();}
});
