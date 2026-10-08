import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Each scenario gets an empty, isolated profile. Serve current source directly so
// this suite can review edits before generated distribution files are rebuilt.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const manifest=JSON.parse(read('build-manifest.json'));
const html=read('src/shell.html')
  .replace('/* BUILD_STYLES */',()=>read('src/styles.css'))
  .replace('/* BUILD_SCRIPTS */',()=>manifest.map(read).join('\n'));
const {chromium}=await import(process.env.MESIMA_PLAYWRIGHT
  ?pathToFileURL(process.env.MESIMA_PLAYWRIGHT).href:'playwright');
const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.MESIMA_CHROME});
const foot=(page,name)=>page.locator('#mFoot').getByRole('button',{name,exact:true});
async function edit(page,id){
  await page.evaluate(id=>{Modal.shut();window.__openTask(id);},id);
  if(await foot(page,'ערוך משימה').count())await foot(page,'ערוך משימה').click();
  else{await foot(page,'עוד').click();await page.locator('[data-m="taskedit"]').click();}
}
async function addChild(page,title){
  await page.locator('#etAddKid').first().click();
  await page.locator('#etTitle').fill(title);
  await foot(page,'הוסף').click();
}
async function discard(page){
  await page.locator('#mClose').click();
  assert.equal(await page.locator('#mTitle').innerText(),'לזרוק את הטיוטה?');
  await foot(page,'זרוק').click();
}
async function date(page,selector,value){
  await page.locator(selector).click();
  await page.locator(`[data-dp="${value}"]`).click();
  await page.locator('[data-df="ok"]').click();
}
let passed=0;
async function scenario(name,run){
  const context=await browser.newContext({viewport:{width:412,height:915},timezoneId:'Asia/Jerusalem'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>{
    if(localStorage.getItem('mesima.v1'))return;
    localStorage.setItem('mesima.v1',JSON.stringify({
      v:12,tasks:[],events:[],lists:[],places:[],notes:[],prefs:{syncEnabled:false,geo:false,vib:false,sound:false}
    }));
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(6000);
  try{
    await page.clock.setFixedTime(new Date('2026-10-08T11:00:00+03:00'));
    await page.goto(origin);
    await page.evaluate(()=>{Engine.stop();Store.setPref('syncEnabled',false);});
    await run(page);
    assert.deepEqual(errors,[],`JavaScript errors in ${name}`);
    console.log(`PASS ${name}`);passed++;
  }catch(error){
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await page.screenshot({path:path.join(root,'test-results','review-failure.png'),fullPage:true}).catch(()=>{});
    console.error(`FAIL ${name}; page errors: ${JSON.stringify(errors)}`);
    throw error;
  }finally{await context.close();}
}

try{
  await scenario('ordinary task fields participate in save/discard guards',async page=>{
    const id=await page.evaluate(()=>Store.addTask({title:'מקור',note:'תיאור מקורי',mission:'free'}).id);
    await edit(page,id);
    await page.locator('#etTitle').fill('טיוטת שם');
    await page.locator('#etNote').fill('טיוטת תיאור');
    await page.locator('#mClose').click();
    assert.equal(await page.locator('#mTitle').innerText(),'לזרוק את הטיוטה?');
    await foot(page,'חזור לעריכה').click();
    assert.equal(await page.locator('#etTitle').inputValue(),'טיוטת שם');
    assert.equal(await page.locator('#etNote').inputValue(),'טיוטת תיאור');
    await discard(page);
    assert.deepEqual(await page.evaluate(id=>({title:Store.task(id).title,note:Store.task(id).note}),id),{title:'מקור',note:'תיאור מקורי'});
    await edit(page,id);await page.locator('#etNote').fill('נשמר');await foot(page,'שמור').click();
    assert.equal(await page.evaluate(id=>Store.task(id).note,id),'נשמר');
  });

  await scenario('saved child edits and ordering are staged until the outer save',async page=>{
    const ids=await page.evaluate(()=>{
      const parent=Store.addTask({title:'פרויקט',kind:'long',mission:'free'});
      const a=Store.addTask({title:'א',parentId:parent.id}),b=Store.addTask({title:'ב',parentId:parent.id});
      return {parent:parent.id,a:a.id,b:b.id};
    });
    const stored=()=>page.evaluate(id=>Store.ordered(Store.children(id)).map(t=>t.title),ids.parent);
    await edit(page,ids.parent);
    assert.deepEqual(await page.locator('#etKids [data-open] .st2').allTextContents(),['א','ב']);
    await page.locator(`[data-cmv="${ids.a}|1"]`).click();
    await page.locator(`[data-open="${ids.a}"]`).click();
    await page.locator('#etTitle').fill('א ערוך');await foot(page,'שמור').click();
    assert.deepEqual(await page.locator('#etKids [data-open] .st2').allTextContents(),['ב','א ערוך']);
    assert.deepEqual(await stored(),['א','ב']);
    await discard(page);assert.deepEqual(await stored(),['א','ב']);
    await edit(page,ids.parent);
    await page.locator(`[data-cmv="${ids.a}|1"]`).click();
    await page.locator(`[data-open="${ids.a}"]`).click();
    await page.locator('#etTitle').fill('א ערוך');await foot(page,'שמור').click();
    await foot(page,'שמור').click();
    assert.deepEqual(await stored(),['ב','א ערוך']);
  });

  await scenario('completing a parent exposes its open child and undo restores the grouping',async page=>{
    const ids=await page.evaluate(()=>{
      const parent=Store.addTask({title:'פעולה עם המשך',mission:'free'}),child=Store.addTask({title:'המשך פתוח',parentId:parent.id});
      UI.section='tasks';UI.screen=null;UI.filter='all';UI.render();return {parent:parent.id,child:child.id};
    });
    assert.equal(await page.locator(`#tasksBody .tcard[data-id="${ids.child}"]`).count(),0);
    await page.locator(`#tasksBody .tcard[data-id="${ids.parent}"] [data-act="done"]`).click();
    assert.equal(await page.locator(`#tasksBody .tcard[data-id="${ids.child}"]`).count(),1);
    assert.equal(await page.evaluate(id=>Store.task(id).parentId,ids.child),ids.parent);
    await page.locator('#toast .un').click();
    assert.equal(await page.locator(`#tasksBody .tcard[data-id="${ids.parent}"]`).count(),1);
    assert.equal(await page.locator(`#tasksBody .tcard[data-id="${ids.child}"]`).count(),0);
    assert.equal(await page.evaluate(id=>Store.task(id).done,ids.child),false);
  });

  await scenario('recursive new drafts preserve canceled children, their order and ancestors',async page=>{
    await page.evaluate(()=>window.__newTask());await page.locator('#etTitle').fill('שורש חדש');
    await page.locator('#etKind [data-k="long"]').click();
    await addChild(page,'ילד א');await addChild(page,'ילד ב');
    const keys=await page.locator('#etKids [data-open]').evaluateAll(nodes=>nodes.map(n=>n.dataset.open));
    await page.locator(`[data-open="${keys[0]}"]`).click();
    await page.locator('#etTitle').fill('שינוי מבוטל');await discard(page);
    assert.deepEqual(await page.locator('#etKids [data-open] .st2').allTextContents(),['ילד א','ילד ב']);
    await page.locator(`[data-open="${keys[0]}"]`).click();
    await page.locator('#etTitle').fill('ילד א שמור');
    await addChild(page,'נכד');
    await foot(page,'הוסף').click();
    assert.equal(await page.locator('#etTitle').inputValue(),'שורש חדש');
    assert.deepEqual(await page.locator('#etKids [data-open] .st2').allTextContents(),['ילד א שמור','ילד ב']);
    assert.equal(await page.evaluate(()=>Store.all.tasks.length),0);
    await foot(page,'הוסף').click();
    const tasks=await page.evaluate(()=>Store.all.tasks.map(t=>({id:t.id,title:t.title,parentId:t.parentId,sortIndex:t.sortIndex,kind:t.kind})));
    assert.equal(tasks.length,4);
    const byTitle=Object.fromEntries(tasks.map(t=>[t.title,t]));
    assert.equal(byTitle['נכד'].parentId,byTitle['ילד א שמור'].id);
    assert.equal(byTitle['ילד א שמור'].parentId,byTitle['שורש חדש'].id);
    assert.equal(byTitle['ילד ב'].parentId,byTitle['שורש חדש'].id);
    assert.ok(byTitle['ילד א שמור'].sortIndex<byTitle['ילד ב'].sortIndex);
    assert.equal(byTitle['ילד א שמור'].kind,'short');
  });

  await scenario('shared child deletion and detach are explicit staged operations',async page=>{
    const ids=await page.evaluate(()=>{
      const p=Store.addTask({title:'פרויקט א',kind:'long',mission:'free'}),q=Store.addTask({title:'פרויקט ב',kind:'long',mission:'free'});
      const c=Store.addTask({title:'ילד משותף',parentId:p.id,parentIds:[q.id]});
      return {p:p.id,q:q.id,c:c.id};
    });
    await edit(page,ids.p);await page.locator(`[data-rm="${ids.c}"]`).click();
    assert.match(await page.locator('#mBody').innerText(),/מכל הפרויקטים/);
    await foot(page,'סמן למחיקה').click();
    assert.ok(await page.evaluate(id=>!!Store.task(id),ids.c));
    await discard(page);assert.ok(await page.evaluate(id=>!!Store.task(id),ids.c));
    await edit(page,ids.p);await page.locator(`[data-open="${ids.c}"]`).click();
    await page.locator('#etAdvHead').click();await page.locator('#etIndep').click();await foot(page,'שמור').click();
    assert.deepEqual(await page.evaluate(id=>Store.parentIds(Store.task(id)),ids.c),[ids.p,ids.q]);
    await foot(page,'שמור').click();
    assert.deepEqual(await page.evaluate(id=>Store.parentIds(Store.task(id)),ids.c),[]);
    await page.evaluate(ids=>Store.updateTask(ids.c,{parentId:ids.p,parentIds:[ids.p,ids.q]}),ids);
    await edit(page,ids.p);await page.locator(`[data-rm="${ids.c}"]`).click();
    await foot(page,'סמן למחיקה').click();await foot(page,'שמור').click();
    assert.equal(await page.evaluate(id=>!!Store.task(id),ids.c),false);
  });

  await scenario('incomplete recurring, place and trip reminders cannot silently save',async page=>{
    await page.evaluate(()=>window.__newTask());await page.locator('#etTitle').fill('תזכורת');
    await page.locator('#etMode [data-a="repeat"]').click();await foot(page,'הוסף').click();
    assert.equal(await page.evaluate(()=>Store.all.tasks.length),0);
    assert.match(await page.locator('#toast').innerText(),/יום אחד ושעה/);
    await page.locator('#etMode [data-a="none"]').click();
    await page.locator('#etAdvHead').click();await page.locator('[data-advpick="place"]').click();await foot(page,'הוסף').click();
    assert.equal(await page.evaluate(()=>Store.all.tasks.length),0);
    assert.match(await page.locator('#toast').innerText(),/מקום שמור/);
    await page.locator('[data-advpick="trip"]').click();await page.locator('#etKm').fill('');await foot(page,'הוסף').click();
    assert.equal(await page.evaluate(()=>Store.all.tasks.length),0);
    assert.match(await page.locator('#toast').innerText(),/מרחק נסיעה/);
    await page.locator('#etKm').fill('501');await foot(page,'הוסף').click();assert.equal(await page.evaluate(()=>Store.all.tasks.length),0);
    await page.locator('#etKm').fill('12');await foot(page,'הוסף').click();
    assert.deepEqual(await page.evaluate(()=>Store.all.tasks[0].reminder),{type:'trip',km:12});
  });

  await scenario('habit conversion preserves child links and moves each checklist exactly once',async page=>{
    const ids=await page.evaluate(()=>{
      const p=Store.addTask({title:'הכנות',kind:'short',mission:'free'}),c=Store.addTask({title:'לבדוק ציוד',parentId:p.id});
      const rep=Store.addChecklist(p.id,'ציוד חוזר'),once=Store.addChecklist(p.id,'ציוד חד פעמי');
      Store.addChecklistItem(p.id,rep.id,'מצלמה');Store.addChecklistItem(p.id,rep.id,'עדשה');
      Store.setChecklistRepeat(p.id,rep.id,{days:[4],times:['20:00']});
      rep.items[0].checked=true;
      Store.addChecklistItem(p.id,once.id,'מטען');
      Store.setChecklistOnce(p.id,once.id,{date:'2026-10-09',time:'16:00'});Store.commit();
      return {p:p.id,c:c.id,rep:rep.id,once:once.id};
    });
    const before=await page.evaluate(id=>JSON.stringify(Store.task(id)),ids.p);
    await edit(page,ids.p);await page.locator('#etMode [data-a="repeat"]').click();
    await page.locator('#etDays [data-d="4"]').click();await foot(page,'שמור').click();
    assert.equal(await page.locator('#mTitle').innerText(),'להפוך למשימה חוזרת?');
    await foot(page,'חזור לעריכה').click();
    assert.equal(await page.evaluate(id=>JSON.stringify(Store.task(id)),ids.p),before);
    await foot(page,'שמור').click();await foot(page,'המשך כחוזרת').click();
    const result=await page.evaluate(ids=>({
      parent:Store.task(ids.p),child:Store.task(ids.c),root:Store.isEffectiveRoot(Store.task(ids.c)),
      checks:Store.all.tasks.filter(t=>t.kind==='check')
    }),ids);
    assert.equal(result.parent.checklists.length,0);assert.ok(result.parent.repeat);
    assert.equal(result.child.parentId,ids.p);assert.equal(result.child.done,false);assert.equal(result.root,true);
    assert.equal(result.checks.length,2);
    const rep=result.checks.find(t=>t.checklists[0].id===ids.rep),once=result.checks.find(t=>t.checklists[0].id===ids.once);
    assert.deepEqual(rep.checklists[0].items.map(i=>[i.title,i.checked]),[['מצלמה',true],['עדשה',false]]);
    assert.deepEqual(rep.checklists[0].repeat.times,['20:00']);
    assert.equal(once.planned,'2026-10-09');assert.deepEqual(once.reminder,{type:'time',at:'16:00'});assert.equal(once.checklists[0].once,null);
    await edit(page,ids.p);await foot(page,'שמור').click();
    assert.equal(await page.evaluate(()=>Store.all.tasks.filter(t=>t.kind==='check').length),2);
  });

  await scenario('new draft habit conversion keeps pending children through confirmation and reload',async page=>{
    await page.evaluate(()=>window.__newTask());await page.locator('#etTitle').fill('הרגל חדש');
    await page.locator('#etAdvHead').click();await addChild(page,'פעולה נפרדת');
    await page.locator('#etMode [data-a="repeat"]').click();await page.locator('#etDays [data-d="4"]').click();
    await foot(page,'הוסף').click();assert.equal(await page.locator('#mTitle').innerText(),'להפוך למשימה חוזרת?');
    await foot(page,'חזור לעריכה').click();assert.equal(await page.evaluate(()=>Store.all.tasks.length),0);
    await foot(page,'הוסף').click();await foot(page,'המשך כחוזרת').click();
    const before=await page.evaluate(()=>{
      const parent=Store.all.tasks.find(t=>t.title==='הרגל חדש'),child=Store.all.tasks.find(t=>t.title==='פעולה נפרדת');
      return {parent:parent.id,child:child.id,childParent:child.parentId,root:Store.isEffectiveRoot(child),count:Store.all.tasks.length};
    });
    assert.equal(before.count,2);assert.equal(before.childParent,before.parent);assert.equal(before.root,true);
    await page.reload();await page.evaluate(()=>Engine.stop());
    assert.deepEqual(await page.evaluate(id=>({parent:Store.task(id).parentId,root:Store.isEffectiveRoot(Store.task(id)),count:Store.all.tasks.length}),before.child),{parent:before.parent,root:true,count:2});
  });

  await scenario('editing a recurring checklist preserves item identity, order, checks and completion history',async page=>{
    const fixture=await page.evaluate(()=>{
      const task=Store.addTask({title:'רשימה חוזרת',kind:'check',mission:'free'}),list=Store.ownChecklist(task.id);
      const a=Store.addChecklistItem(task.id,list.id,'א'),b=Store.addChecklistItem(task.id,list.id,'ב');
      Store.setChecklistRepeat(task.id,list.id,{days:[4,5],times:['20:00']});
      Store.toggleChecklistItem(task.id,a.id);Store.toggleChecklistItem(task.id,b.id);
      return {task:task.id,list:list.id,items:list.items.map(x=>x.id),cycle:Store.checklistOccurrence(list),completions:JSON.stringify(Store.all.completions)};
    });
    await edit(page,fixture.task);await page.locator('#etNote').fill('תיאור חדש');await foot(page,'שמור').click();
    const state=await page.evaluate(f=>{
      const list=Store.checklistOf(f.task,f.list);return {count:Store.task(f.task).checklists.length,ids:list.items.map(x=>x.id),checks:list.items.map(x=>x.checked),cycle:Store.checklistOccurrence(list),completions:JSON.stringify(Store.all.completions)};
    },fixture);
    assert.equal(state.count,1);assert.deepEqual(state.ids,fixture.items);assert.deepEqual(state.checks,[true,true]);
    assert.equal(state.cycle,fixture.cycle);assert.equal(state.completions,fixture.completions);
  });

  await scenario('converting completed embedded checklists transfers history without a second completion',async page=>{
    const fixture=await page.evaluate(()=>{
      const task=Store.addTask({title:'הכנות שנשמרו',mission:'free'}),once=Store.addChecklist(task.id,'חד פעמי'),rep=Store.addChecklist(task.id,'חוזר');
      const a=Store.addChecklistItem(task.id,once.id,'א'),b=Store.addChecklistItem(task.id,rep.id,'ב');
      Store.setChecklistRepeat(task.id,rep.id,{days:[4,5],times:['20:00']});
      Store.toggleChecklistItem(task.id,a.id);Store.toggleChecklistItem(task.id,b.id);
      return {task:task.id,once:once.id,rep:rep.id,rows:Store.all.completions.map(x=>({title:x.title,day:x.day,at:x.at,projects:x.projects,occurrence:x.occurrence}))};
    });
    assert.equal(fixture.rows.length,2);
    await edit(page,fixture.task);await page.locator('#etMode [data-a="repeat"]').click();await page.locator('#etDays [data-d="4"]').click();
    await foot(page,'שמור').click();await foot(page,'המשך כחוזרת').click();
    const moved=await page.evaluate(f=>({
      tasks:Store.all.tasks.filter(t=>t.kind==='check').map(t=>({id:t.id,done:t.done,list:t.checklists[0].id})),
      rows:Store.all.completions.map(x=>({title:x.title,day:x.day,at:x.at,projects:x.projects,occurrence:x.occurrence})),
      ledger:Store.all.completions.map(x=>({task:x.taskId,list:x.checklistId}))
    }),fixture);
    assert.deepEqual(moved.rows,fixture.rows);assert.equal(moved.tasks.length,2);
    const once=moved.tasks.find(t=>t.list===fixture.once),rep=moved.tasks.find(t=>t.list===fixture.rep);
    assert.equal(once.done,true);assert.equal(rep.done,false);
    assert.ok(moved.ledger.some(x=>x.task===once.id&&x.list===fixture.once));
    assert.ok(moved.ledger.some(x=>x.task===rep.id&&x.list===fixture.rep));
    await edit(page,rep.id);await page.locator('#etNote').fill('נשמר שוב');await foot(page,'שמור').click();
    assert.equal(await page.evaluate(()=>Store.all.completions.length),2);
    await page.reload();await page.evaluate(()=>Engine.stop());
    const restored=await page.evaluate(ids=>({
      lists:ids.map(id=>Store.task(id).checklists[0].id),
      rows:Store.all.completions.map(x=>({title:x.title,day:x.day,at:x.at,projects:x.projects,occurrence:x.occurrence}))
    }),[once.id,rep.id]);
    assert.deepEqual(restored.lists,[fixture.once,fixture.rep]);assert.deepEqual(restored.rows,fixture.rows);
  });

  await scenario('event type pickers retain every event draft field and save the chosen type',async page=>{
    await page.evaluate(()=>window.__newEvent());
    await page.locator('#evT').fill('אירוע חדש');await date(page,'#evD','2026-10-14');await date(page,'#evED','2026-10-15');
    await page.locator('#evS').fill('15:30');await page.locator('#evE').fill('16:45');await page.locator('#evN').fill('תיאור האירוע');
    await page.locator('#evR').selectOption('60');await page.locator('#evAll').click();
    const oldType=await page.locator('#evTy [data-ty]').nth(1).getAttribute('data-ty');
    await page.locator(`#evTy [data-ty="${oldType}"]`).click();await page.locator('#evTyManage').click();await foot(page,'חזרה').click();
    assert.equal(await page.locator('#evAll').getAttribute('aria-checked'),'true');
    assert.equal(await page.locator(`#evTy [data-ty="${oldType}"]`).getAttribute('aria-checked'),'true');
    await page.locator('#evTy [data-ty="__new"]').click();await page.locator('#mClose').click();
    assert.equal(await page.locator('#evT').inputValue(),'אירוע חדש');assert.equal(await page.locator('#evED').inputValue(),'2026-10-15');
    await page.locator('#evTy [data-ty="__new"]').click();await page.locator('#etyName').fill('סוג מיוחד');await foot(page,'צור').click();
    const typeId=await page.evaluate(()=>Store.eventTypes().find(t=>t.name==='סוג מיוחד').id);
    assert.equal(await page.locator(`#evTy [data-ty="${typeId}"]`).getAttribute('aria-checked'),'true');
    assert.equal(await page.locator('#evR').inputValue(),'60');assert.equal(await page.locator('#evN').inputValue(),'תיאור האירוע');
    await foot(page,'הוסף').click();
    const ev=await page.evaluate(()=>Store.all.events[0]);
    assert.equal(ev.typeId,typeId);assert.equal(ev.allDay,true);assert.equal(ev.date,'2026-10-14');assert.equal(ev.endDate,'2026-10-15');
  });

  await scenario('list item selection and new event types retain scheduling fields',async page=>{
    const ids=await page.evaluate(()=>{
      const list=Store.addList({name:'קניות'}),a=Store.addItem(list.id,{title:'חלב'}),b=Store.addItem(list.id,{title:'לחם'});
      UI.screen='lists';UI.openList=list.id;UI.render();return {list:list.id,a:a.id,b:b.id};
    });
    await page.locator('#lPlan').click();await date(page,'#plD','2026-10-13');await page.locator('#plT').fill('18:35');await page.locator('#plR').selectOption('60');
    await page.locator('#plWhat [data-w="some"]').click();await foot(page,'חזרה').click();
    assert.equal(await page.locator('#plD').inputValue(),'2026-10-13');assert.equal(await page.locator('#plT').inputValue(),'18:35');assert.equal(await page.locator('#plR').inputValue(),'60');
    await page.locator('#plWhat [data-w="some"]').click();await page.locator(`[data-pi="${ids.b}"] .cb`).click();await foot(page,'אישור').click();
    await page.locator('#plTy [data-ty="__new"]').click();await page.locator('#etyName').fill('סידורים');await foot(page,'צור').click();
    await foot(page,'שבץ').click();
    const ev=await page.evaluate(id=>Store.listEvent(id),ids.list),typeId=await page.evaluate(()=>Store.eventTypes().find(t=>t.name==='סידורים').id);
    assert.equal(ev.date,'2026-10-13');assert.equal(ev.time,'18:35');assert.equal(ev.remindMin,60);assert.equal(ev.typeId,typeId);assert.equal(ev.note,'· חלב');
  });

  await scenario('file input restore requires confirmation before replacing live data',async page=>{
    const id=await page.evaluate(()=>{const t=Store.addTask({title:'נתון קיים',mission:'free'});UI.screen='settings';Settings.open('restore');return t.id;});
    const backup=JSON.stringify({v:12,tasks:[{id:'imported',title:'נתון מגיבוי',kind:'short',mission:'free'}],prefs:{syncEnabled:false}});
    await page.locator('#fileIn').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});
    await page.locator('#mTitle').filter({hasText:'לשחזר מהגיבוי?'}).waitFor();
    assert.ok(await page.evaluate(id=>!!Store.task(id),id));await foot(page,'ביטול').click();
    assert.ok(await page.evaluate(id=>!!Store.task(id),id));assert.equal(await page.evaluate(()=>!!Store.task('imported')),false);
    await page.locator('#fileIn').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});
    await foot(page,'שחזר').click();assert.equal(await page.evaluate(()=>Store.task('imported').title),'נתון מגיבוי');assert.equal(await page.evaluate(id=>!!Store.task(id),id),false);
  });

  await scenario('note More → Link keeps its dialog and the selected text',async page=>{
    const id=await page.evaluate(()=>{const n=Store.addNote({title:'קישור',html:'<p>לפני מילה אחרי</p>'});NoteView.edit(n.id);return n.id;});
    await page.locator('#nBody').evaluate(el=>{
      el.focus();const text=el.querySelector('p').firstChild,range=document.createRange();
      range.setStart(text,5);range.setEnd(text,9);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
    });
    await page.locator('#nTools [data-sheet="more"]').click();await page.locator('[data-do="c:link"]').click();
    assert.equal(await page.locator('#mTitle').innerText(),'קישור');assert.equal(await page.locator('#lkTxt').inputValue(),'מילה');
    await page.locator('#lkUrl').fill('javascript:alert(1)');await foot(page,'הוסף').click();
    assert.equal(await page.locator('#modal').getAttribute('class'),'on');assert.match(await page.locator('#toast').innerText(),/קישור אתר/);
    await page.locator('#lkUrl').fill('https://example.test/path');await foot(page,'הוסף').click();
    assert.equal(await page.locator('#nBody a').getAttribute('href'),'https://example.test/path');
    assert.equal(await page.locator('#nBody a').innerText(),'מילה');assert.match(await page.locator('#nBody').innerText(),/^לפני\s+מילה\s+אחרי$/);
    assert.match(await page.evaluate(id=>Store.note(id).html,id),/https:\/\/example.test\/path/);
  });

  await scenario('alert completion, snooze and future checklist opening honor occurrence metadata',async page=>{
    const ids=await page.evaluate(()=>{
      const habit=Store.addTask({title:'הרגל',mission:'free',repeat:{days:[4,5],times:['20:00']}});
      Store.finishTask(habit.id,Date.now(),'2026-10-08');
      const other=Store.addTask({title:'עוד תזכורת',mission:'free'});
      window.__alarm('hp_'+habit.id+'_2026-10-09@20:00');
      UI.showAlert(other,'הגיע הזמן','task',{kind:'task',taskId:other.id,day:'2026-10-08'});
      return {habit:habit.id,other:other.id};
    });
    await page.locator('#alert.on').waitFor();assert.equal(await page.locator('#alMsg').innerText(),'הרגל');
    await page.locator('#alComplete').click();
    assert.equal(await page.evaluate(id=>Store.habitFull(Store.task(id),'2026-10-09'),ids.habit),true);
    assert.equal(await page.locator('#alMsg').innerText(),'עוד תזכורת');assert.equal(await page.locator('#alert.on').count(),1);
    await page.locator('#alOk').click();
    const meta={kind:'task',taskId:ids.other,day:'2026-10-09',reminderId:'t_'+ids.other+'_2026-10-09'};
    await page.evaluate(meta=>UI.showAlert(Store.task(meta.taskId),'הכנה למחר','task',meta),meta);
    await page.locator('#alert.on').waitFor();await page.locator('#alLater').click();
    assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('mesima.snoozes'))[0].meta),meta);
    const checklist=await page.evaluate(()=>{
      const p=Store.addTask({title:'פרויקט',kind:'long',mission:'free'}),c=Store.addChecklist(p.id,'רשימה');
      Store.addChecklistItem(p.id,c.id,'ציוד');Store.setChecklistRepeat(p.id,c.id,{days:[4,5],times:['20:00']});
      UI.showAlert({id:'checklist-alert',title:'הכנת הרשימה'},'למחזור הבא','task',{kind:'checklist',taskId:p.id,checklistId:c.id,day:'2026-10-09',occurrence:'2026-10-09',reminderId:'cp_'+p.id+'_'+c.id+'_2026-10-09@20:00'});
      return {task:p.id,id:c.id,before:JSON.stringify(c)};
    });
    await page.locator('#alert.on').waitFor();assert.equal(await page.locator('#alComplete').isVisible(),false);
    await page.locator('#alOpen').click();assert.match(await page.locator('#mBody').innerText(),/לעיון/);
    assert.equal(await page.locator('#mBody .cb').count(),0);await foot(page,'סגור').click();
    assert.equal(await page.evaluate(c=>JSON.stringify(Store.checklistOf(c.task,c.id)),checklist),checklist.before);
    const manualMeta={kind:'checklist',taskId:checklist.task,checklistId:checklist.id,day:'2026-10-08',occurrence:'once-2',reminderId:`co_${checklist.task}_${checklist.id}`};
    await page.evaluate(meta=>{
      const c=Store.checklistOf(meta.taskId,meta.checklistId);c.repeat=null;c.manualCycle=2;Store.commit();
      window.__snoozeReview={accept:false,payload:null,legacyCalls:0};
      window.MesimaNative={
        snoozeReminder:json=>{__snoozeReview.payload=JSON.parse(json);return __snoozeReview.accept;},
        snoozeNotification:()=>{__snoozeReview.legacyCalls++;},
      };
      UI.showAlert({id:meta.reminderId,title:'מחזור ידני'},'הגיע הזמן','task',meta);
    },manualMeta);
    await page.locator('#alert.on').waitFor();await page.locator('#alLater').click();
    assert.match(await page.locator('#toast').innerText(),/לא ניתן לדחות/);assert.equal(await page.locator('#alert.on').count(),1);
    assert.equal(await page.evaluate(()=>UI.alertItem.item.rt?.snoozeTo||null),null);
    await page.evaluate(()=>__snoozeReview.accept=true);await page.locator('#alLater').click();
    assert.equal(await page.locator('#alert.on').count(),0);
    assert.deepEqual(await page.evaluate(()=>__snoozeReview.payload.meta),manualMeta);
    assert.equal(await page.evaluate(()=>__snoozeReview.legacyCalls),0);
  });

  await scenario('desktop reminder clicks keep old checklist cycles and await snooze acknowledgment',async page=>{
    const original=await page.evaluate(()=>{
      const task=Store.addTask({title:'פרויקט שולחן עבודה',kind:'long',mission:'free'});
      const list=Store.addChecklist(task.id,'רשימה מתחדשת');
      Store.addChecklistItem(task.id,list.id,'פריט ראשון');Store.addChecklistItem(task.id,list.id,'פריט שני');
      Store.toggleChecklistItem(task.id,list.items[0].id);
      Store.setChecklistOnce(task.id,list.id,{date:'2026-10-08',time:'20:00'});
      const reminder=Native.alarmList().find(a=>a.id==='co_'+task.id+'_'+list.id);
      Store.resetChecklist(task.id,list.id);
      window.__desktopReview={calls:[]};
      window.MesimaDesktop={
        onOpen(){},onScheduleRefresh(){},schedule(){},
        onReminder:cb=>{__desktopReview.reminder=cb;},
        snooze:a=>new Promise((resolve,reject)=>{
          __desktopReview.calls.push(structuredClone(a));__desktopReview.resolve=resolve;__desktopReview.reject=reject;
        })
      };
      Desktop.init();__desktopReview.reminder(reminder);
      return {reminder,task:task.id,list:list.id,before:JSON.stringify(list)};
    });
    assert.equal(original.reminder.occurrence,'once-0');
    assert.match(await page.locator('#mBody').innerText(),/לעיון/);
    assert.match(await page.locator('#mBody').innerText(),/once-0/);
    assert.equal(await page.locator('#mBody .cb').count(),0);
    assert.equal(await page.locator('#cvNew').count(),0);
    assert.equal(await page.evaluate(o=>JSON.stringify(Store.checklistOf(o.task,o.list)),original),original.before);
    await foot(page,'סגור').click();
    await page.evaluate(o=>__desktopReview.reminder({...o.reminder,occurrence:Store.checklistOccurrence(Store.checklistOf(o.task,o.list))}),original);
    assert.equal(await page.locator('#cvRows [data-act="cvTick"]').count(),2);
    await foot(page,'סיום').click();

    const unknown={id:'deleted-desktop-reminder',title:'תזכורת שמורה',body:'פריט שכבר אינו זמין',occurrence:'once-0'};
    await page.evaluate(a=>__desktopReview.reminder(a),unknown);
    await foot(page,'דחה ב־15 דקות').click();
    assert.equal(await page.locator('#modal.on').count(),1);
    assert.equal(await page.locator('#mTitle').innerText(),unknown.title);
    await foot(page,'דחה ב־15 דקות').click();
    assert.equal(await page.evaluate(()=>__desktopReview.calls.length),1);
    await page.evaluate(()=>__desktopReview.resolve(false));
    assert.match(await page.locator('#toast').innerText(),/לא ניתן לדחות/);
    assert.equal(await page.locator('#modal.on').count(),1);
    await foot(page,'דחה ב־15 דקות').click();
    await page.evaluate(()=>__desktopReview.reject(Error('disk full')));
    assert.match(await page.locator('#toast').innerText(),/לא ניתן לדחות/);
    assert.equal(await page.locator('#modal.on').count(),1);
    await foot(page,'דחה ב־15 דקות').click();
    await page.evaluate(()=>__desktopReview.resolve(true));
    assert.equal(await page.locator('#modal.on').count(),0);
    assert.match(await page.locator('#toast').innerText(),/נדחה ב־15 דקות/);
    assert.deepEqual(await page.evaluate(()=>__desktopReview.calls),[unknown,unknown,unknown]);
  });

  await scenario('blank place coordinates are rejected without changing the saved location',async page=>{
    const id=await page.evaluate(()=>{const p=Store.addPlace('מקום',32,35,250);UI.screen='places';UI.render();return p.id;});
    await page.locator(`[data-place-edit="${id}"]`).click();await page.locator('#placeLat').fill('');await page.locator('#placeLng').fill('');
    await foot(page,'שמור מקום').click();assert.match(await page.locator('#toast').innerText(),/מיקום תקינים/);
    assert.deepEqual(await page.evaluate(id=>[Store.place(id).lat,Store.place(id).lng],id),[32,35]);
  });

  await scenario('native settings report actual notification, scheduling and source-save outcomes',async page=>{
    await page.evaluate(()=>{
      window.__nativeReview={result:'blocked_channel',source:'https://example.test/index.html',accept:false,checks:0};
      window.MesimaNative={
        version:()=> '1.8.2',testNotify:()=>__nativeReview.result,
        status:()=>JSON.stringify({sourceUrl:__nativeReview.source,notifications:true,locationBackground:true,batteryUnrestricted:true,
          alarms:{source:'rules',scheduled:1,occurrences:150,exact:true},channel:{exists:true,blocked:false,importance:4}}),
        setSourceUrl:url=>{if(!__nativeReview.accept)return false;__nativeReview.source=url;return true;},
        checkUpdate:()=>__nativeReview.checks++,
      };
      Native.alarmDemand=()=>({wanted:150,cap:100,over:50});
      UI.screen='settings';Settings.open('perms');
    });
    assert.equal(await page.locator('[data-nat="fullscreen"]').count(),0);
    assert.match(await page.locator('#settingsBody').innerText(),/התראת מערכת/);
    await page.evaluate(()=>Settings.open('diag'));
    const diagnostics=await page.locator('#settingsBody').innerText();
    assert.match(diagnostics,/150/);assert.match(diagnostics,/התור מתחדש אוטומטית/);assert.doesNotMatch(diagnostics,/רושמת עד 100/);
    await page.locator('[data-nat="testnow"]').click();assert.match(await page.locator('#toast').innerText(),/ערוץ ההתראות חסום/);
    await page.evaluate(()=>__nativeReview.result='posted');await page.locator('[data-nat="testnow"]').click();
    assert.match(await page.locator('#toast').innerText(),/נמסרה למערכת/);
    await page.evaluate(()=>Settings.open('source'));await page.locator('#srcUrl').fill('https://example.test/new.html');
    await page.locator('[data-nat="saveSrc"]').click();assert.match(await page.locator('#toast').innerText(),/נדחתה/);
    assert.equal(await page.evaluate(()=>__nativeReview.source),'https://example.test/index.html');
    await page.evaluate(()=>Settings.open('update'));await page.locator('[data-nat="check"]').click();
    assert.equal(await page.evaluate(()=>__nativeReview.checks),0);
    await page.evaluate(()=>{__nativeReview.accept=true;Settings.open('source');});await page.locator('#srcUrl').fill('https://example.test/new.html');
    await page.locator('[data-nat="saveSrc"]').click();assert.equal(await page.locator('#toast').innerText(),'נשמר');
    assert.equal(await page.evaluate(()=>__nativeReview.source),'https://example.test/new.html');
    await page.evaluate(()=>Settings.open('update'));await page.locator('[data-nat="check"]').click();assert.equal(await page.evaluate(()=>__nativeReview.checks),1);
  });

  await scenario('a modal close callback can safely open a replacement modal',async page=>{
    await page.evaluate(()=>{
      window.__closedReplacement=0;
      Modal.open({title:'ראשון',body:'תוכן',close:()=>{
        Modal.open({title:'שני',body:'תוכן אחר',close:()=>window.__closedReplacement++});
        Modal.closeGuard=()=>{UI.toast('החלון השני עדיין פתוח');return false;};
      }});
      Modal.shut();
    });
    assert.equal(await page.locator('#mTitle').innerText(),'שני');await page.locator('#mClose').click();
    assert.equal(await page.locator('#modal.on').count(),1);assert.equal(await page.evaluate(()=>__closedReplacement),0);
    await page.evaluate(()=>Modal.shut());assert.equal(await page.evaluate(()=>__closedReplacement),1);
  });
  console.log(`PASS ${passed} isolated UI review scenarios`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
