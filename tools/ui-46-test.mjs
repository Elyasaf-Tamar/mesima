import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.MESIMA_PLAYWRIGHT));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html'));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.MESIMA_CHROME});const ctx=await browser.newContext({viewport:{width:412,height:915},permissions:['clipboard-read','clipboard-write']});const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(5000);
try{
 await p.goto(`http://127.0.0.1:${server.address().port}`);await p.evaluate(()=>{Engine.stop();Store.setPref('syncEnabled',false);UI.screen='settings';UI.render();});
 assert.equal(await p.locator('#settingsBody > .settings-row').count(),3);await p.screenshot({path:'test-results/settings-46.png'});
 await p.locator('[data-settings-page="data"]').click();assert.equal(await p.locator('#settingsBody > .settings-row').count(),3);
 await p.locator('[data-settings-page="archive"]').click();assert.equal(await p.locator('#archiveDays').count(),1);await p.evaluate(()=>window.__back());assert.equal(await p.locator('#settingsBody > .settings-row').count(),3);
 console.log('PASS three-row settings, nested navigation and system Back');
 const ids=await p.evaluate(()=>{const a=Store.addTask({title:'ראשונה',note:'תיאור ראשי',kind:'long',mission:'army'});const b=Store.addTask({title:'שנייה',kind:'long',mission:'army'});const c=Store.addTask({title:'ילד ראשון',note:'תיאור ילד',parentId:a.id,mission:'army'});const d=Store.addTask({title:'ילד שני',parentId:a.id,mission:'army'});UI.screen=null;UI.section='tasks';UI.render();return [a.id,b.id,c.id,d.id];});
 for(const id of [ids[0],ids[2]])await p.locator(`[data-nid="${id}"]`).click();
 await p.reload();await p.evaluate(()=>{Engine.stop();UI.section='tasks';UI.render();});
 for(const id of [ids[0],ids[2]])assert.equal(await p.locator(`[data-nid="${id}"]`).getAttribute('aria-expanded'),'false');
 await p.locator(`[data-nid="${ids[2]}"]`).click();await p.locator(`[data-copy-note-id="${ids[2]}"]`).click();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),'תיאור ילד');
 console.log('PASS parent/child description collapse survives restart and copy remains available');
 const first=p.locator(`.tcard[data-id="${ids[0]}"] > .drag-handle`),second=p.locator(`.tcard[data-id="${ids[1]}"]`);
 const before=await p.evaluate(()=>Store.allRoots().map(t=>t.title));await second.scrollIntoViewIfNeeded();const a=await first.boundingBox(),b=await second.boundingBox();await p.mouse.move(a.x+a.width/2,a.y+a.height/2);await p.mouse.down();await p.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await p.mouse.up();
 assert.deepEqual(await p.evaluate(()=>Store.allRoots().map(t=>t.title)),before.reverse());
 await p.locator(`.tsub[data-sub="${ids[2]}"] > .drag-handle`).focus();await p.keyboard.press('ArrowDown');assert.equal(await p.evaluate(id=>Store.subtasksOf(id)[0].title,ids[0]),'ילד שני');
 console.log('PASS pointer drag for roots and keyboard ordering for children');
 const result=await p.evaluate(()=>Search.run('סטימצקי, גן שמואל',''));assert.equal(result.results[0].lat,32.448385);assert.match(result.provider,/מאתר הרשת/);
 await p.evaluate(id=>UI.showAlert(Store.task(id),'תזכורת ניסיון','task'),ids[2]);await p.locator('#alLater').click();
 const snooze=await p.evaluate(()=>JSON.parse(localStorage.getItem('mesima.snoozes'))[0]);assert.ok(snooze.at-Date.now()>895000&&snooze.at-Date.now()<=900000);
 await p.reload();await p.evaluate(()=>{Engine.stop();const q=JSON.parse(localStorage.getItem('mesima.snoozes'));q[0].at=Date.now()-1;localStorage.setItem('mesima.snoozes',JSON.stringify(q));Engine.check();});await p.locator('#alert.on').waitFor();
 console.log('PASS fifteen-minute snooze persists across reload and fires when due');
 assert.deepEqual(errors,[]);console.log('PASS verified branch result and no JavaScript errors');
}finally{await browser.close();server.close();}
