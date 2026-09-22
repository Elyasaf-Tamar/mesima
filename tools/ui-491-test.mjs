import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.MESIMA_PLAYWRIGHT).href);
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync('index.html'));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.MESIMA_CHROME});
const context=await browser.newContext({viewport:{width:412,height:915},timezoneId:'Asia/Jerusalem'});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
fs.mkdirSync('test-results',{recursive:true});
try {
 await page.clock.setFixedTime(new Date('2026-09-22T10:00:00+03:00'));
 await context.addInitScript(()=>{
  if(localStorage.getItem('mesima.v1'))return;
  localStorage.setItem('mesima.v1',JSON.stringify({v:12,tasks:[
   {id:'project',title:'הכנה לצילום',kind:'long',archived:true,archivedAt:1789995600000},
   {id:'finished',title:'בדיקת ציוד הצילום',kind:'short',parentId:'project',note:'התיאור נשמר',done:true,doneAt:new Date('2026-09-19T15:20:00+03:00').getTime(),archived:true,archivedAt:new Date('2026-09-21T10:00:00+03:00').getTime()}
  ],reflections:[{id:'day:2026-09-19',kind:'day',date:'2026-09-19',text:'היה יום טוב'}],prefs:{syncEnabled:false}}));
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.evaluate(()=>Engine.stop());
 await page.locator('#tvModes [data-v="month"]').click();
 await page.locator('[data-day="2026-09-19"]').click();
 assert.equal(await page.locator('#mDay .reflection-head').count(),1);
 await page.locator('[data-reflection-toggle="day:2026-09-19"]').click();
 assert.match(await page.locator('.reflection-items').innerText(),/בדיקת ציוד הצילום/);
 assert.match(await page.locator('.reflection-items time').innerText(),/15:20/);
 assert.match(await page.locator('.reflection-items small').innerText(),/הכנה לצילום/);
 assert.equal(await page.locator('[data-reflection-note="day"]').inputValue(),'היה יום טוב');
 await page.locator('[data-reflection-note="day"]').fill('היה יום טוב — והציוד מוכן');
 assert.equal(await page.evaluate(()=>Store.task('finished').archived),false);
 assert.equal(await page.evaluate(()=>Store.task('project').archived),true);
 await page.screenshot({path:'test-results/491-past-day-mobile.png',fullPage:true});
 await page.locator('[data-day="2026-09-22"]').click();assert.equal(await page.locator('.reflections').count(),0);
 await page.locator('[data-day="2026-09-23"]').click();assert.equal(await page.locator('.reflections').count(),0);
 await page.locator('[data-day="2026-09-20"]').click();
 await page.locator('[data-reflection-toggle="week:2026-09-13"]').click();
 assert.match(await page.locator('.reflection-body').innerText(),/בדיקת ציוד הצילום/);
 assert.match(await page.locator('.reflection-day-note').innerText(),/והציוד מוכן/);
 await page.reload();await page.evaluate(()=>Engine.stop());
 await page.locator('#tvModes [data-v="month"]').click();await page.locator('[data-day="2026-09-19"]').click();
 await page.locator('[data-reflection-toggle="day:2026-09-19"]').click();
 assert.equal(await page.locator('.reflection-items li').count(),1);
 assert.equal(await page.locator('[data-reflection-note="day"]').inputValue(),'היה יום טוב — והציוד מוכן');
 await page.clock.setFixedTime(new Date('2026-09-22T18:00:00+03:00'));
 await page.locator('[data-day="2026-09-22"]').click();assert.equal(await page.locator('.reflection-head').count(),1);
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>{document.documentElement.classList.add('desktop');UI.selDate='2026-09-19';UI.render();});
 await page.screenshot({path:'test-results/491-past-day-desktop.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS actual month selection, migrated completion date/time, saved notes, weekly rollup, morning/evening/future rules, reload without duplication, mobile and desktop');
} finally {await browser.close();server.close();}
