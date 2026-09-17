// Authenticated transport restricted to the signed-in user's sync namespace.
// Never forward credentials to caller-supplied hosts or redirects.
const MAX=22*1024*1024;
function validate(input,c){
  const fail=()=>{throw Object.assign(Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'});};
  if(!input||typeof input.url!=='string'||input.url.length>8000)fail();
  if(input.expectedUid!==c.uid)throw Object.assign(Error('ACCOUNT_CHANGED'),{code:'ACCOUNT_CHANGED'});
  const u=new URL(input.url),method=input.method||'GET',prefix=`users/${c.uid}/sync/`;
  if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash)fail();
  const validObject=p=>typeof p==='string'&&p.startsWith(prefix)&&/^[0-9a-f-]{36}\.json$/.test(p.slice(prefix.length));
  const only=keys=>[...u.searchParams.keys()].every(k=>keys.includes(k))&&new Set(u.searchParams.keys()).size===[...u.searchParams.keys()].length;
  if(u.hostname==='firestore.googleapis.com'){
    if(decodeURIComponent(u.pathname)!==`/v1/projects/${c.project}/databases/(default)/documents/users/${c.uid}/sync/state`)fail();
    if(method==='GET'){if(u.search)fail();}
    else if(method==='PATCH'){
      if(!only(['currentDocument.updateTime','currentDocument.exists'])||[...u.searchParams.keys()].length!==1)fail();
      if(u.searchParams.has('currentDocument.exists')&&u.searchParams.get('currentDocument.exists')!=='false')fail();
      const j=JSON.parse(input.body);if(!validObject(j.fields?.path?.stringValue)||j.fields?.schema?.integerValue!=='1')fail();
    }else fail();
  }else if(u.hostname==='firebasestorage.googleapis.com'){
    const base=`/v0/b/${c.bucket}/o`,p=decodeURIComponent(u.pathname);
    if(p===base){
      if(method==='POST'){if(!only(['name'])||!validObject(u.searchParams.get('name')))fail();}
      else if(method==='GET'){if(!only(['prefix','maxResults','pageToken'])||u.searchParams.get('prefix')!==prefix||u.searchParams.get('maxResults')!=='100')fail();}
      else fail();
    }else if(p.startsWith(base+'/')&&validObject(p.slice(base.length+1))){
      if(method==='GET'){if(!only(['alt'])||u.searchParams.get('alt')!=='media')fail();}
      else if(method!=='DELETE'||u.search)fail();
    }else fail();
  }else fail();
  const headers={};for(const [k,v]of Object.entries(input.headers||{})){
    if(!['content-type','x-goog-upload-protocol'].includes(k.toLowerCase())||typeof v!=='string'||/[\r\n]/.test(v))fail();headers[k]=v;
  }
  const body=input.body||'';if(typeof body!=='string'||Buffer.byteLength(body)>MAX)throw Object.assign(Error('TOO_LARGE'),{code:'TOO_LARGE'});
  if(['GET','DELETE'].includes(method)&&body)fail();
  return {url:u.href,method,headers,body};
}
async function send(input,credentials,fetcher){
  try{
    const c=await credentials();if(!c) return {error:'AUTH'};
    const r=validate(input,c);r.headers.Authorization=(new URL(r.url).hostname==='firebasestorage.googleapis.com'?'Firebase ':'Bearer ')+c.token;
    const response=await fetcher(r.url,{method:r.method,headers:r.headers,...(r.body?{body:r.body}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
    const reader=response.body?.getReader(),chunks=[];let size=0;
    if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX)throw Object.assign(Error('TOO_LARGE'),{code:'TOO_LARGE'});chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
    return {status:response.status,body:Buffer.concat(chunks).toString('utf8')};
  }catch(e){return {error:['AUTH','ACCOUNT_CHANGED','TOO_LARGE','INVALID_REQUEST'].includes(e.code)?e.code:['TimeoutError','AbortError'].includes(e.name)?'TIMEOUT':'NETWORK'};}
}
module.exports={validate,send};
