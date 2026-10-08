const {app,BrowserWindow,ipcMain,protocol,net,dialog,shell,Menu,Tray,Notification,nativeImage,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {MAX_BYTES,validateSnapshot:validate,readBoundedText,loadConfig,commitBackup}=require('./backup-utils.cjs');
const ROOT=path.join(__dirname,'app'),config=loadConfig(path.join(__dirname,'firebase-config.json'));
protocol.registerSchemesAsPrivileged([{scheme:'mesima',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
app.setName('Mesima');app.setPath('userData',process.env.MESIMA_TEST_DATA||path.join(app.getPath('appData'),'Mesima'));
const DATA=app.getPath('userData');fs.mkdirSync(DATA,{recursive:true});
const read=(name,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(DATA,name),'utf8'));}catch{return fallback;}};
const write=(name,value)=>{const p=path.join(DATA,name),temp=p+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,p);};
let settings=read('settings.json',{days:0,folder:'',lastLocal:0}),alarms=read('alarms.json',[]),snoozes=read('snoozes.json',[]);
let win,tray,quitting=false,account=null,cloud={configured:!!config,email:'',busy:false,message:'',lastBackup:settings.lastCloud||0};
const status=()=>({...settings,cloud});
const publish=()=>win?.webContents.send('backup-status',status());
async function request(url,options={}){const r=await net.fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});if(!r.ok){const err=await readBoundedText(r,65536).then(JSON.parse).catch(()=>({}));const error=Error(err.error?.message||'שגיאת חיבור '+r.status);error.status=r.status;throw error;}return r;}
function persistAuth(){if(!safeStorage.isEncryptionAvailable())throw Error('Windows אינו מאפשר שמירה מוגנת של החשבון');fs.writeFileSync(path.join(DATA,'account.bin'),safeStorage.encryptString(JSON.stringify(account)));}
async function credentials(){
  if(!config||!account)return null;
  if(account.expires<Date.now()+60000){
    const j=await(await request('https://securetoken.googleapis.com/v1/token?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:account.refresh})})).json();
    account={...account,token:j.id_token,refresh:j.refresh_token,expires:Date.now()+Number(j.expires_in)*1000};persistAuth();
  }return {token:account.token,uid:account.uid,project:config.project,bucket:config.bucket};
}
async function authorized(url,options={}){const c=await credentials();if(!c)throw Error('צריך להיכנס לחשבון');const scheme=new URL(url).hostname==='firebasestorage.googleapis.com'?'Firebase ':'Bearer ';return request(url,{...options,headers:{Authorization:scheme+c.token,...options.headers}});}
const docBase=()=>`https://firestore.googleapis.com/v1/projects/${config.project}/databases/(default)/documents/users/${account.uid}/backups`;
const storage=p=>`https://firebasestorage.googleapis.com/v0/b/${config.bucket}/o/${encodeURIComponent(p)}`;
const unfield=v=>v.stringValue??(v.integerValue!==undefined?Number(v.integerValue):v.booleanValue);
async function backup(){
  if(!await credentials())throw Error('צריך להיכנס לחשבון');
  const text=fs.readFileSync(path.join(DATA,'snapshot.json'),'utf8'),data=validate(text),id=crypto.randomUUID(),p=`users/${account.uid}/backups/${id}.json`,bytes=Buffer.from(text);
  const boundary=crypto.randomUUID(),body=`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({name:p,contentType:'application/json'})}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  const meta={createdAt:Date.now(),path:p,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),taskCount:data.tasks.length,appVersion:app.getVersion(),schema:data.v||5};
  const fields=Object.fromEntries(Object.entries(meta).map(([k,v])=>[k,typeof v==='number'?{integerValue:String(v)}:{stringValue:v}]));
  await commitBackup({
    upload:()=>authorized(`https://firebasestorage.googleapis.com/v0/b/${config.bucket}/o?name=${encodeURIComponent(p)}`,{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary,'X-Goog-Upload-Protocol':'multipart'},body}),
    commit:()=>authorized(docBase()+'?documentId='+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})}),
    isCommitted:async()=>{try{const saved=await(await authorized(docBase()+'/'+id)).json();if(saved.fields?.path?.stringValue===p&&saved.fields?.sha256?.stringValue===meta.sha256)return true;throw Error('רישום גיבוי שונה מהצפוי');}catch(error){if(error.status===404)return false;throw error;}},
    remove:()=>authorized(storage(p),{method:'DELETE'})
  });
  cloud.lastBackup=meta.createdAt;settings.lastCloud=meta.createdAt;write('settings.json',settings);return 'הגיבוי נשמר בענן';
}
async function localBackup(){
  if(!settings.folder)throw Error('בחר תיקיית גיבוי');const text=fs.readFileSync(path.join(DATA,'snapshot.json'),'utf8');validate(text);
  const name='Mesima_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomUUID().slice(0,8)+'.json';
  fs.writeFileSync(path.join(settings.folder,name),text,{flag:'wx'});settings.lastLocal=Date.now();settings.error='';write('settings.json',settings);publish();
}
async function cloudAction(action,args){
  if(cloud.busy)return;cloud.busy=true;cloud.message='';publish();
  try{
    if(action!=='logout'&&!config)throw Error('גיבוי וסנכרון בענן אינם מוגדרים בבנייה זו');
    if(action==='login'){
      const [email,password,create]=args;
      const j=await(await request(`https://identitytoolkit.googleapis.com/v1/accounts:${create?'signUp':'signInWithPassword'}?key=${config.apiKey}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})})).json();
      account={uid:j.localId,email:j.email,token:j.idToken,refresh:j.refreshToken,expires:Date.now()+Number(j.expiresIn)*1000};persistAuth();cloud.email=account.email;cloud.message='החשבון מחובר';
    }else if(action==='logout'){account=null;cloud.email='';fs.rmSync(path.join(DATA,'account.bin'),{force:true});}
    else if(action==='backup')cloud.message=await backup();
    else if(action==='list'){
      const c=await credentials();if(!c)throw Error('צריך להיכנס לחשבון');
      const parent=`https://firestore.googleapis.com/v1/projects/${config.project}/databases/(default)/documents/users/${account.uid}:runQuery`;
      const j=await(await authorized(parent,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:'backups'}],orderBy:[{field:{fieldPath:'createdAt'},direction:'DESCENDING'}],limit:50}})})).json();
      win.webContents.send('cloud-list',j.filter(x=>x.document).map(x=>({id:x.document.name.split('/').pop(),...Object.fromEntries(Object.entries(x.document.fields).map(([k,v])=>[k,unfield(v)]))})));
    }else if(action==='restore'){
      if(!/^[0-9a-f-]{36}$/i.test(args[0]))throw Error('מזהה לא תקין');
      const j=await(await authorized(docBase()+'/'+args[0])).json();const meta=Object.fromEntries(Object.entries(j.fields).map(([k,v])=>[k,unfield(v)]));
      if(meta.path!==`users/${account.uid}/backups/${args[0]}.json`)throw Error('נתיב לא תקין');
      const text=await readBoundedText(await authorized(storage(meta.path)+'?alt=media'));validate(text);
      if(Buffer.byteLength(text,'utf8')!==meta.bytes)throw Error('גודל הגיבוי אינו תואם לרישום');
      if(crypto.createHash('sha256').update(text).digest('hex')!==meta.sha256)throw Error('בדיקת שלמות נכשלה');win.webContents.send('cloud-restore',text);
    }
  }catch(e){cloud.message=e.message;}
  finally{cloud.busy=false;publish();}
}
function show(){if(!win)return;if(win.isMinimized())win.restore();win.show();win.focus();}
const {blocked,reconcileAlarms}=require('./reminder-state.cjs');
let reminderState=read('reminder-state.json',null);const shown=new Map();
function notify(a){
  if(blocked(reminderState,a))return;
  if(!Notification.isSupported())return;
  const n=new Notification({title:a.title,body:a.body});shown.set(a.id,{notification:n,meta:a});n.on('close',()=>shown.delete(a.id));
  n.on('click',()=>{show();win.webContents.send('reminder',a);});n.show();
}
let lastScheduleRefresh=0,lastBackupAttempt=0;
function tick(){
  const now=Date.now();let changed=false;
  for(const list of [alarms,snoozes])for(const a of list)if(!a.fired&&a.at<=now){a.fired=true;changed=true;if(now-a.at<86400000)notify(a);}
  if(changed){write('alarms.json',alarms);write('snoozes.json',snoozes);}
  if(now-lastScheduleRefresh>=60000){lastScheduleRefresh=now;win?.webContents.send('schedule-refresh');}
  if(settings.days&&settings.folder&&now-settings.lastLocal>=settings.days*86400000&&now-lastBackupAttempt>=300000){lastBackupAttempt=now;localBackup().catch(e=>{settings.error=e.message;write('settings.json',settings);publish();});}
}
function trusted(e){return e.sender===win?.webContents&&e.senderFrame?.url.startsWith('mesima://app/');}
function handle(channel,fn){ipcMain.handle(channel,(e,...args)=>{if(!trusted(e))throw Error('Untrusted sender');return fn(...args);});}
app.on('second-instance',show);
if(!app.requestSingleInstanceLock()){app.quit();}else app.whenReady().then(()=>{
  app.setAppUserModelId('il.mesima.desktop');
  try{if(config&&safeStorage.isEncryptionAvailable())account=JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(DATA,'account.bin'))));}catch{}
  cloud.email=account?.email||'';
  protocol.handle('mesima',req=>{
    const u=new URL(req.url);if(u.host!=='app'||u.pathname!=='/index.html')return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(path.join(ROOT,'index.html')).toString());
  });
  win=new BrowserWindow({width:1200,height:850,minWidth:760,minHeight:600,show:!process.env.MESIMA_TEST_DATA,backgroundColor:'#14171c',title:'משימה',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(e,url)=>{if(url!=='mesima://app/index.html'){e.preventDefault();if(/^https?:\/\//.test(url))shell.openExternal(url);}});
  win.webContents.session.setPermissionRequestHandler((_wc,p,cb)=>cb(p==='notifications'));
  win.on('close',e=>{if(!quitting){e.preventDefault();win.hide();}});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'משימה',submenu:[{label:'הצג',click:show},{label:'יציאה',accelerator:'CmdOrCtrl+Q',click:()=>{quitting=true;app.quit();}}]},{label:'עריכה',submenu:[{role:'undo'},{role:'redo'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'תצוגה',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]}]));
  const icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIElEQVQ4T2NkYPj/n4ECwESJ5lEDRg0YNWDUgFEDBgYAAGInHwHjygNtAAAAAElFTkSuQmCC');
  tray=new Tray(icon);tray.setToolTip('משימה');tray.setContextMenu(Menu.buildFromTemplate([{label:'פתח משימה',click:show},{label:'יציאה',click:()=>{quitting=true;app.quit();}}]));tray.on('click',show);
  ipcMain.on('backup-initial',(e)=>{e.returnValue=trusted(e)?status():{};});
  handle('search-places',async address=>{
    const u=new URL(address),allowed={'nominatim.openstreetmap.org':'/search','photon.komoot.io':'/api/','overpass-api.de':'/api/interpreter'};
    if(u.protocol!=='https:'||u.port||allowed[u.hostname]!==u.pathname||address.length>8000)throw Error('Invalid search request');
    const r=await net.fetch(address,{headers:{'User-Agent':'Mesima/4.7 Desktop'},signal:AbortSignal.timeout(14000),redirect:'error'});
    if(!r.ok)throw Error('שירות החיפוש לא זמין ('+r.status+')');return JSON.parse(await readBoundedText(r,2000000));
  });
  handle('credentials',credentials);
  handle('sync-request',input=>require('./sync-http.cjs').send(input,credentials,(url,options)=>net.fetch(url,options)));
  handle('snapshot',text=>{try{validate(text);fs.writeFileSync(path.join(DATA,'snapshot.json.tmp'),text);fs.renameSync(path.join(DATA,'snapshot.json.tmp'),path.join(DATA,'snapshot.json'));return true;}catch(error){settings.error=error.message;publish();throw error;}});
  handle('choose-folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory','createDirectory']});if(!r.canceled){settings.folder=r.filePaths[0];write('settings.json',settings);}publish();});
  handle('configure',days=>{if(![0,1,7,30].includes(days))throw Error('תדירות לא תקינה');settings.days=days;write('settings.json',settings);publish();});
  handle('backup-local',()=>localBackup().catch(e=>{settings.error=e.message;publish();}));
  handle('cloud',cloudAction);
  handle('save',async(name,text)=>{if(typeof text!=='string'||Buffer.byteLength(text)>MAX_BYTES)throw Error('קובץ גדול מדי');const r=await dialog.showSaveDialog(win,{defaultPath:path.basename(name)});if(!r.canceled)fs.writeFileSync(r.filePath,text);});
  handle('schedule',(list,state)=>{if(state?.schema===1&&Array.isArray(state.tasks)){reminderState=state;write('reminder-state.json',state);snoozes=snoozes.filter(a=>!blocked(state,a));write('snoozes.json',snoozes);for(const [id,x] of shown)if(blocked(state,x.meta)){x.notification.close();shown.delete(id);}}if(!Array.isArray(list)||list.length>10000||Buffer.byteLength(JSON.stringify(list),'utf8')>MAX_BYTES)throw Error('תזכורות לא תקינות');alarms=reconcileAlarms(list,alarms);write('alarms.json',alarms);});
  handle('snooze',a=>{if(typeof a?.id!=='string'||blocked(reminderState,a))return false;const next=snoozes.filter(x=>x.id!==a.id);next.push({...a,at:Date.now()+900000,fired:false});write('snoozes.json',next);snoozes=next;return true;});
  handle('open-data',()=>shell.openPath(DATA));
  win.loadURL('mesima://app/index.html');setInterval(tick,15000);
});
app.on('before-quit',()=>{quitting=true;});
