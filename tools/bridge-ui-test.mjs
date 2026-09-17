import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.MESIMA_PLAYWRIGHT?pathToFileURL(process.env.MESIMA_PLAYWRIGHT):'playwright');
const html=fs.readFileSync(path.join(root,'index.html'));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.MESIMA_CHROME?{executablePath:process.env.MESIMA_CHROME}:{})});
const page=await browser.newPage({viewport:{width:412,height:915}});page.setDefaultTimeout(5000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  window.__calls=[];window.__snapshots=[];
  const state={folder:false,days:0,lastLocal:0,error:'',cloud:{configured:true,email:'',busy:false,message:''}};
  const update=()=>window.dispatchEvent(new Event('backup-status'));
  const api={version:()=> '1.2',status:()=>JSON.stringify({native:true,sdk:35}),
    backupStatus:()=>JSON.stringify(state),
    saveSnapshot:text=>{window.__snapshots.push(JSON.parse(text));return true;},
    chooseBackupFolder:()=>{state.folder=true;window.__calls.push('folder');update();},
    configureBackup:days=>{state.days=days;window.__calls.push(['days',days]);update();},
    backupNow:()=>{state.lastLocal=Date.now();window.__calls.push('backup');update();},
    cloudSignIn:(email,password,create)=>{state.cloud.email=email;window.__calls.push(['login',create]);update();},
    cloudBackup:()=>{window.__calls.push('cloud');state.cloud.lastBackup=Date.now();update();},
    cloudList:()=>setTimeout(()=>window.__cloudBackups([{id:'11111111-1111-1111-1111-111111111111',createdAt:Date.now(),taskCount:0}]),0),
    cloudRestore:()=>setTimeout(()=>window.__import(JSON.stringify({v:10,tasks:[],events:[],notes:[]})),0),
    cloudSignOut:()=>{state.cloud.email='';update();}
  };
  window.MesimaNative=new Proxy(api,{get:(target,key)=>target[key]||(()=>{})});
});
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>{Engine.stop();Store.addTask({title:'keep local',kind:'short',mission:'army'});UI.screen='settings';UI.render();});
  await page.locator('[data-settings-page="data"]').click();
  await page.locator('[data-settings-page="auto"]').click();
  await page.locator('[data-care="folder"]').click();await page.locator('#backupDays').selectOption('7');
  await page.evaluate(()=>Settings.open('data'));
  await page.locator('[data-care="now"]').click();
  const calls=await page.evaluate(()=>window.__calls);
  assert.ok(calls.includes('folder'));assert.ok(calls.some(x=>Array.isArray(x)&&x[0]==='days'&&x[1]===7));assert.ok(calls.includes('backup'));
  assert.ok(await page.evaluate(()=>window.__snapshots.at(-1).tasks.some(t=>t.title==='keep local')));
  console.log('PASS native backup controls and current-data snapshot bridge (mock)');
  await page.evaluate(()=>Settings.open('cloud'));
  await page.locator('[data-care="login"]').click();await page.locator('#cloudEmail').fill('test@example.invalid');
  await page.locator('#cloudPassword').fill('synthetic-password-only');
  await page.locator('#mFoot').getByRole('button',{name:'היכנס',exact:true}).click();
  assert.ok(!(await page.evaluate(()=>JSON.stringify(window.__snapshots))).includes('synthetic-password-only'));
  await page.evaluate(()=>Settings.open('data'));
  await page.locator('[data-care="now"]').click();
  assert.ok((await page.evaluate(()=>window.__calls)).includes('cloud'));
  console.log('PASS cloud login and backup controls; password excluded from backups (mock)');
  await page.evaluate(()=>Settings.open('cloud'));
  await page.locator('[data-care="cloud-list"]').click();await page.locator('[data-cloud-restore]').click();
  await page.locator('#mFoot').getByRole('button',{name:'ביטול',exact:true}).click();
  assert.equal(await page.evaluate(()=>Store.all.tasks.length),1);
  await page.locator('[data-care="cloud-list"]').click();await page.locator('[data-cloud-restore]').click();
  await page.locator('#mFoot').getByRole('button',{name:'שחזר',exact:true}).click();
  assert.equal(await page.evaluate(()=>Store.all.tasks.length),0);
  console.log('PASS downloaded backup cannot replace data before confirmation (mock)');
  assert.equal(errors.length,0,errors.join('\n'));
} finally {await browser.close();await new Promise(r=>server.close(r));}
