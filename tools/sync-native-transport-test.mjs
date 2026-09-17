import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import transport from '../desktop/sync-http.cjs';
const {chromium}=await import(pathToFileURL(process.env.MESIMA_PLAYWRIGHT));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html'));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.MESIMA_CHROME});const objects=new Map(),errors=[],calls={android:0,desktop:0};
let pointer=null,version=0,writes=0,conflict=false,networkFailure=false,denied=false;
const credentials={uid:'testuser',token:'synthetic',project:'test-project',bucket:'test-bucket'};
async function cloud(url,options){
 if(networkFailure)throw Error('connection unavailable');
 const u=new URL(url),r=new Request(url,options);const reply=(status,value)=>new Response(typeof value==='string'?value:JSON.stringify(value),{status});
 if(denied)return reply(403,{});
 assert.equal(r.headers.get('authorization'),(u.hostname==='firebasestorage.googleapis.com'?'Firebase ':'Bearer ')+'synthetic');
 if(u.hostname==='firestore.googleapis.com'){
  if(r.method==='GET')return pointer?reply(200,{fields:{path:{stringValue:pointer},schema:{integerValue:'1'}},updateTime:String(version)}):reply(404,{});
  if(r.method==='PATCH'){if(conflict){conflict=false;return reply(409,{});}const expected=u.searchParams.get('currentDocument.updateTime');if(pointer&&expected!==String(version))return reply(412,{});pointer=(await r.json()).fields.path.stringValue;version++;writes++;return reply(200,{});}
 }else{
  if(r.method==='POST'){
   const boundary=r.headers.get('content-type').split('boundary=')[1],parts=(await r.text()).split('--'+boundary),meta=JSON.parse(parts[1].split('\r\n\r\n')[1].trim());
   assert.equal(meta.name,u.searchParams.get('name'));assert.equal(meta.contentType,'application/json');
   objects.set(meta.name,parts[2].slice(parts[2].indexOf('\r\n\r\n')+4).replace(/\r\n$/,''));return reply(200,{});
  }
  if(u.searchParams.has('prefix'))return reply(200,{items:[]});
  const name=decodeURIComponent(u.pathname.split('/o/')[1]||'');if(r.method==='DELETE'){objects.delete(name);return reply(200,{});}return objects.has(name)?reply(200,objects.get(name)):reply(404,{});
 }return reply(400,{});
}
async function device(kind){
 const ctx=await browser.newContext();await ctx.exposeBinding('nativeHttp',(_source,input)=>{calls[kind]++;return transport.send(input,async()=>credentials,cloud);});
 await ctx.addInitScript(({kind,c})=>{
  // Reproduce the broken renderer network path: the repaired sync must not use it.
  window.fetch=()=>{throw TypeError('Failed to fetch');};
  if(kind==='android')window.MesimaNative={version:()=> '1.6',status:()=> '{}',syncCredentials:()=>window.__syncCredentials(c),syncRequest:(id,text)=>window.nativeHttp(JSON.parse(text)).then(result=>window.__syncResponse(id,result))};
  else {const noop=()=>{};window.MesimaDesktop={credentials:async()=>c,syncRequest:input=>window.nativeHttp(input),status:()=>({cloud:{configured:true,email:'test@example.invalid'},days:0}),snapshot:noop,schedule:noop,onStatus:noop,onList:noop,onRestore:noop,onOpen:noop,onReminder:noop};}
 },{kind,c:credentials});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(`http://127.0.0.1:${server.address().port}`);await p.evaluate(()=>{Engine.stop();Store.setPref('syncEnabled',false);});return p;
}
const sync=p=>p.evaluate(async()=>{Store.setPref('syncEnabled',true);await CloudSync.run();Store.setPref('syncEnabled',false);return CloudSync.info();});
try{
 const phone=await device('android'),pc=await device('desktop');const id=await phone.evaluate(()=>Store.addTask({title:'shared',note:'original',kind:'short'}).id);
 assert.equal((await sync(phone)).message,'מסונכרן');assert.equal((await sync(pc)).message,'מסונכרן');assert.equal(await pc.evaluate(id=>Store.task(id).title,id),'shared');
 console.log('PASS Android bridge upload and desktop bridge download while browser fetch always fails');
 await phone.evaluate(id=>Store.updateTask(id,{title:'phone edit'}),id);await pc.evaluate(id=>Store.updateTask(id,{note:'desktop edit'}),id);
 await sync(phone);await sync(pc);await sync(phone);assert.equal(await phone.evaluate(id=>Store.task(id).note,id),'desktop edit');assert.equal(await pc.evaluate(id=>Store.task(id).title,id),'phone edit');
 const before=writes;await sync(phone);await sync(pc);assert.equal(writes,before);console.log('PASS cross-device offline merge and no repeated upload when unchanged');
 await pc.evaluate(id=>Store.delTask(id),id);await sync(pc);await sync(phone);assert.equal(await phone.evaluate(id=>!!Store.task(id),id),false);
 await phone.evaluate(()=>Store.addTask({title:'conflict safe',kind:'short'}));conflict=true;await sync(phone);await sync(phone);await sync(pc);assert.ok(await pc.evaluate(()=>Store.all.tasks.some(t=>t.title==='conflict safe')));console.log('PASS deletion and compare-and-set conflict recovery');
 networkFailure=true;await phone.evaluate(()=>Store.addTask({title:'kept offline',kind:'short'}));let status=await sync(phone);assert.match(status.message,/שגיאת חיבור/);assert.ok(status.error.stage);assert.ok(await phone.evaluate(()=>Store.all.tasks.some(t=>t.title==='kept offline')));
 networkFailure=false;assert.equal((await sync(phone)).message,'מסונכרן');await sync(pc);assert.ok(await pc.evaluate(()=>Store.all.tasks.some(t=>t.title==='kept offline')));console.log('PASS network error retains local edits and retry syncs them');
 denied=true;status=await sync(phone);assert.equal(status.error.status,403);assert.match(status.message,/שגיאת הרשאה/);denied=false;assert.equal((await sync(phone)).message,'מסונכרן');console.log('PASS permission errors are distinguished from network errors and clear after recovery');
 assert.ok(calls.android>0&&calls.desktop>0);assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
