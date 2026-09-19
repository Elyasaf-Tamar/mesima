import fs from 'node:fs';import http from 'node:http';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.MESIMA_PLAYWRIGHT).href);
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync('index.html'));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.MESIMA_CHROME}),ctx=await browser.newContext({viewport:{width:412,height:915},timezoneId:'Asia/Jerusalem'}),p=await ctx.newPage(),errors=[];
p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(5000);fs.mkdirSync('test-results',{recursive:true});
const foot=n=>p.locator('#mFoot').getByRole('button',{name:n,exact:true});
try{
 await p.clock.setFixedTime(new Date('2026-09-19T12:00:00+03:00'));await p.goto(`http://127.0.0.1:${server.address().port}`);await p.evaluate(()=>{Engine.stop();Store.setPref('syncEnabled',false);});
 assert.deepEqual(await p.locator('#tvModes button').allTextContents(),['היום','חודש']);
 const ids=await p.evaluate(()=>{
  const project=Store.addTask({title:'הכנה לצילום',kind:'long'}),second=Store.addTask({title:'מדפסת תלת־ממד',kind:'long'}),child=Store.addTask({title:'בדיקת ציוד',note:'התיאור שלי',parentId:project.id}),deep=Store.addTask({title:'בדיקת מצלמה',parentId:child.id}),habit=Store.addTask({title:'הרגל לדוגמה',parentId:project.id,repeat:{days:[0,1,2,3,4,5,6],times:['22:00']}}),note=Store.addNote({title:'שיעורי תורה',html:'<p>סיכום השיעור הראשון</p>'}),list=Store.addList({name:'קניות לשבת'});Store.addItem(list.id,{title:'חלב'});
  return {project:project.id,second:second.id,child:child.id,deep:deep.id,habit:habit.id,note:note.id,list:list.id};
 });
 await p.evaluate(id=>window.__openNote(id),ids.note);assert.equal(await p.locator('#noteEdit').isVisible(),false);assert.match(await p.locator('.note-reading').innerText(),/הראשון/);
 await p.locator('[data-note-edit]').click();await p.locator('#nBody').fill('סיכום מתוקן');await p.locator('#nBack').click();assert.equal(await p.locator('#noteRead').isVisible(),true);assert.match(await p.locator('.note-reading').innerText(),/מתוקן/);
 await p.locator('.note-options summary').click();await p.locator('[data-convert]').click();const initial=await p.evaluate(id=>Object.values(Store.note(id).parts)[0],ids.note);assert.match(initial.html,/מתוקן/);
 await p.locator('[data-part-add]').click();await p.locator('#nTitle').fill('שיעור בנושא תפילה');await p.locator('#nBody').fill('תוכן החלק השני');await p.locator('#nBack').click();assert.equal(await p.locator('.note-part').count(),2);
 const second=await p.evaluate(id=>Object.values(Store.note(id).parts).find(x=>x.title.includes('תפילה')),ids.note);
 await p.locator(`[data-part-edit="${initial.id}"]`).click();await p.locator('#nBody').fill('החלק הראשון נערך בנפרד');await p.locator('#nBack').click();assert.equal(await p.evaluate(({note,part})=>Store.note(note).parts[part].createdAt,{note:ids.note,part:initial.id}),initial.createdAt);
 assert.match(await p.locator('.note-part').nth(1).innerText(),/החלק השני/);await p.locator(`[data-fold="${initial.id}"]`).click();await p.screenshot({path:'test-results/49-notes-reading.png'});
 await p.reload();await p.evaluate(id=>{Engine.stop();window.__openNote(id);},ids.note);assert.equal(await p.locator(`[data-fold="${initial.id}"]`).getAttribute('aria-expanded'),'false');assert.equal(await p.locator(`[data-fold="${second.id}"]`).getAttribute('aria-expanded'),'true');
 assert.equal(await p.evaluate(()=>Store.notes().length),1);console.log('PASS note read/edit, independent parts, creation time, collapse persistence and reload');
 // Exercise selection through real UI while native persistence is replaced by a per-instance fake.
 await p.evaluate(()=>{window.widgetConfig=[{widgetId:7,kind:'tasks',ids:[]},{widgetId:8,kind:'notes',contentId:''},{widgetId:9,kind:'shopping',contentId:''}];window.MesimaNative={widgetConfigs:()=>JSON.stringify(window.widgetConfig),configureWidget:(id,text)=>{Object.assign(window.widgetConfig.find(c=>c.widgetId===id),JSON.parse(text));return true;}};Widgets.open(7);});
 assert.equal(await p.locator(`[data-task="${ids.child}"]`).count(),0);await p.locator(`[data-enter="${ids.project}"]`).click();await p.locator(`[data-task="${ids.child}"]`).check();assert.equal(await p.locator(`[data-task="${ids.habit}"]`).count(),0);await p.locator(`[data-enter="${ids.child}"]`).click();await p.locator(`[data-task="${ids.deep}"]`).check();await p.screenshot({path:'test-results/49-widget-picker.png'});await foot('שמור').click();
 const chosen=await p.evaluate(()=>Widgets.project(window.widgetConfig[0]).ids);assert.deepEqual(chosen,[ids.child,ids.deep]);assert.equal(await p.evaluate(id=>Store.task(id).planned,ids.child),null);
 await p.evaluate(()=>Widgets.open(7));await p.locator(`[data-enter="${ids.project}"]`).click();await p.locator(`[data-task="${ids.child}"]`).uncheck();await foot('שמור').click();assert.deepEqual(await p.evaluate(()=>window.widgetConfig[0].ids),[ids.deep]);
 await p.evaluate(()=>Widgets.open(8));await p.locator(`input[value="${ids.note}"]`).check();await foot('שמור').click();assert.equal(await p.evaluate(()=>Widgets.project(window.widgetConfig[1]).text),'');
 await p.evaluate(()=>Widgets.open(8));await p.locator('#widgetPreview').check();await foot('שמור').click();assert.match(await p.evaluate(()=>Widgets.project(window.widgetConfig[1]).text),/החלק השני/);
 await p.evaluate(()=>Widgets.open(9));await p.locator(`input[value="${ids.list}"]`).check();await foot('שמור').click();assert.equal(await p.evaluate(()=>Widgets.project(window.widgetConfig[2]).items[0].title),'חלב');
 console.log('PASS hierarchical, reconfigurable, unscheduled task choices and explicit note previews');
 await p.evaluate(id=>{delete window.MesimaNative;UI.openNote=null;UI.screen=null;window.__openTask(id);},ids.child);await foot('ערוך משימה').click();assert.equal(await p.locator('.belongs').count(),0);assert.equal(await p.locator('#etMembershipMain').innerText(),'');assert.equal(await p.locator('#etMembershipMore').isVisible(),false);await p.locator('#etAdvHead').click();await p.locator('#etMembershipMore summary').click();await p.locator(`[data-parent="${ids.second}"]`).check();await foot('שמור').click();
 await p.evaluate(id=>window.__openTask(id),ids.child);await foot('ערוך משימה').click();assert.match(await p.locator('#etMembershipMain').innerText(),/מופיעה גם ב־/);assert.match(await p.locator('#etMembershipMain').innerText(),/תלת־ממד/);await p.screenshot({path:'test-results/49-membership.png'});
 assert.equal(await p.locator('#mBody').evaluate(e=>getComputedStyle(e).scrollbarWidth),'none');assert.equal(await p.locator('#mBody').evaluate(e=>e.scrollHeight>e.clientHeight),true);console.log('PASS compact membership, title-description order and hidden scrollbar with overflow intact');
 assert.deepEqual(errors,[]);
}finally{await browser.close();server.close();}
