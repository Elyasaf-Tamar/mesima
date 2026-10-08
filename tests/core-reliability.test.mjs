import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(initial,bridge){
  let now=new Date('2026-10-08T12:00:00').getTime();const memory=new Map(initial?[['mesima.v1',JSON.stringify(initial)]]:[]),alerts=[];
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const ctx=vm.createContext({Date:Clock,Math,JSON,Map,Set,URLSearchParams,console,window:{MesimaNative:bridge},navigator:{},document:{},
    setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},
    localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
    Alerts:{fire:(...args)=>alerts.push(args)},UI:{},Widgets:{eligible:()=>true,payload:()=>({})}});
  for(const f of ['01-store','02-geo','05-cal','06-recur','09-plan','11-native','11-native-state','14-engine'])vm.runInContext(fs.readFileSync(new URL('../src/js/'+f+'.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(new URL('../src/js/14-sync.js',import.meta.url),'utf8').split('const CloudSync=')[0],ctx);
  return {...vm.runInContext('({Store,Geo,Cal,Recur,Plan,Native,NativeState,Engine,SyncModel})',ctx),at:s=>now=new Date(s).getTime(),alerts,memory};
}
const allDays={days:[0,1,2,3,4,5,6],times:['08:00']};

test('completed or atomic parents expose unfinished children without moving membership; undo restores nesting',()=>{
  const {Store:S}=setup(),p=S.addTask({title:'Parent'}),c=S.addTask({title:'Child',parentId:p.id}),g=S.addTask({title:'Grandchild',parentId:c.id});
  S.finishTask(p.id);assert.equal(c.parentId,p.id);assert.equal(S.allRoots()[0].id,c.id);assert.equal(S.isEffectiveRoot(g),false);assert.equal(c.done,false);
  S.undoCompletion(p.id);assert.deepEqual(Array.from(S.allRoots(),x=>x.id),[p.id]);
  S.updateTask(p.id,{repeat:allDays});assert.equal(S.isEffectiveRoot(c),true);assert.equal(S.children(p.id).length,0);
  S.import(S.export());assert.equal(S.task(c.id).parentId,p.id);assert.equal(S.isEffectiveRoot(S.task(c.id)),true);
  S.task(c.id).archived=true;assert.equal(S.isEffectiveRoot(S.task(c.id)),false);
});

test('an active shared parent keeps a child nested when its other parent completes',()=>{
  const {Store:S}=setup(),p=S.addTask({title:'Short'}),q=S.addTask({title:'Project',kind:'long'}),c=S.addTask({title:'Shared',parentId:p.id,parentIds:[p.id,q.id]});
  S.finishTask(p.id);assert.equal(S.isEffectiveRoot(c),false);assert.equal(S.children(q.id)[0].id,c.id);
});

test('midnight overlap and all-day exclusive endpoints agree with recurrence and ICS',()=>{
  const {Store:S,Cal:C,Recur:R}=setup(),e=S.addEvent({title:'Night shift',date:'2026-10-12',time:'22:00',end:'02:00'});
  assert.equal(S.events('2026-10-13')[0].id,e.id);assert.equal(R.around({...allDays,times:['01:00'],around:true},'2026-10-13','01:00').ev.id,e.id);
  const exact=S.addEvent({title:'Ends at midnight',date:'2026-10-12',time:'22:00',end:'00:00'});assert.equal(S.onDay(exact,'2026-10-13'),false);
  assert.equal(C.covering([e],C.endMs(e)),null);
  const full=S.addEvent({title:'כל היום '.repeat(20),date:'2026-10-24',endDate:'2026-10-25',allDay:true,remindMin:15});
  assert.equal(S.onDay(full,'2026-10-25'),true);assert.equal(S.onDay(full,'2026-10-26'),false);assert.equal(C.dayCount(full),2);
  const ics=C.ics([e,full]);assert.match(ics,/DTSTART;VALUE=DATE:20261024\r\nDTEND;VALUE=DATE:20261026/);
  assert.match(ics,/DTSTART:\d{8}T\d{6}Z/);assert.match(ics,/TRIGGER;VALUE=DATE-TIME:\d{8}T\d{6}Z/);
  assert.ok(ics.split('\r\n').every(line=>Buffer.byteLength(line,'utf8')<=75));
  assert.equal(new URL(C.gcal(full)).searchParams.get('dates'),'20261024/20261026');
  assert.doesNotMatch(C.ics([{...e,remindMin:null}]),/BEGIN:VALARM/);
});

test('distance ordering resolves manual subplace coordinates and excludes invalid points without changing the places',()=>{
  const {Store:S,Geo:G}=setup(),parent=S.addPlace('Mall',32.0001,34.8,100),child=S.addManualPlace('Shop',parent.id),far=S.addPlace('Other',32.1,34.8,100);
  const route=G.route({lat:32,lng:34.8},[far,child,{id:'invalid',lat:null,lng:null}]);
  assert.deepEqual(Array.from(route.stops,x=>x.id),[child.id,far.id]);
  assert.equal(route.stops[0].lat,parent.lat);assert.ok(route.stops[0].leg<20);assert.ok(Number.isFinite(route.total));assert.equal(child.lat,null);
  assert.equal(G.route({lat:null,lng:null},[far]).stops.length,0);
});

test('event exceptions lasting months do not erase the next recurrence',()=>{
  const {Store:S,Recur:R}=setup();S.addEvent({title:'Away',date:'2026-10-01',endDate:'2027-02-01',allDay:true,typeId:'away'});
  assert.equal(R.nextDay({...allDays,skipTypes:['away']},'2026-10-08'),'2027-02-02');
  assert.equal(R.nextDay({...allDays,skipTypes:['away'],skipScope:'week'},'2026-10-08'),'2027-02-07');
  assert.equal(R.previousDay({...allDays,skipTypes:['away']},'2026-12-01'),'2026-09-30');
  assert.equal(R.nextDay({days:[],times:['08:00']},'2026-10-08'),'');
});

test('an old open checklist catches up once, preserves old history and suppresses its old follow-up',()=>{
  const {Store:S,Engine:E,Plan:P}=setup(),t=S.addTask({title:'Daily',kind:'check'}),c=S.ownChecklist(t.id);S.addChecklistItem(t.id,c.id,'Camera');S.setChecklistRepeat(t.id,c.id,allDays);
  c.cycleDay='2026-01-01';c.rt.cycle=c.cycleDay;S.toggleChecklistItem(t.id,c.items[0].id);
  E.check();assert.equal(S.checklistCycle(c),P.today());assert.equal(c.items[0].checked,false);
  assert.equal(S.all.completions.filter(x=>x.active).length,1);assert.equal(S.rollChecklist(t.id,c.id),false);
  assert.equal(S.reminderBlocked({taskId:t.id,checklistId:c.id,occurrence:'2026-01-01'}),true);
});

test('tomorrow preparation fires the previous evening even after today was completed, and is not replayed during the event',()=>{
  const env=setup(),S=env.Store;env.at('2026-10-08T21:00:00');S.addEvent({title:'Early shift',date:'2026-10-09',time:'03:00',end:'06:00'});
  const t=S.addTask({title:'Prepare',repeat:{...allDays,times:['04:00'],around:true}});S.tickHabit(t.id,'2026-10-08');
  env.Engine.check();assert.equal(env.alerts.length,1);assert.equal(env.alerts[0][3].day,'2026-10-09');assert.equal(env.alerts[0][3].taskId,t.id);
  env.Engine.check();assert.equal(env.alerts.length,1);
  const late=setup();late.at('2026-10-09T04:00:00');late.Store.addEvent({title:'Shift',date:'2026-10-09',time:'03:00',end:'06:00',remindMin:-1});late.Store.addTask({title:'Prepare',repeat:{...allDays,times:['04:00'],around:true}});late.Engine.check();assert.equal(late.alerts.length,0);
});

test('native plan preserves far-future events, completion cycles and optional uncapped desktop alarms',()=>{
  const {Store:S,Native:N}=setup();const far=S.addEvent({title:'Future event',date:'2027-03-01',time:'12:00'});
  for(let i=0;i<120;i++)S.addTask({title:'Reminder '+i,planned:'2026-10-09',reminder:{type:'time',at:'12:00'}});
  assert.equal(N.alarmList().length,100);assert.equal(N.alarmList(undefined,null).length,121);
  assert.equal(N.alarmPlan().events[0].id,far.id);assert.equal(N.alarmPlan().tasks.length,120);
  const t=S.addTask({title:'One time',reminder:{type:'time',at:'09:00'}});assert.equal(t.planned,'2026-10-09');
  t.rt={firedKey:'keep'};S.updateTask(t.id,{note:'Only a note edit'});assert.equal(t.rt.firedKey,'keep');
});

test('backup restores pending native completions and shopping exactly once; invalid actions leave current DB untouched',()=>{
  const {Store:S}=setup(),t=S.addTask({title:'Task'}),h=S.addTask({title:'Habit',repeat:allDays}),l=S.addList({name:'Shopping'}),item=S.addItem(l.id,{title:'Milk'}),at=new Date('2026-10-08T10:30:00').getTime();
  const commands=[{id:'done',action:'complete',taskId:t.id,day:'2026-10-08',at},{id:'habit',action:'complete',taskId:h.id,day:'2026-10-08',at},{id:'shop',action:'shopping',listId:l.id,itemId:item.id,done:true,at}];
  const backup=JSON.parse(S.export());backup.nativeActions={schema:1,commands};S.import(JSON.stringify(backup));
  assert.equal(S.task(t.id).done,true);assert.equal(S.habitFull(S.task(h.id),'2026-10-08'),true);assert.equal(S.list(l.id).items[0].done,true);assert.equal(S.completionsFor('2026-10-08').length,2);assert.equal(S.all.nativeActions,undefined);
  S.updateItem(l.id,item.id,{done:false});const raced=JSON.parse(S.export());raced.nativeActions={schema:1,commands};S.import(JSON.stringify(raced));assert.equal(S.list(l.id).items[0].done,false);assert.equal(S.completionsFor('2026-10-08').length,2);
  const before=S.export();raced.nativeActions.commands[0].day='not-a-date';assert.throws(()=>S.import(JSON.stringify(raced)));assert.equal(S.export(),before);
});

test('native acknowledgements wait for both true projection and successful canonical snapshot writes',()=>{
  let commands=[],projectionOK=false,snapshotOK=false,acks=0;
  const bridge={pendingActions:()=>JSON.stringify(commands),syncState:()=>projectionOK,saveSnapshot:()=>snapshotOK,locationState:()=> '{}',ackActions:()=>{acks++;commands=[];}};
  const env=setup(undefined,bridge),t=env.Store.addTask({title:'Task'});commands=[{id:'command',action:'complete',taskId:t.id,day:'2026-10-08',at:new Date('2026-10-08T10:00:00').getTime()}];
  env.NativeState.drain();assert.equal(acks,0);projectionOK=true;env.NativeState.drain();assert.equal(acks,0);snapshotOK=true;env.NativeState.drain();assert.equal(acks,1);assert.equal(env.Store.completionsFor('2026-10-08').length,1);
});

test('distributed final checklist checks produce one atomic completion at the last contributing check, and undo survives stale sync',()=>{
  const env=setup(),S=env.Store,M=env.SyncModel,t=S.addTask({title:'Together',kind:'check'}),c=S.ownChecklist(t.id);
  S.addChecklistItem(t.id,c.id,'A');S.addChecklistItem(t.id,c.id,'B');
  const initial=JSON.parse(S.export()),base=M.capture(M.empty(),initial,'seed'),a=setup(initial),b=setup(initial);
  a.at('2026-10-08T09:00:00');a.Store.toggleChecklistItem(t.id,c.items[0].id);const left=a.SyncModel.capture(base,a.Store.all,'a');
  b.at('2026-10-08T10:00:00');b.Store.toggleChecklistItem(t.id,c.items[1].id);const right=b.SyncModel.capture(base,b.Store.all,'b');
  const merged=M.merge(left,right);env.at('2026-10-09T12:00:00');const saves=[];S.onChange(()=>saves.push(JSON.parse(S.export())));
  S.import(JSON.stringify(M.materialize(merged,S.all)),{reconcileChecklists:true});
  assert.equal(saves.length,1);assert.equal(saves[0].tasks[0].done,true);assert.equal(saves[0].completions.length,1);
  const completed=S.all.completions[0];assert.equal(completed.at,new Date('2026-10-08T10:00:00').getTime());assert.equal(completed.day,'2026-10-08');
  const completeState=M.capture(merged,S.all,'merged'),before=S.export();S.import(JSON.stringify(M.materialize(completeState,S.all)),{reconcileChecklists:true});assert.equal(S.export(),before);
  const reload=setup(JSON.parse(S.export()));assert.equal(reload.Store.all.completions.length,1);assert.equal(reload.Store.task(t.id).done,true);
  const stale=setup(JSON.parse(S.export()));stale.Store.updateTask(t.id,{note:'An unrelated offline edit'});
  env.at('2026-10-10T12:00:00');S.undoCompletion(t.id);
  const after=M.merge(M.capture(completeState,S.all,'undo'),stale.SyncModel.capture(completeState,stale.Store.all,'stale'));
  S.import(JSON.stringify(M.materialize(after,S.all)),{reconcileChecklists:true});
  assert.equal(S.task(t.id).done,false);assert.equal(S.all.completions.filter(r=>r.active).length,0);assert.equal(S.task(t.id).note,'An unrelated offline edit');
  assert.deepEqual(Array.from(S.task(t.id).checklists[0].items,i=>i.checked),[false,false]);
  const undone=S.export();S.import(JSON.stringify(M.materialize(after,S.all)),{reconcileChecklists:true});assert.equal(S.export(),undone);
});

test('a stale checked item stays in its original cycle; sync retains only current and previous cycle registers',()=>{
  const env=setup(),S=env.Store,M=env.SyncModel,t=S.addTask({title:'Daily pair',kind:'check'}),c=S.ownChecklist(t.id);
  S.addChecklistItem(t.id,c.id,'A');S.addChecklistItem(t.id,c.id,'B');S.setChecklistRepeat(t.id,c.id,allDays);
  const initial=JSON.parse(S.export()),base=M.capture(M.empty(),initial,'seed'),a=setup(initial),b=setup(initial);
  a.Store.toggleChecklistItem(t.id,c.items[0].id);let old=a.SyncModel.capture(base,a.Store.all,'old');
  // A high offline logical clock must not make yesterday's checks today's.
  for(let i=0;i<8;i++){a.Store.toggleChecklistItem(t.id,c.items[0].id);old=a.SyncModel.capture(old,a.Store.all,'old');}
  b.at('2026-10-09T12:00:00');b.Store.rollChecklist(t.id,c.id);b.Store.toggleChecklistItem(t.id,c.items[1].id);
  const merged=M.merge(old,b.SyncModel.capture(base,b.Store.all,'next'));
  S.import(JSON.stringify(M.materialize(merged,S.all)),{reconcileChecklists:true});
  assert.equal(S.task(t.id).checklists[0].cycleDay,'2026-10-09');assert.deepEqual(Array.from(S.task(t.id).checklists[0].items,i=>i.checked),[false,true]);
  let current=M.capture(merged,S.all,'current');
  for(let i=1;i<=60;i++){env.at(env.Plan.shift('2026-10-09',i)+'T12:00:00');S.rollChecklist(t.id,c.id);current=M.capture(current,S.all,'current');}
  const count=state=>Object.keys(state.records['tasks/'+t.id].fields).filter(k=>k.startsWith('[')&&JSON.parse(k).length===6&&JSON.parse(k)[4]==='checked').length;
  assert.equal(count(current),4);const staleMerge=M.merge(current,old);assert.equal(count(staleMerge),4);
  assert.deepEqual(Array.from(M.materialize(staleMerge,S.all).tasks[0].checklists[0].items,i=>i.checked),[false,false]);
  assert.equal(M.stable(M.capture(staleMerge,M.materialize(staleMerge,S.all),'current')),M.stable(staleMerge));
  // Manual one-time cycles have numeric ordering (once-10 follows once-9).
  const manual=setup(),u=manual.Store.addTask({title:'Reusable',kind:'check'}),list=manual.Store.ownChecklist(u.id);manual.Store.addChecklistItem(u.id,list.id,'A');
  let state=manual.SyncModel.capture(manual.SyncModel.empty(),manual.Store.all,'manual');
  for(let i=0;i<15;i++){manual.Store.resetChecklist(u.id,list.id);state=manual.SyncModel.capture(state,manual.Store.all,'manual');}
  const cycles=Object.keys(state.records['tasks/'+u.id].fields).filter(k=>k.startsWith('[')&&JSON.parse(k).length===6&&JSON.parse(k)[4]==='checked').map(k=>JSON.parse(k)[5]);
  assert.deepEqual(cycles.sort(),['once-14','once-15']);
});

test('merged checklist reconciliation reuses preserved completion evidence instead of redating old work',()=>{
  const env=setup(),S=env.Store,M=env.SyncModel,t=S.addTask({title:'Older checklist',kind:'check'}),c=S.ownChecklist(t.id);S.addChecklistItem(t.id,c.id,'Packed');
  const original=new Date('2026-10-01T09:30:00').getTime();c.items[0].checked=true;c.rt={doneAt:original};
  const state=M.capture(M.empty(),S.all,'seed');env.at('2026-10-10T12:00:00');S.import(JSON.stringify(M.materialize(state,S.all)),{reconcileChecklists:true});
  assert.equal(S.all.completions.length,1);assert.equal(S.all.completions[0].at,original);assert.equal(S.all.completions[0].day,'2026-10-01');
});
