import {test} from 'node:test';import assert from 'node:assert/strict';import transport from '../desktop/sync-http.cjs';
const c={uid:'testuser',project:'test-project',bucket:'test-bucket',token:'synthetic'},file='users/testuser/sync/00000000-0000-0000-0000-000000000000.json';
const base='https://firebasestorage.googleapis.com/v0/b/test-bucket/o',doc='https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/users/testuser/sync/state';
const req=(url,method='GET',body='')=>({url,method,body,expectedUid:c.uid});
test('native desktop transport preserves 404/conflict responses and attaches credentials itself',async()=>{
 const input=req(base+'/'+encodeURIComponent(file)+'?alt=media');let calls=0;
 const result=await transport.send(input,async()=>c,async(url,o)=>{calls++;assert.equal(o.headers.Authorization,'Firebase synthetic');assert.equal(o.redirect,'error');assert.equal(o.headers.Origin,undefined);return new Response('{"schema":1}',{status:200});});
 assert.deepEqual(result,{status:200,body:'{"schema":1}'});assert.equal(calls,1);
 for(const status of [404,409,412])assert.equal((await transport.send(req(doc),async()=>c,async()=>new Response('{}',{status}))).status,status);
});
test('sync bridge rejects unrelated hosts, users, backups, credentials and account changes before network access',async()=>{
 for(const input of [req(doc.replace('https:','http:')),req(doc.replace('googleapis.com','googleapis.com.example.org')),req(doc.replace('testuser','other')),req(base+'/'+encodeURIComponent(file.replace('/sync/','/backups/'))+'?alt=media'),{...req(doc),headers:{Authorization:'injected'}},{...req(doc),expectedUid:'other'}]){
  const result=await transport.send(input,async()=>c,()=>{assert.fail('Network must not be called');});assert.ok(['INVALID_REQUEST','ACCOUNT_CHANGED'].includes(result.error));
 }
});
test('conditional commits, upload and cleanup stay within the current sync namespace',()=>{
 const body=JSON.stringify({fields:{path:{stringValue:file},schema:{integerValue:'1'}}});
 assert.equal(transport.validate(req(doc+'?currentDocument.exists=false','PATCH',body),c).method,'PATCH');
 transport.validate(req(base+'?name='+encodeURIComponent(file),'POST','multipart'),c);
 transport.validate(req(base+'?prefix='+encodeURIComponent('users/testuser/sync/')+'&maxResults=100'),c);
 assert.throws(()=>transport.validate(req(doc+'?currentDocument.exists=true','PATCH',body),c));
});
