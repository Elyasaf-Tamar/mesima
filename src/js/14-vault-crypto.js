/* כספת — הצפנה מקומית בלבד (WebCrypto).
   A random 256-bit data key encrypts every secret note (AES-GCM). The data
   key is stored only wrapped: once with a key derived from the password and
   once with a key derived from the recovery code (PBKDF2-SHA256). Nothing
   readable leaves the device: sync and backups carry ciphertext only. */
const VaultCrypto=(()=>{
  const ITER=600000,enc=new TextEncoder(),dec=new TextDecoder();
  const ALPHA='0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
  const subtle=()=>{const s=globalThis.crypto?.subtle;if(!s)throw Error('ההצפנה לא זמינה במכשיר הזה');return s;};
  const rand=n=>globalThis.crypto.getRandomValues(new Uint8Array(n));
  const b64=u=>{let s='';u=new Uint8Array(u);for(let i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s);};
  const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));

  async function kek(secret,salt,it){
    const base=await subtle().importKey('raw',enc.encode(secret),'PBKDF2',false,['deriveKey']);
    return subtle().deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:it},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  // Each wrap is one string, so sync merges the password part and the
  // recovery part independently but never mixes the pieces of one wrap.
  async function wrap(raw,secret,keyId,it){
    const s=rand(16),iv=rand(12),k=await kek(secret,s,it);
    const ct=await subtle().encrypt({name:'AES-GCM',iv,additionalData:enc.encode('mesima-vault:'+keyId)},k,raw);
    return JSON.stringify({v:1,it,s:b64(s),iv:b64(iv),ct:b64(ct)});
  }
  function part(str){
    let p;try{p=JSON.parse(str);}catch{throw Error('מפתח כספת לא תקין');}
    if(p?.v!==1||!Number.isInteger(p.it)||p.it<1000||p.it>5000000||!p.s||!p.iv||!p.ct)throw Error('מפתח כספת לא תקין');
    return p;
  }
  async function unwrapRaw(str,secret,keyId){
    const w=part(str),k=await kek(secret,unb64(w.s),w.it);
    try{return new Uint8Array(await subtle().decrypt({name:'AES-GCM',iv:unb64(w.iv),additionalData:enc.encode("mesima-vault:"+keyId)},k,unb64(w.ct)));}
    catch{return null;}
  }
  const dataKey=raw=>subtle().importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
  function recoveryCode(){
    const bytes=rand(20);let bits=0,val=0,out='';
    for(const b of bytes){val=(val<<8)|b;bits+=8;while(bits>=5){out+=ALPHA[(val>>>(bits-5))&31];bits-=5;}}
    return out.match(/.{4}/g).join('-');
  }
  const normCode=c=>String(c||'').toUpperCase().replace(/[IL]/g,'1').replace(/O/g,'0').replace(/[^0-9A-Z]/g,'');

  /* A new vault key: returns the record to store, the usable key and the
     recovery code to show once. */
  async function create(keyId,password,it=ITER){
    if(String(password||'').length<8)throw Error('הסיסמה צריכה לפחות 8 תווים');
    const raw=rand(32),code=recoveryCode();
    const record={id:keyId,pw:await wrap(raw,password,keyId,it),rc:await wrap(raw,normCode(code),keyId,it)};
    return {record,key:await dataKey(raw),recovery:code};
  }
  const iterOf=str=>part(str).it;
  async function rawWith(record,secret,which){
    return unwrapRaw(record[which],which==='rc'?normCode(secret):secret,record.id);
  }
  async function unlock(record,password){const raw=await rawWith(record,password,'pw');return raw&&dataKey(raw);}
  async function unlockRecovery(record,code){const raw=await rawWith(record,code,'rc');return raw&&dataKey(raw);}
  /* New password from the current password or from the recovery code. */
  async function setPassword(record,secret,viaRecovery,newPassword){
    if(String(newPassword||'').length<8)throw Error('הסיסמה צריכה לפחות 8 תווים');
    const raw=await rawWith(record,secret,viaRecovery?'rc':'pw');if(!raw)return null;
    return {...record,pw:await wrap(raw,newPassword,record.id,iterOf(record.pw))};
  }
  async function newRecovery(record,password){
    const raw=await rawWith(record,password,'pw');if(!raw)return null;
    const code=recoveryCode();
    return {record:{...record,rc:await wrap(raw,normCode(code),record.id,iterOf(record.rc))},recovery:code};
  }
  async function seal(key,keyId,id,value){
    const iv=rand(12),ct=await subtle().encrypt({name:'AES-GCM',iv,additionalData:enc.encode('mesima-secret:'+keyId+':'+id)},key,enc.encode(JSON.stringify(value)));
    return b64(iv)+'.'+b64(ct);
  }
  async function open(key,keyId,id,box){
    const [iv,ct]=String(box||'').split('.');
    try{return JSON.parse(dec.decode(await subtle().decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:enc.encode('mesima-secret:'+keyId+':'+id)},key,unb64(ct))));}
    catch{return null;}
  }
  return {create,unlock,unlockRecovery,setPassword,newRecovery,seal,open,normCode,ITER};
})();
