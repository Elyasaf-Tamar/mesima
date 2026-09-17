import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.MESIMA_PLAYWRIGHT));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html'));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.MESIMA_CHROME});let pointer=null,version=0,writes=0,conflict=false;const objects=new Map(),errors=[];
async function device(){const ctx=await browser.newContext();await ctx.addInitScript(()=>{window.MesimaNative={syncCredentials:()=>window.__syncCredentials({uid:'testuser',token:'synthetic',project:'test-project',bucket:'test-bucket'}),status:()=> '{}',version:()=> '1.4'};});
 await ctx.route('https://**googleapis.com/**',async route=>{
  const req=route.request(),u=new URL(req.url());const reply=(status,value)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:typeof value==='string'?value:JSON.stringify(value)});
  assert.equal(req.headers().authorization,(u.hostname==='firebasestorage.googleapis.com'?'Firebase ':'Bearer ')+'synthetic');
  if(u.hostname==='firestore.googleapis.com'){
   if(req.method()==='GET')return pointer?reply(200,{fields:{path:{stringValue:pointer},schema:{integerValue:'1'}},updateTime:String(version)}):reply(404,{});
   if(req.method()==='PATCH'){if(conflict){conflict=false;return reply(409,{});}const expected=u.searchParams.get('currentDocument.updateTime');if(pointer&&expected!==String(version))return reply(409,{});pointer=req.postDataJSON().fields.path.stringValue;version++;writes++;return reply(200,{});}
  }else{
   if(req.method()==='POST'){assert.equal(req.headers()['x-goog-upload-protocol'],'multipart');const boundary=req.headers()['content-type'].split('boundary=')[1],parts=req.postData().split('--'+boundary);const meta=JSON.parse(parts[1].split('\r\n\r\n')[1].trim());assert.equal(meta.contentType,'application/json');assert.equal(meta.name,u.searchParams.get('name'));const body=parts[2].slice(parts[2].indexOf('\r\n\r\n')+4).replace(/\r\n$/,'');objects.set(meta.name,body);return reply(200,{});}
   const name=decodeURIComponent(u.pathname.split('/o/')[1]||'');if(req.method()==='DELETE'){objects.delete(name);return reply(200,{});}return objects.has(name)?reply(200,objects.get(name)):reply(404,{});
  }return reply(400,{});
 });
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(`http://127.0.0.1:${server.address().port}`);await p.evaluate(()=>{Engine.stop();Store.setPref('syncEnabled',false);});return p;
}
const sync=p=>p.evaluate(async()=>{Store.setPref('syncEnabled',true);await CloudSync.run();Store.setPref('syncEnabled',false);return CloudSync.info();});
try{
 const a=await device(),b=await device();
 const id=await a.evaluate(()=>Store.addTask({title:'shared',note:'original',kind:'short',mission:'army'}).id);
 assert.equal((await sync(a)).message,'מסונכרן');assert.equal((await sync(b)).message,'מסונכרן');assert.equal(await b.evaluate(id=>Store.task(id).title,id),'shared');
 console.log('PASS authenticated upload, pointer commit, download and second-device import');
 await a.evaluate(id=>Store.updateTask(id,{title:'phone edit'}),id);await b.evaluate(id=>Store.updateTask(id,{note:'desktop edit'}),id);
 await sync(a);await sync(b);await sync(a);assert.equal(await a.evaluate(id=>Store.task(id).note,id),'desktop edit');assert.equal(await b.evaluate(id=>Store.task(id).title,id),'phone edit');
 const before=writes;await sync(a);await sync(b);assert.equal(writes,before);console.log('PASS offline edits merge and unchanged state produces zero cloud uploads');
 await a.evaluate(id=>Store.delTask(id),id);await sync(a);await sync(b);assert.equal(await b.evaluate(id=>!!Store.task(id),id),false);console.log('PASS deletion propagates without resurrection');
 await a.evaluate(()=>Store.addTask({title:'retry conflict',kind:'short',mission:'army'}));conflict=true;await sync(a);await sync(a);await sync(b);assert.ok(await b.evaluate(()=>Store.all.tasks.some(t=>t.title==='retry conflict')));console.log('PASS optimistic conflict retry preserves local work');
 assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
