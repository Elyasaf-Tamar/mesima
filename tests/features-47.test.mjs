import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function setup(options={}){
 const saved=new Map(),window={MesimaNative:options.bridge},ctx=vm.createContext({Date,Math,JSON,Map,Set,console,window,setTimeout,clearTimeout,setInterval:()=>0,localStorage:{getItem:k=>saved.get(k)||null,removeItem:k=>saved.delete(k),setItem:(k,v)=>{options.beforeSave?.();saved.set(k,v);}},navigator:{},document:{},UI:{}});
 for(const name of ['01-store','05-cal','06-recur','09-plan','11-native','11-native-state','14-widgets'])vm.runInContext(fs.readFileSync(new URL('../src/js/'+name+'.js',import.meta.url),'utf8'),ctx);
 return vm.runInContext('({Store,Plan,Native,NativeState,ReminderLink})',ctx);
}
test('shared child appears once in today and remains active when one parent closes or is deleted',()=>{
 const {Store:S,Plan:P}=setup();const a=S.addTask({kind:'long',title:'A'}),b=S.addTask({kind:'long',title:'B'}),c=S.addTask({title:'shared',parentId:a.id,planned:P.today()});
 S.updateTask(c.id,{parentIds:[a.id,b.id]});assert.equal(S.children(a.id).length,1);assert.equal(S.children(b.id).length,1);assert.equal(S.plannedFor(P.today()).filter(t=>t.id===c.id).length,1);
 S.finishTask(a.id);assert.equal(c.archived,false);S.delTask(a.id);assert.equal(S.task(c.id).parentId,b.id);S.import(S.export());assert.equal(S.children(b.id)[0].id,c.id);
 S.finishTask(c.id);assert.equal(S.children(b.id).length,0);
});
test('finishing a habit cancels every remaining reminder today but preserves tomorrow, including descriptions and IDs',()=>{
 const {Store:S,Plan:P,Native:N,ReminderLink:L}=setup();const t=S.addTask({title:'prayer',note:'full prayer text',repeat:{days:[0,1,2,3,4,5,6],times:['23:58','23:59']}}),day=P.today(),tom=P.shift(day,1);
 S.tickHabit(t.id,day);const alarms=N.alarmList();assert.equal(alarms.filter(a=>a.taskId===t.id&&a.day===day).length,0);
 const next=alarms.filter(a=>a.taskId===t.id&&a.day===tom);assert.equal(next.length,2);assert.match(next[0].body,/full prayer text/);assert.equal(L.resolve(next[0].id).taskId,t.id);
 S.untickHabit(t.id,day);assert.equal(S.habitFull(t,day),false);
});
test('widget projection includes named checklists, stable links and no duplicate shared task',()=>{
 const {Store:S,Plan:P,NativeState:N,ReminderLink:L}=setup(),a=S.addTask({title:'Project',kind:'long'}),t=S.addTask({title:'daily',parentId:a.id,repeat:{days:[0,1,2,3,4,5,6],times:['08:00']}});
 const c=S.addChecklist(a.id,'Equipment');S.addChecklistItem(a.id,c.id,'charger','');S.setChecklistRepeat(a.id,c.id,{days:[0,1,2,3,4,5,6],times:['08:00']});
 const snap=N.projection();assert.equal(Object.keys(snap.days).length,42);assert.equal(snap.days[P.today()].filter(r=>r.id===t.id).length,1);
 const cl=snap.days[P.today()].find(r=>r.kind==='checklist');assert.ok(cl);assert.equal(cl.title,'Equipment');assert.equal(L.resolve(cl.id).checklistId,c.id);
});

test('native completion replay is idempotent and acknowledges only after the updated projection is durable',()=>{
 let commands=[],events=[],S,P,fail=false;
 const bridge={pendingActions:()=>JSON.stringify(commands),locationState:()=> '{}',syncState:raw=>{
  if(fail)throw Error('simulated native storage failure');
  const data=JSON.parse(raw);assert.ok(data.tasks.find(t=>t.id===commands[0].taskId).log[commands[0].day]);events.push('projection');
 },ackActions:raw=>{events.push('ack');commands=commands.filter(c=>!JSON.parse(raw).includes(c.id));}};
 const env=setup({bridge});S=env.Store;P=env.Plan;
 const t=S.addTask({title:'daily',repeat:{days:[0,1,2,3,4,5,6],times:['08:00']}}),day=P.shift(P.today(),-1);
 commands=[{id:'from-widget',action:'complete',taskId:t.id,day}];fail=true;
 env.NativeState.drain();assert.equal(commands.length,1);assert.equal(S.habitFull(t,day),true);assert.equal(S.habitFull(t,P.today()),false);
 fail=false;env.NativeState.drain();assert.equal(commands.length,0);assert.deepEqual(events,['projection','ack']);
 env.NativeState.drain();assert.equal(S.habitFull(t,day),true);assert.deepEqual(events,['projection','ack']);
});

test('native completion remains queued when the local app cannot persist data',()=>{
 let fail=false,acks=0;const commands=[];
 const env=setup({beforeSave:()=>{if(fail)throw Error('quota');},bridge:{pendingActions:()=>JSON.stringify(commands),locationState:()=> '{}',syncState:()=>{},ackActions:()=>acks++}});
 const t=env.Store.addTask({title:'one-off'});commands.push({id:'pending',action:'complete',taskId:t.id,day:env.Plan.today()});fail=true;
 env.NativeState.drain();assert.equal(env.Store.canPersist,false);assert.equal(acks,0);assert.equal(commands.length,1);
});
