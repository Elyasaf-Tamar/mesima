import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=f=>fs.readFileSync(new URL('../src/js/'+f,import.meta.url),'utf8');
function context(data){
  const saved=new Map(data?[['mesima.v1',JSON.stringify(data)]]:[]);
  const ctx=vm.createContext({console,Date,Math,JSON,Map,Set,localStorage:{
    getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
    window:{},UI:{toast:()=>{}},setInterval:()=>0});
  vm.runInContext(read('06-recur.js')+'\n'+read('09-plan.js')+'\n'+read('01-store.js')+'\n'+read('14-data-care.js')+'\nthis.api={Store,DataCare}',ctx);
  return {ctx,saved,...ctx.api};
}
const now=Date.UTC(2026,8,6),day=86400000;
const task=(id,age,parentId=null,archived=true)=>({id,parentId,archived,archivedAt:now-age*day});
test('retention is disabled by default and rejects unexpected intervals',()=>{
  const {DataCare}=context();for(const n of [0,-1,1,NaN,31]) assert.equal(DataCare.expiredIds([task('a',99)],n,now).length,0);
});
test('a recent or active descendant protects the entire archived family',()=>{
  const {DataCare}=context();
  const items=[task('parent',100),task('child',99,'parent'),task('recent',2,'child'),task('solo',31)];
  assert.deepEqual(Array.from(DataCare.expiredIds(items,30,now)),['solo']);
  items[2]=task('active',100,'child',false);
  assert.deepEqual(Array.from(DataCare.expiredIds(items,30,now)),['solo']);
});
test('expired families are removed together; unknown dates and cycles survive',()=>{
  const {DataCare}=context();const items=[task('p',31),task('c',30,'p'),{...task('bad',50),archivedAt:null},task('x',40,'y'),task('y',40,'x')];
  assert.deepEqual(Array.from(DataCare.expiredIds(items,30,now)),['p','c']);
});
test('cleanup creates recovery copy before committing and respects storage failure',()=>{
  const a=context();const t=a.Store.addTask({title:'archived',kind:'short',mission:'army'});
  Object.assign(t,task(t.id,40));a.Store.setPref('archiveDays',30);
  const before=a.Store.export();assert.equal(a.DataCare.purge(now,true),1);
  assert.equal(a.saved.get('mesima.before-archive-cleanup'),before);assert.equal(a.Store.all.tasks.length,0);
  const b=context();const u=b.Store.addTask({title:'keep',kind:'short',mission:'army'});Object.assign(u,task(u.id,40));b.Store.setPref('archiveDays',30);
  b.ctx.localStorage.setItem=()=>{throw Error('quota')};assert.equal(b.DataCare.purge(now,true),0);assert.equal(b.Store.all.tasks.length,1);
});
test('checklist schedule, runtime, checked items and IDs survive repeated reloads',()=>{
  const a=context();const t=a.Store.addTask({title:'container',kind:'long',mission:'army'});
  const c=a.Store.addChecklist(t.id,'weekly');a.Store.addChecklistItem(t.id,c.id,'passport','original note');
  a.Store.setChecklistRepeat(t.id,c.id,{days:[1,4],time:'18:15',skipTypes:[],skipScope:'day',around:true});
  c.rt={cycle:'2026-09-07',doneAt:123};c.once=null;c.items[0].checked=true;a.Store.commit();
  const original=JSON.stringify(c);
  const b=context(JSON.parse(a.Store.export()));const c2=b.Store.task(t.id).checklists[0];
  assert.equal(JSON.stringify(c2),original);
  const d=context(JSON.parse(b.Store.export()));assert.equal(JSON.stringify(d.Store.task(t.id).checklists[0]),original);
});
test('single checklist reminder survives reload too',()=>{
  const a=context();const t=a.Store.addTask({title:'trip',kind:'long',mission:'army'});
  const c=a.Store.addChecklist(t.id,'bag');a.Store.setChecklistOnce(t.id,c.id,{date:'2026-09-20',time:'08:30'});
  const b=context(JSON.parse(a.Store.export()));assert.equal(b.Store.task(t.id).checklists[0].once.time,'08:30');
});
test('restore normalizes legacy data and preserves current data when malformed',()=>{
  const a=context();a.Store.addTask({title:'current',kind:'short',mission:'army'});
  const before=a.Store.export();
  assert.throws(()=>a.Store.import('{"tasks":[],"notes":{}}'));
  assert.equal(a.Store.export(),before);
  a.Store.import('{"tasks":[{"id":"legacy","title":"old","kind":"short","mission":"army","checklist":[{"id":"item","title":"one"}]}]}');
  assert.equal(a.Store.task('legacy').checklists[0].items[0].title,'one');
  assert.equal(a.saved.get('mesima.before-import'),JSON.stringify(JSON.parse(before)));
});
test('a multi-step task transaction emits one complete snapshot and rolls back on error',()=>{
  const a=context();const events=[];a.Store.onChange(()=>events.push(JSON.parse(a.Store.export())));
  a.Store.transaction(()=>{const t=a.Store.addTask({title:'trip',kind:'long',mission:'army'});
    const c=a.Store.addChecklist(t.id,'bag');a.Store.addChecklistItem(t.id,c.id,'passport','');});
  assert.equal(events.length,1);assert.equal(events[0].tasks[0].checklists[0].items.length,1);
  const before=a.Store.export();assert.throws(()=>a.Store.transaction(()=>{a.Store.addTask({title:'discard'});throw Error('fail');}));
  assert.equal(a.Store.export(),before);assert.equal(events.length,1);
});
