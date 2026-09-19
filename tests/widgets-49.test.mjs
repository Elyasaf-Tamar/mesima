import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=n=>fs.readFileSync(new URL('../src/js/'+n+'.js',import.meta.url),'utf8');
function setup(){const saved=new Map(),ctx=vm.createContext({Date,Math,JSON,Map,Set,console,window:{},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}});for(const n of ['01-store','05-cal','06-recur','09-plan','11-native-state','14-widgets'])vm.runInContext(source(n),ctx);return vm.runInContext('({Store,Plan,NativeState,Widgets})',ctx);}
test('widget projection carries an open cycle, excludes unscheduled checklists, and includes overlapping events',()=>{
 const {Store:S,Plan:P,NativeState:N,Widgets:W}=setup(),today=P.today(),p=S.addTask({title:'project',kind:'long'}),t=S.addTask({title:'ordinary',parentId:p.id});
 const c=S.addChecklist(p.id,'scheduled');S.addChecklistItem(p.id,c.id,'item');S.setChecklistRepeat(p.id,c.id,{days:[0,1,2,3,4,5,6],times:['09:00']});c.cycleDay=P.shift(today,-1);c.rt.cycle=c.cycleDay;
 const unscheduled=S.addChecklist(p.id,'unscheduled');S.addChecklistItem(p.id,unscheduled.id,'item');
 const e=S.addEvent({title:'spanning',date:P.shift(today,-2),endDate:P.shift(today,1),time:'09:00',end:'10:00'});
 const snapshot=N.projection();assert(snapshot.days[today].some(r=>r.id==='cl_'+p.id+'_'+c.id));assert(!snapshot.days[today].some(r=>r.id.includes(unscheduled.id)));
 assert(snapshot.days[today].some(r=>r.id===e.id));assert.equal(snapshot.days[P.shift(today,2)].some(r=>r.id===e.id),false);
 assert.equal(W.eligible(p),false);assert.equal(W.eligible(t),true);
 const before=S.export();assert.deepEqual(JSON.parse(JSON.stringify(W.project({kind:'tasks',ids:[p.id,t.id,t.id]}))).ids,[t.id]);assert.equal(S.export(),before);
 S.finishTask(t.id);assert.equal(W.eligible(t),false);
});
test('web trip resets on reading after a day offline, keeps a short gap, rejects inaccurate fixes',()=>{
 let now=1_000_000;const saved=new Map(),ctx=vm.createContext({Date:class extends Date{static now(){return now;}},Math,JSON,window:{},navigator:{},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)}});
 vm.runInContext(source('02-geo')+';globalThis.G=Geo;',ctx);const G=ctx.G;
 G.feed({lat:32,lng:34,acc:5,t:now});now+=10_000;G.feed({lat:32,lng:34.001,acc:5,t:now});const distance=G.trip.meters;assert(distance>0);
 now+=10*60_000;assert.equal(G.trip.meters,distance);G.feed({lat:32,lng:35,acc:500,t:now});assert.equal(G.trip.meters,distance);
 now+=86400000;assert.equal(G.trip.meters,0);assert.equal(JSON.parse(saved.get('mesima.trip')).meters,0);
 G.feed({lat:32,lng:35,acc:5,t:now});assert.equal(G.trip.meters,0);
});
