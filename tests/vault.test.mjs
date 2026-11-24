import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=f=>fs.readFileSync(new URL('../src/js/'+f+'.js',import.meta.url),'utf8');
const V=vm.runInNewContext(read('14-vault-crypto')+';VaultCrypto',{TextEncoder,TextDecoder,crypto:globalThis.crypto,globalThis:{crypto:globalThis.crypto},atob,btoa,Uint8Array,JSON,String,Number,Error});
const IT=1000; // fast iterations for tests; production uses 600000

test('create, unlock with the password, and refuse a wrong one',async()=>{
  assert.equal(V.ITER,600000);
  await assert.rejects(()=>V.create('k1','short',IT),/8/);
  const {record,key,recovery}=await V.create('k1','correct horse',IT);
  assert.match(recovery,/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  assert.doesNotMatch(record.pw+record.rc,/correct horse/);
  const box=await V.seal(key,'k1','s1',{text:'סיסמת בנק 1234'});
  assert.doesNotMatch(box,/1234|בנק/);
  const k2=await V.unlock(record,'correct horse');
  assert.deepEqual(await V.open(k2,'k1','s1',box),{text:'סיסמת בנק 1234'});
  assert.equal(await V.unlock(record,'wrong password'),null);
});

test('a sealed box is bound to its note id and tampering is detected',async()=>{
  const {key}=await V.create('k1','correct horse',IT);
  const box=await V.seal(key,'k1','s1',{text:'x'});
  assert.equal(await V.open(key,'k1','s2',box),null);
  assert.equal(await V.open(key,'k2','s1',box),null,'bound to the key id too');
  const [iv,ct]=box.split('.');const bad=iv+'.'+(ct[0]==='A'?'B':'A')+ct.slice(1);
  assert.equal(await V.open(key,'k1','s1',bad),null);
});

test('recovery code opens the vault and sets a new password; old password stops working',async()=>{
  const {record,key,recovery}=await V.create('k1','correct horse',IT);
  const box=await V.seal(key,'k1','s1',{text:'secret'});
  const sloppy=recovery.toLowerCase().replace(/-/g,' ').replace(/0/g,'o');
  assert.ok(await V.unlockRecovery(record,sloppy),'recovery code is forgiving about case, spaces and O/0');
  assert.equal(await V.setPassword(record,'NOPE-NOPE','recovery','new password!'),null);
  const next=await V.setPassword(record,sloppy,true,'new password!');
  assert.equal(await V.unlock(next,'correct horse'),null);
  assert.deepEqual(await V.open(await V.unlock(next,'new password!'),'k1','s1',box),{text:'secret'});
  assert.ok(await V.unlockRecovery(next,recovery),'the recovery code keeps working after a password change');
});

test('a new recovery code replaces the old one',async()=>{
  const {record,recovery}=await V.create('k1','correct horse',IT);
  assert.equal(await V.newRecovery(record,'wrong'),null);
  const {record:next,recovery:code2}=await V.newRecovery(record,'correct horse');
  assert.notEqual(code2,recovery);
  assert.equal(await V.unlockRecovery(next,recovery),null);
  assert.ok(await V.unlockRecovery(next,code2));
  assert.ok(await V.unlock(next,'correct horse'));
});

test('password and recovery parts are separate strings; bad iteration counts are refused',async()=>{
  const {record}=await V.create('k1','correct horse',IT);
  const pwChanged=await V.setPassword(record,'correct horse',false,'other password');
  assert.equal(pwChanged.rc,record.rc,'a password change leaves the recovery part untouched');
  const {record:rcChanged}=await V.newRecovery(record,'correct horse');
  assert.equal(rcChanged.pw,record.pw,'a new recovery code leaves the password part untouched');
  const bad={...record,pw:JSON.stringify({...JSON.parse(record.pw),it:999999999})};
  await assert.rejects(()=>V.unlock(bad,'correct horse'),/לא תקין/);
});
