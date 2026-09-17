import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../src/js/14-sync.js',import.meta.url),'utf8').split('const CloudSync=')[0];
const M=vm.runInNewContext(source+';SyncModel');
const db=tasks=>({tasks,events:[],notes:[],lists:[],places:[],links:[],eventTypes:[],prefs:{geo:true}});
const plain=x=>JSON.parse(JSON.stringify(x));
test('two devices merge edits to different fields of the same task',()=>{
 const initial=M.capture(M.empty(),db([{id:'a',title:'start',note:'note'}]),'seed');
 const a=M.capture(initial,db([{id:'a',title:'new',note:'note'}]),'phone');
 const b=M.capture(initial,db([{id:'a',title:'start',note:'edited'}]),'pc');
 const merged=M.materialize(M.merge(a,b),db([]));assert.equal(merged.tasks[0].title,'new');assert.equal(merged.tasks[0].note,'edited');
 assert.deepEqual(plain(M.merge(a,b)),plain(M.merge(b,a)));
});
test('deletion survives stale offline device reconnecting',()=>{
 const initial=M.capture(M.empty(),db([{id:'a',title:'old'}]),'seed');
 const deleted=M.capture(initial,db([]),'phone');assert.equal(M.materialize(M.merge(deleted,initial),db([])).tasks.length,0);
});
test('same-field conflict is deterministic and merge is idempotent',()=>{
 const s=M.capture(M.empty(),db([{id:'a',title:'old'}]),'seed');
 const a=M.capture(s,db([{id:'a',title:'A'}]),'a'),b=M.capture(s,db([{id:'a',title:'B'}]),'b');
 const result=M.merge(a,b);assert.equal(M.materialize(result,db([])).tasks[0].title,'B');assert.deepEqual(plain(M.merge(result,result)),plain(result));
});
test('device reminder state and preferences stay local; pictures survive',()=>{
 const s=M.capture(M.empty(),db([{id:'a',title:'A',img:'data:image/png;base64,abc',rt:{firedAt:900}}]),'a');
 assert.equal(s.records['tasks/a'].fields.rt,undefined);
 const local=db([{id:'a',rt:{firedAt:123}}]),out=M.materialize(s,local);assert.equal(out.tasks[0].rt.firedAt,123);assert.equal(out.tasks[0].img,'data:image/png;base64,abc');assert.equal(out.prefs.geo,true);
});
test('reject malformed remote envelopes',()=>{
 assert.throws(()=>M.validate({schema:2}));assert.throws(()=>M.validate({schema:1,clock:0,records:{'tasks/x':{fields:{title:{stamp:['bad'],value:'x'}}}}}));
});
