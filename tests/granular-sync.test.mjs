import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/js/14-sync.js',import.meta.url),'utf8');
// Frozen production client from 4816b93: compatibility tests must exercise the
// old reader/writer, rather than accidentally testing today's implementation.
const legacySource=fs.readFileSync(new URL('./fixtures/sync-schema1.js',import.meta.url),'utf8');
const model=code=>vm.runInNewContext(code.split('const CloudSync=')[0]+';SyncModel');
const M=model(source),L=model(legacySource),plain=x=>JSON.parse(JSON.stringify(x));
const db=()=>({tasks:[{id:'t',title:'Pack',kind:'short',parentId:'p0',parentIds:['p0'],relatedTaskIds:[],log:{},checklists:[{id:'c',name:'Equipment',items:[{id:'a',title:'Camera',checked:false},{id:'b',title:'Battery',checked:false},{id:'d',title:'Charger',checked:false}]}]}],lists:[{id:'l',name:'Shopping',items:[{id:'a',title:'Milk',done:false},{id:'b',title:'Bread',done:false},{id:'d',title:'Rice',done:false}]}],notes:[{id:'n',multipart:true,parts:{p:{id:'p',title:'Part',html:'Initial',createdAt:1}}}],events:[],places:[],links:[],eventTypes:[],completions:[],reflections:[],prefs:{geo:true}});

test('independent item checks and same-item fields survive concurrent devices',()=>{
  const initial=db(),base=M.capture(M.empty(),initial,'seed'),a=plain(initial),b=plain(initial);
  a.lists[0].items[0].done=true;b.lists[0].items[1].done=true;
  a.tasks[0].checklists[0].items[0].checked=true;b.tasks[0].checklists[0].items[1].checked=true;
  a.tasks[0].checklists[0].items[2].title='USB charger';b.tasks[0].checklists[0].items[2].note='Bring two';
  const merged=M.merge(M.capture(base,a,'a'),M.capture(base,b,'b')),out=M.materialize(merged,initial);
  assert.deepEqual(plain(out.lists[0].items.map(x=>x.done)),[true,true,false]);
  assert.deepEqual(plain(out.tasks[0].checklists[0].items.map(x=>x.checked)),[true,true,false]);
  assert.equal(out.tasks[0].checklists[0].items[2].title,'USB charger');assert.equal(out.tasks[0].checklists[0].items[2].note,'Bring two');
  assert.deepEqual(plain(M.capture(merged,out,'a')),plain(merged));
});

test('concurrent adds, a move and a deletion preserve identity, order and tombstones',()=>{
  const initial=db(),base=M.capture(M.empty(),initial,'seed'),a=plain(initial),b=plain(initial);
  a.lists[0].items=[a.lists[0].items[2],a.lists[0].items[0],{id:'new-a',title:'A',done:false}];
  b.lists[0].items.splice(1,0,{id:'new-b',title:'B',done:false});b.lists[0].items.find(x=>x.id==='b').title='Edited bread';
  const left=M.capture(base,a,'a'),right=M.capture(base,b,'b'),merged=M.merge(left,right),out=M.materialize(merged,initial);
  assert.deepEqual(plain(out.lists[0].items.map(x=>x.id)),['d','a','new-b','new-a']);
  assert.deepEqual(plain(M.merge(left,right)),plain(M.merge(right,left)));
  assert.deepEqual(plain(M.merge(merged,base)),plain(merged));
  assert.deepEqual(plain(M.capture(merged,out,'a')),plain(merged));
});

test('deleting a checklist wins over edits to its old children without deleting other lists',()=>{
  const initial=db(),base=M.capture(M.empty(),initial,'seed'),a=plain(initial),b=plain(initial);
  a.tasks[0].checklists=[];b.tasks[0].checklists[0].items[0].checked=true;
  b.tasks[0].checklists.push({id:'new',name:'New checklist',items:[{id:'x',title:'X',checked:false}]});
  const merged=M.merge(M.capture(base,a,'a'),M.capture(base,b,'b'));
  assert.deepEqual(plain(M.materialize(merged,initial).tasks[0].checklists.map(x=>x.id)),['new']);
});

test('memberships, daily logs and fields of the same note part merge independently',()=>{
  const initial=db(),base=M.capture(M.empty(),initial,'seed'),a=plain(initial),b=plain(initial);
  a.tasks[0].parentIds.push('p1');b.tasks[0].parentIds=['p2'];b.tasks[0].parentId='p2';
  a.tasks[0].relatedTaskIds=['x'];b.tasks[0].relatedTaskIds=['y'];
  a.tasks[0].log['2026-10-07']=1;b.tasks[0].log['2026-10-08']=1;
  a.notes[0].parts.p.title='New title';b.notes[0].parts.p.html='New content';
  const out=M.materialize(M.merge(M.capture(base,a,'a'),M.capture(base,b,'b')),initial);
  assert.deepEqual(plain(out.tasks[0].parentIds),['p1','p2']);assert.equal(out.tasks[0].parentId,'p2');
  assert.deepEqual(plain(out.tasks[0].relatedTaskIds),['x','y']);assert.equal(Object.keys(out.tasks[0].log).length,2);
  assert.equal(out.notes[0].parts.p.title,'New title');assert.equal(out.notes[0].parts.p.html,'New content');
});

test('schema-1 migration preserves deletions inside arrays, logs, parts and entire records against stale peers',()=>{
  const initial=db(),old=L.capture(L.empty(),initial,'seed'),edited=plain(initial);
  edited.lists[0].items.splice(0,1);edited.tasks[0].parentIds=[];edited.tasks[0].parentId=null;
  delete edited.notes[0].parts.p;edited.events=[];
  const removed=L.capture(old,edited,'phone'),upgraded=M.merge(removed,old),out=M.materialize(upgraded,initial);
  assert.equal(upgraded.schema,2);assert.deepEqual(plain(out.lists[0].items.map(x=>x.id)),['b','d']);
  assert.deepEqual(plain(out.tasks[0].parentIds),[]);assert.deepEqual(plain(out.notes[0].parts),{});
  const recaptured=M.capture(upgraded,out,'new-client');assert.deepEqual(plain(M.materialize(M.merge(recaptured,old),initial)),plain(out));
  const gone=plain(edited);gone.tasks=[];const deleted=L.capture(removed,gone,'phone');
  assert.equal(M.materialize(M.merge(deleted,old),initial).tasks.length,0);
  assert.deepEqual(plain(M.merge(removed,old)),plain(M.merge(old,removed)));
});

test('old client refuses schema 2 after a conflicting upload and never overwrites it on retry',async()=>{
  const data=db(),initial=L.capture(L.empty(),data,'seed'),upgraded=M.capture(initial,data,'new-client');
  let modern=false,uploads=0,patches=0;
  const memory=new Map([['mesima.sync.user',JSON.stringify(initial)]]),path='users/user/sync/00000000-0000-4000-8000-000000000000.json',modernPath='users/user/sync/22222222-2222-4222-8222-222222222222.json';
  const fakeFetch=async(url,options={})=>{
    const method=options.method||'GET';
    if(url.startsWith('https://firestore.googleapis.com/')&&method==='GET')return new Response(JSON.stringify({fields:{path:{stringValue:modern?modernPath:path}},updateTime:modern?'version-2':'version-1'}));
    if(url.includes('alt=media'))return new Response(JSON.stringify(modern?upgraded:initial));
    if(method==='POST'){uploads++;return new Response('{}');}
    if(method==='PATCH'){patches++;modern=true;return new Response('{}',{status:409});}
    if(method==='DELETE')return new Response(null,{status:204});
    throw Error('Unexpected fake request');
  };
  const local=plain(data);local.tasks[0].title='Pending edit on old app';
  const context=vm.createContext({console,JSON,Map,Set,Date,Math,URL,Response,TextEncoder,AbortController,fetch:fakeFetch,
    crypto:{randomUUID:()=> '11111111-1111-4111-8111-111111111111'},navigator:{onLine:true},Event:class{},
    localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,
    window:{MesimaDesktop:{credentials:async()=>({uid:'user',token:'test-only',bucket:'test',project:'test'})},dispatchEvent(){}},
    Store:{all:local},document:{querySelector:()=>null,activeElement:null}});
  vm.runInContext(legacySource+';this.cloud=CloudSync',context);
  await context.cloud.run();assert.equal(uploads,1);assert.equal(patches,1);
  await context.cloud.run();assert.equal(uploads,1);assert.equal(patches,1);assert.match(context.cloud.info().message,/סנכרון לא תקינים/);
  assert.throws(()=>M.validate({schema:3,clock:0,records:{}}),/עדכן.*בכל המכשירים/);
});
