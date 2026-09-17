import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function setup(initial){
 let now=new Date('2026-09-17T09:15:00').getTime();const memory=new Map(initial?[['mesima.v1',JSON.stringify(initial)]]:[]),alerts=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const c=vm.createContext({Date:Clock,Math,JSON,Map,Set,console,window:{},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},document:{},navigator:{},crypto:{randomUUID:()=>Math.random().toString()},UI:{esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')},Geo:{last:null,trip:{meters:0}},Alerts:{fire:(...x)=>alerts.push(x)}});
 for(const file of ['01-store','05-cal','06-recur','09-plan','11-native','11-native-state','14-sync','14-reflection','14-engine'])vm.runInContext(fs.readFileSync(new URL('../src/js/'+file+'.js',import.meta.url),'utf8'),c);
 return {...vm.runInContext('({Store,Plan,Native,NativeState,Reflection,SyncModel,Engine})',c),at:s=>now=new Date(s).getTime(),alerts};
}
const rep={days:[0,1,2,3,4,5,6],times:['08:45','16:00']};
test('completing a recurring checklist task completes its cycle, not the recurring entity',()=>{
 const {Store:S,Native:N}=setup(),t=S.addTask({title:'daily packing',kind:'check'}),c=S.ownChecklist(t.id);S.addChecklistItem(t.id,c.id,'camera');S.setChecklistRepeat(t.id,c.id,rep);S.finishTask(t.id);assert.equal(t.done,false);assert.equal(S.completionsFor('2026-09-17').length,1);assert.equal(N.alarmList().filter(a=>a.day==='2026-09-18').length,2);
 S.import(S.export());assert.equal(S.task(t.id).done,false);
});
test('desktop system notifications and snoozes obey the same day and cycle boundaries',async()=>{
 const {blocked}=await import('../desktop/reminder-state.cjs'),state={tasks:[{id:'h',daily:true,log:{'2026-09-17':1}},{id:'p',checklists:[{id:'c',complete:true,cycle:'2026-09-17'}]}]};
 assert.equal(blocked(state,{taskId:'h',day:'2026-09-17'}),true);assert.equal(blocked(state,{taskId:'h',day:'2026-09-18'}),false);
 assert.equal(blocked(state,{taskId:'p',checklistId:'c',occurrence:'2026-09-17'}),true);assert.equal(blocked(state,{taskId:'p',checklistId:'c',occurrence:'2026-09-18'}),false);
 state.tasks[1].done=true;assert.equal(blocked(state,{taskId:'p'}),true);
});
test('history snapshots names, timestamp and all parent projects without archiving; undo/recomplete is one occurrence',()=>{
 const {Store:S,Plan:P}=setup(),a=S.addTask({kind:'long',title:'A'}),b=S.addTask({kind:'long',title:'B'}),t=S.addTask({title:'Shot list',parentId:a.id});S.updateTask(t.id,{parentIds:[a.id,b.id]});
 S.finishTask(t.id);assert.equal(t.archived,false);assert.equal(t.done,true);assert.equal(S.active().includes(t),false);
 const r=S.completionsFor(P.today())[0];assert.equal(r.title,'Shot list');assert.equal(r.projects.length,2);assert.ok(r.at);
 S.finishTask(t.id);assert.equal(S.completionsFor(P.today()).length,1);S.undoCompletion(t.id);assert.equal(S.completionsFor(P.today()).length,0);assert.equal(S.active().includes(t),true);
 S.finishTask(t.id);S.updateTask(t.id,{title:'Renamed'});S.delTask(t.id);assert.equal(S.completionsFor(P.today())[0].title,'Shot list');
 S.closeProject(a.id);assert.equal(S.completionsFor(P.today()).length,1);
});
test('habit completion suppresses 16:00, tomorrow stays intact; undo never replays an elapsed reminder',()=>{
 const e=setup(),S=e.Store,t=S.addTask({title:'daily',repeat:rep});S.tickHabit(t.id,'2026-09-17');assert.equal(S.completionsFor('2026-09-17').length,1);
 assert.equal(e.Native.alarmList().filter(x=>x.day==='2026-09-17').length,0);assert.equal(e.Native.alarmList().filter(x=>x.day==='2026-09-18').length,2);
 e.at('2026-09-17T17:00:00');S.untickHabit(t.id,'2026-09-17');e.Engine.check();assert.equal(e.alerts.length,0);assert.equal(S.completionsFor('2026-09-17').length,0);
 e.at('2026-09-18T08:45:01');e.Engine.check();assert.equal(e.alerts.length,1);
});
test('complete checklist cycle persists through resets and reloads; future cycle reminders survive',()=>{
 const e=setup(),S=e.Store,t=S.addTask({title:'project',kind:'long'}),c=S.addChecklist(t.id,'equipment'),i=S.addChecklistItem(t.id,c.id,'camera');S.setChecklistRepeat(t.id,c.id,rep);S.toggleChecklistItem(t.id,i.id);
 assert.equal(S.completionsFor('2026-09-17').length,1);assert.equal(S.completionsFor('2026-09-17')[0].kind,'checklist');
 assert.equal(e.Native.alarmList().filter(x=>x.day==='2026-09-17').length,0);assert.equal(e.Native.alarmList().filter(x=>x.day==='2026-09-18').length,2);
 assert.equal(S.reminderBlocked({taskId:t.id,checklistId:c.id,occurrence:'2026-09-17'}),true);assert.equal(S.reminderBlocked({taskId:t.id,checklistId:c.id,occurrence:'2026-09-18'}),false);
 e.at('2026-09-18T09:15:00');S.rollChecklist(t.id,c.id);assert.equal(c.items[0].checked,false);S.toggleChecklistItem(t.id,i.id);assert.equal(S.all.completions.filter(x=>x.active).length,2);
 S.import(S.export());assert.equal(S.checklistCycle(S.checklistOf(t.id,c.id)),'2026-09-18');assert.equal(S.completionsFor('2026-09-17').length,1);
});
test('own checklist logs once and undo reopens it; manual reset retains old completion',()=>{
 const {Store:S,Plan:P}=setup(),t=S.addTask({kind:'check',title:'Pack'}),c=S.ownChecklist(t.id),i=S.addChecklistItem(t.id,c.id,'charger');S.toggleChecklistItem(t.id,i.id);assert.equal(t.done,true);assert.equal(t.archived,false);assert.equal(S.completionsFor(P.today()).length,1);
 S.undoCompletion(t.id);assert.equal(t.done,false);assert.equal(S.completionsFor(P.today()).length,0);S.toggleChecklistItem(t.id,i.id);S.resetChecklist(t.id,c.id);assert.equal(S.completionsFor(P.today()).length,1);S.toggleChecklistItem(t.id,i.id);assert.equal(S.completionsFor(P.today()).length,2);
});
test('daily visibility changes at 18:00; historical Sundays cover exactly previous Sunday-Saturday including DST',()=>{
 const {Reflection:R}=setup();assert.equal(R.available('2026-09-17',new Date('2026-09-17T17:59:59')),false);assert.equal(R.available('2026-09-17',new Date('2026-09-17T18:00:00')),true);
 assert.equal(R.available('2026-09-16',new Date('2026-09-17T09:00:00')),true);assert.equal(R.available('2026-09-18',new Date('2026-09-17T20:00:00')),false);
 assert.deepEqual(Array.from(R.weekDays('2026-10-25')),['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24']);
});
test('expanded day shows all completions and escaped note; weekly shows all seven daily notes and independent editor',()=>{
 const {Store:S,Reflection:R}=setup();for(let i=0;i<25;i++)S.finishTask(S.addTask({title:'Work '+i}).id);S.setReflection('day','2026-09-17','<script> & memories');
 assert.doesNotMatch(R.render('2026-09-17',new Date('2026-09-17T20:00:00')),/reflection-items/);R.opened.add('day:2026-09-17');const html=R.render('2026-09-17',new Date('2026-09-17T20:00:00'));assert.equal((html.match(/<li>/g)||[]).length,25);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/הצג עוד/);
 for(const d of R.weekDays('2026-09-20'))S.setReflection('day',d,'note '+d);R.opened.add('week:2026-09-13');const weekly=R.render('2026-09-20',new Date('2026-09-20T18:00:00'));assert.equal((weekly.match(/reflection-day-note/g)||[]).length,7);assert.match(weekly,/data-reflection-key="2026-09-13"/);assert.match(weekly,/25 דברים/);
});
test('project event links are bidirectional without adding any schedule or alarm; removing event clears link',()=>{
 const {Store:S,Plan:P,Native:N}=setup(),ev=S.addEvent({title:'filming',date:P.today(),time:'16:00'}),p=S.addTask({title:'prep',kind:'long'});S.linkTask(p.id,ev.id);assert.equal(p.eventId,ev.id);assert.equal(p.planned,null);assert.equal(p.reminder,null);assert.equal(S.plannedFor(P.today()).length,0);assert.equal(S.tasksForEvent(ev.id)[0].id,p.id);assert.equal(N.alarmList().filter(x=>x.taskId===p.id).length,0);S.import(S.export());assert.equal(S.task(p.id).eventId,ev.id);S.delEvent(ev.id);assert.equal(S.task(p.id).eventId,null);
});
test('manual sublocation inherits root coordinates and fence, remains a child through backup/restore',()=>{
 const {Store:S,Native:N}=setup(),p=S.addPlace('Gan Shmuel',32.4,34.9,250),c=S.addManualPlace('Super Pharm',p.id);assert.equal(c.lat,null);assert.equal(c.parentId,p.id);assert.equal(S.placeCoordinates(c.id).lat,32.4);
 S.addTask({title:'buy',reminder:{type:'place',placeId:c.id}});S.setPref('geo',true);assert.equal(N.fenceList()[0].lat,32.4);S.import(S.export());assert.equal(S.subPlaces(p.id)[0].name,'Super Pharm');assert.throws(()=>S.addManualPlace('bad',c.id));
});
test('related tasks are visible from both ends and removable without altering membership',()=>{
 const {Store:S}=setup(),p=S.addTask({title:'project',kind:'long'}),a=S.addTask({title:'A',parentId:p.id}),b=S.addTask({title:'B'});S.setRelatedTasks(a.id,[b.id]);assert.equal(S.relatedTasks(b.id)[0].id,a.id);S.setRelatedTasks(b.id,[]);assert.equal(S.relatedTasks(a.id).length,0);assert.equal(a.parentId,p.id);
});
test('independent device completions, undo and day/week notes survive merging and reloading',()=>{
 const {Store:S,SyncModel:M}=setup(),t=S.addTask({title:'habit',repeat:rep});const initial=JSON.parse(S.export()),base=M.capture(M.empty(),initial,'seed');
 S.tickHabit(t.id,'2026-09-16');S.setReflection('day','2026-09-16','Phone');const a=M.capture(base,JSON.parse(S.export()),'phone');
 const other=setup(initial);other.Store.tickHabit(t.id,'2026-09-17');other.Store.setReflection('week','2026-09-13','Desktop');const b=M.capture(base,JSON.parse(other.Store.export()),'desktop');
 const merged=M.merge(a,b);S.import(JSON.stringify(M.materialize(merged,initial)));assert.equal(S.completionsFor('2026-09-16').length,1);assert.equal(S.completionsFor('2026-09-17').length,1);assert.equal(S.habitFull(S.task(t.id),'2026-09-16'),true);assert.equal(S.reflection('week','2026-09-13'),'Desktop');
 S.untickHabit(t.id,'2026-09-16');const undo=M.capture(merged,JSON.parse(S.export()),'phone');S.import(JSON.stringify(M.materialize(M.merge(undo,a),initial)));assert.equal(S.completionsFor('2026-09-16').length,0);assert.equal(S.habitFull(S.task(t.id),'2026-09-16'),false);
});
test('legacy migration records only evidenced completions, does not invent time or unarchive projects',()=>{
 const {Store:S}=setup({v:11,tasks:[{id:'closed',title:'closed',kind:'long',archived:true},{id:'old',title:'Old task',kind:'short',done:true,doneAt:new Date('2026-09-16T11:30:00').getTime(),archived:true},{id:'habit',title:'Old habit',kind:'short',repeat:rep,log:{'2026-09-16':1}}]});assert.equal(S.completionsFor('2026-09-16').length,2);assert.equal(S.completionsFor('2026-09-16').find(r=>r.kind==='habit').at,null);S.import(S.export());assert.equal(S.completionsFor('2026-09-16').length,2);assert.equal(S.task('closed').archived,true);
});
