import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(initial,bridge){
  let now=new Date('2026-11-23T10:00:00').getTime();const memory=new Map(initial?[['mesima.v1',JSON.stringify(initial)]]:[]);
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const ctx=vm.createContext({Date:Clock,Math,JSON,Map,Set,URLSearchParams,console,window:bridge?{MesimaNative:bridge}:{},navigator:{},document:{},Intl,
    setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},
    localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
    Alerts:{fire(){}},UI:{},Widgets:{eligible:()=>true,payload:()=>({})}});
  for(const f of ['01-store','02-geo','05-cal','06-recur','09-plan','11-native','11-native-state','14-capture-parse'])vm.runInContext(fs.readFileSync(new URL('../src/js/'+f+'.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(new URL('../src/js/14-sync.js',import.meta.url),'utf8').split('const CloudSync=')[0],ctx);
  return {...vm.runInContext('({Store,Native,SyncModel})',ctx),at:s=>now=new Date(s).getTime()};
}
const plain=x=>JSON.parse(JSON.stringify(x));

test('captures are added, sorted, re-stated and deleted with an undo copy',()=>{
  const {Store:S,at}=setup();
  assert.equal(S.addCapture('   '),null);
  const a=S.addCapture('  סיסמת וויפי 4482  ');at('2026-11-23T10:05:00');const b=S.addCapture('מחר ב-5 לרופא');
  assert.equal(a.text,'סיסמת וויפי 4482');
  assert.deepEqual(plain(S.captures().map(c=>c.id)),[a.id,b.id]);
  assert.equal(S.unsortedCaptures().length,2);
  S.updateCapture(a.id,{state:'info'});assert.equal(S.unsortedCaptures().length,1);
  S.updateCapture(b.id,{state:'task',taskId:'t1'});assert.equal(S.capture(b.id).taskId,'t1');
  S.updateCapture(b.id,{state:'inbox',taskId:null});assert.equal('taskId' in S.capture(b.id),false);
  assert.throws(()=>S.updateCapture(a.id,{state:'bogus'}));
  const copy=S.delCapture(a.id);assert.equal(S.capture(a.id),undefined);
  S.restoreCapture(copy);assert.equal(S.capture(a.id).text,'סיסמת וויפי 4482');
});

test('old backups without captures normalize, and captures survive export/import',()=>{
  const {Store:S}=setup({v:13,tasks:[],prefs:{vib:false}});
  assert.deepEqual(plain(S.all.captures),[]);assert.equal(S.all.prefs.captureReview,'20:30');assert.equal(S.all.prefs.vib,false);
  S.addCapture('בדיקה');S.import(S.export());assert.equal(S.captures()[0].text,'בדיקה');
  const {Store:T}=setup({v:13,tasks:[],captures:[{id:'x',text:'ok',state:'weird'},{text:'no id'},{id:'y'}]});
  assert.deepEqual(plain(T.captures().map(c=>[c.id,c.state])),[['x','inbox']]);
});

test('captures sync between devices: concurrent adds, a state change and a deletion',()=>{
  const {Store:S,SyncModel:M}=setup();const base=plain(S.all);
  base.captures=[{id:'c1',text:'one',state:'inbox',createdAt:1,updatedAt:1},{id:'c2',text:'two',state:'inbox',createdAt:2,updatedAt:2}];
  const seed=M.capture(M.empty(),base,'seed'),a=plain(base),b=plain(base);
  a.captures.push({id:'a1',text:'from phone',state:'inbox',createdAt:3,updatedAt:3});a.captures[0].state='info';
  b.captures.push({id:'b1',text:'from pc',state:'inbox',createdAt:4,updatedAt:4});b.captures=b.captures.filter(c=>c.id!=='c2');
  const merged=M.merge(M.capture(seed,a,'a'),M.capture(seed,b,'b')),out=M.materialize(merged,base);
  assert.deepEqual(plain(out.captures.map(c=>c.id).sort()),['a1','b1','c1']);
  assert.equal(out.captures.find(c=>c.id==='c1').state,'info');
  assert.deepEqual(plain(M.validate(JSON.parse(JSON.stringify(merged)))).schema,2);
});

test('daily review alarm is scheduled only with unsorted notes and an enabled time',()=>{
  const {Store:S,Native:N,at}=setup();
  const ids=()=>N.alarmList(undefined,null).filter(a=>a.id.startsWith('cap_')).map(a=>a.id);
  assert.deepEqual(plain(ids()),[]);
  const c=S.addCapture('משהו');
  assert.deepEqual(plain(ids()),['cap_2026-11-23','cap_2026-11-24']);
  const first=N.alarmList(undefined,null).find(a=>a.id==='cap_2026-11-23');
  assert.equal(new Date(first.at).getHours(),20);assert.equal(new Date(first.at).getMinutes(),30);assert.match(first.body,/פתק אחד/);
  at('2026-11-23T21:00:00');assert.deepEqual(plain(ids()),['cap_2026-11-24']);
  S.setPref('captureReview','');assert.deepEqual(plain(ids()),[]);
  S.setPref('captureReview','08:15');S.updateCapture(c.id,{state:'info'});assert.deepEqual(plain(ids()),[]);
});

test('records of a collection unknown to this version are kept, not rejected',()=>{
  const {Store:S,SyncModel:M}=setup();const base=plain(S.all);
  const remote=M.capture(M.empty(),base,'x');
  remote.records['futureThings/f1']={fields:{_alive:{stamp:[1,'x'],value:true,deleted:false},'["title"]':{stamp:[1,'x'],value:{type:'value',value:'later'},deleted:false}}};remote.clock=Math.max(remote.clock,1);
  const ok=M.validate(plain(remote));const merged=M.merge(M.capture(M.empty(),base,'me'),ok);
  assert.ok(merged.records['futureThings/f1']);assert.equal(M.materialize(merged,base).futureThings,undefined);
  assert.throws(()=>M.validate({schema:2,clock:1,records:{'../x':{fields:{}}}}));
});

test('the Android plan shell does not count review alarms it cannot show',()=>{
  const {Store:S,Native:N}=setup(null,{syncAlarmPlan(){},syncState(){},status:()=>'{}'});S.addCapture('x');
  assert.equal(N.alarmList(undefined,null).some(a=>a.id.startsWith('cap_')),false);
  const desk=setup();desk.Store.addCapture('x');
  assert.equal(desk.Native.alarmList(undefined,null).some(a=>a.id.startsWith('cap_')),true);
});

test('vault keys and secret boxes merge whole across devices and survive import',()=>{
  const {Store:S,SyncModel:M}=setup();const base=plain(S.all);
  base.vaultKeys=[{id:'k',pw:'P1',rc:'R1',createdAt:1,updatedAt:1}];
  base.secrets=[{id:'s',keyId:'k',box:'IVA.CTA',createdAt:1,updatedAt:1}];
  const seed=M.capture(M.empty(),base,'seed'),a=plain(base),b=plain(base);
  a.secrets[0].box='IVB.CTB';a.secrets[0].updatedAt=2;
  b.secrets[0].box='IVC.CTC';b.secrets[0].updatedAt=3;b.vaultKeys[0].rc='R2';a.vaultKeys[0].pw='P2';
  const out=M.materialize(M.merge(M.capture(seed,a,'a'),M.capture(seed,b,'b')),base);
  assert.ok(['IVB.CTB','IVC.CTC'].includes(out.secrets[0].box),'a box is never stitched from two devices');
  assert.deepEqual([out.vaultKeys[0].pw,out.vaultKeys[0].rc],['P2','R2'],'password and recovery changes on different devices both survive');
  S.import(JSON.stringify({...plain(S.all),vaultKeys:[{id:'k',pw:'{}',rc:'{}'},{id:'bad',pw:'x'}],secrets:[{id:'s',keyId:'k',box:'a.b'},{id:'t',box:'x'}]}));
  assert.deepEqual(plain(S.vaultKeys().map(k=>k.id)),['k']);assert.deepEqual(plain(S.secrets().map(x=>x.id)),['s']);
  assert.throws(()=>S.putSecret({id:'z',keyId:'k',box:'no-dot'}));
});

test('deleted records are scrubbed from the sync state, also against an older peer',()=>{
  const {Store:S,SyncModel:M}=setup();
  const c=S.addCapture('PIN 4482');const s1=M.capture(M.empty(),plain(S.all),'me');
  assert.match(JSON.stringify(s1),/4482/);
  S.delCapture(c.id);const s2=M.capture(s1,plain(S.all),'me');
  assert.doesNotMatch(JSON.stringify(s2),/4482/);
  const merged=M.merge(s1,s2),back=M.merge(s2,s1);
  assert.doesNotMatch(JSON.stringify(merged),/4482/);assert.doesNotMatch(JSON.stringify(back),/4482/);
  assert.equal(M.materialize(merged,plain(S.all)).captures.length,0);
  S.restoreCapture({...c});const s3=M.capture(merged,plain(S.all),'me');
  assert.equal(M.materialize(s3,plain(S.all)).captures[0].text,'PIN 4482','undo after delete still restores');
});
