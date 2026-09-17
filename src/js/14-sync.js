/* Per-field logical clocks, persistent deletions, optimistic cloud commits.
   Runtime reminder state and device preferences never leave their device. */
const SyncModel=(()=>{
  const collections=['tasks','events','notes','lists','places','links','eventTypes','completions','reflections'];
  const clone=x=>JSON.parse(JSON.stringify(x));
  const stable=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const content=x=>JSON.parse(JSON.stringify(x, (key,value)=>key==='rt'?undefined:value));
  function runtime(next,old){
    if(!next||typeof next!=='object')return next;
    if(Array.isArray(next))return next.map((v,i)=>runtime(v,Array.isArray(old)?(v?.id?old.find(x=>x.id===v.id):old[i]):null));
    if(old?.rt&&(!next.cycleDay||next.cycleDay===old.cycleDay))next.rt=clone(old.rt);
    for(const k of Object.keys(next))if(k!=='rt')next[k]=runtime(next[k],old?.[k]);return next;
  }
  const newer=(a,b)=>!b||a[0]>b[0]||(a[0]===b[0]&&a[1]>b[1]);
  const empty=()=>({schema:1,clock:0,records:{}});
  function capture(state,data,device){
    const next=clone(state),seen=new Set();let clock=state.clock+1,changed=false;
    for(const type of collections)for(const row of data[type]||[]){
      if(!row.id)continue;const key=type+'/'+row.id;seen.add(key);
      const record=next.records[key] ||= {fields:{}};
      const set=(name,value,deleted=false)=>{const old=record.fields[name];if(!old||old.deleted!==deleted||stable(old.value)!==stable(value)){record.fields[name]={stamp:[clock,device],value,deleted};changed=true;}};
      set('_alive',true);
      for(const k of new Set([...Object.keys(row),...Object.keys(record.fields)])){
        if(k==='rt'||k==='_alive'||k==='id'||['__proto__','constructor','prototype'].includes(k))continue;
        set(k,content(row[k]??null),!(k in row));
      }
    }
    for(const [key,record]of Object.entries(next.records))if(!seen.has(key)&&record.fields._alive?.value!==false){record.fields._alive={stamp:[clock,device],value:false,deleted:false};changed=true;}
    if(changed)next.clock=clock;return next;
  }
  function merge(a,b){
    const out=clone(a);out.clock=Math.max(a.clock,b.clock);
    for(const [key,record]of Object.entries(b.records)){
      const dst=out.records[key] ||= {fields:{}};
      for(const [k,v]of Object.entries(record.fields))if(newer(v.stamp,dst.fields[k]?.stamp))dst.fields[k]=clone(v);
    }return out;
  }
  function materialize(state,local){
    const out=clone(local);collections.forEach(k=>out[k]=[]);
    for(const [key,r]of Object.entries(state.records)){
      const at=key.indexOf('/'),type=key.slice(0,at),id=key.slice(at+1);
      if(!collections.includes(type)||r.fields._alive?.value===false)continue;
      const row={id},old=(local[type]||[]).find(x=>x.id===id);
      for(const [k,f]of Object.entries(r.fields))if(!f.deleted&&k!=='_alive'&&!['__proto__','constructor','prototype'].includes(k))row[k]=clone(f.value);
      out[type].push(runtime(row,old));
    }return out;
  }
  function validate(s){
    if(s?.schema!==1||!Number.isSafeInteger(s.clock)||s.clock<0||!s.records||typeof s.records!=='object'||Array.isArray(s.records))throw Error('נתוני סנכרון לא תקינים');
    for(const [key,r]of Object.entries(s.records)){
      if(!collections.includes(key.split('/')[0])||!r?.fields||typeof r.fields!=='object')throw Error('רשומת סנכרון לא תקינה');
      for(const [k,v]of Object.entries(r.fields))if(['__proto__','constructor','prototype'].includes(k)||!Array.isArray(v.stamp)||!Number.isSafeInteger(v.stamp[0])||typeof v.stamp[1]!=='string')throw Error('חותמת סנכרון לא תקינה');
    }return s;
  }
  return {empty,capture,merge,materialize,validate,stable};
})();
const CloudSync=(()=>{
  let device=localStorage.getItem('mesima.deviceId');if(!device){device=crypto.randomUUID();localStorage.setItem('mesima.deviceId',device);}
  let state=null,uid='',running=false,applying=false,timer,message='ממתין לכניסה',last=0,remoteCache=null,failure=null;
  const info=()=>({message,last,running,error:failure});
  const pendingRequests=new Map();
  window.__syncResponse=(id,result)=>{const p=pendingRequests.get(id);if(!p)return;clearTimeout(p.timer);pendingRequests.delete(id);p.resolve(result);};
  function nativeRequest(input){return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),timer=setTimeout(()=>{pendingRequests.delete(id);reject(Object.assign(Error('TIMEOUT'),{code:'TIMEOUT'}));},45000);
    pendingRequests.set(id,{resolve,timer});
    try{window.MesimaNative.syncRequest(id,JSON.stringify(input));}catch(e){clearTimeout(timer);pendingRequests.delete(id);reject(e);}
  });}
  const changed=()=>window.dispatchEvent(new Event('sync-status'));
  async function credentials(){
    if(window.MesimaDesktop)return window.MesimaDesktop.credentials();
    if(!window.MesimaNative?.syncCredentials)return null;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{window.__syncCredentials=null;reject(Error('פג זמן ההתחברות'));},12000);
      window.__syncCredentials=c=>{clearTimeout(timeout);window.__syncCredentials=null;resolve(c);};
      window.MesimaNative.syncCredentials();
    });
  }
  const save=()=>localStorage.setItem('mesima.sync.'+uid,JSON.stringify(state));
  async function cleanup(c,current){
    const key='mesima.syncCleanup.'+uid;if(Date.now()-Number(localStorage.getItem(key)||0)<3600000)return;
    let token='';
    for(let page=0;page<5;page++){
      const u=`https://firebasestorage.googleapis.com/v0/b/${c.bucket}/o?prefix=${encodeURIComponent('users/'+uid+'/sync/')}&maxResults=100${token?'&pageToken='+encodeURIComponent(token):''}`;
      const list=await(await request(u,c.token)).json();
      for(const item of list.items||[])if(item.name!==current&&item.name.startsWith('users/'+uid+'/sync/')&&Date.parse(item.timeCreated)<Date.now()-86400000){
        await request(`https://firebasestorage.googleapis.com/v0/b/${c.bucket}/o/${encodeURIComponent(item.name)}`,c.token,{method:'DELETE'}).catch(()=>{});
      }
      token=list.nextPageToken;if(!token)break;
    }localStorage.setItem(key,String(Date.now()));
  }
  function localChange(){if(applying||!state)return;state=SyncModel.capture(state,Store.all,device);save();schedule();}
  function schedule(){clearTimeout(timer);timer=setTimeout(run,8000);}
  async function request(url,token,options={}){
    const storage=new URL(url).hostname==='firebasestorage.googleapis.com',method=options.method||'GET';
    const stage=storage?(method==='POST'?'העלאת נתונים':method==='DELETE'?'ניקוי עותק ישן':'הורדת נתונים'):(method==='PATCH'?'שמירת מצב הסנכרון':'קריאת מצב הסנכרון');
    try{
      let r;
      const input={url,method,headers:options.headers||{},body:options.body||'',expectedUid:uid};
      if(window.MesimaDesktop?.syncRequest||window.MesimaNative?.syncRequest){
        const value=window.MesimaDesktop?.syncRequest?await window.MesimaDesktop.syncRequest(input):await nativeRequest(input);
        if(value.error)throw Object.assign(Error(value.error),{code:value.error});
        r=new Response(value.status===204?null:value.body,{status:value.status});
      }else{
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
        try{r=await fetch(url,{...options,headers:{Authorization:(storage?'Firebase ':'Bearer ')+token,...options.headers},signal:controller.signal});}
        finally{clearTimeout(timeout);}
      }
      if(!r.ok){const e=Error('HTTP');e.status=r.status;throw e;}return r;
    }catch(e){e.stage=stage;throw e;}
  }
  async function run(){
    if(running||Store.all.prefs.syncEnabled===false||!navigator.onLine)return;
    running=true;
    try{
      const c=await credentials();if(!c?.token){message='ממתין לכניסה';return;}
      const bound=localStorage.getItem('mesima.syncAccount');
      if(bound&&bound!==c.uid){message='החשבון השתנה — הפעל סנכרון מחדש כדי למזג את הנתונים';return;}
      if(uid!==c.uid){uid=c.uid;localStorage.setItem('mesima.syncAccount',uid);const old=localStorage.getItem('mesima.sync.'+uid);state=old?SyncModel.validate(JSON.parse(old)):SyncModel.empty();state=SyncModel.capture(state,Store.all,device);save();}
      const doc=`https://firestore.googleapis.com/v1/projects/${c.project}/databases/(default)/documents/users/${uid}/sync/state`;
      let remote=null,remoteState=SyncModel.empty();
      try{remote=await(await request(doc,c.token)).json();}catch(e){if(e.status!==404)throw e;}
      if(remote){
        const path=remote.fields?.path?.stringValue;
        if(!new RegExp('^users/'+uid+'/sync/[0-9a-f-]{36}\\.json$').test(path))throw Error('נתיב סנכרון לא תקין');
        if(remoteCache?.path===path)remoteState=remoteCache.state;
        else{
          const r=await request(`https://firebasestorage.googleapis.com/v0/b/${c.bucket}/o/${encodeURIComponent(path)}?alt=media`,c.token);
          const text=await r.text();if(new TextEncoder().encode(text).length>20971520)throw Error('הסנכרון גדול מ־20MB');remoteState=SyncModel.validate(JSON.parse(text));remoteCache={path,state:remoteState};
        }
      }
      // Capture again after network awaits so an edit made during download is included.
      state=SyncModel.capture(state,Store.all,device);
      const combined=SyncModel.merge(state,remoteState),text=SyncModel.stable(combined);
      if(text!==SyncModel.stable(remoteState)){
        if(new TextEncoder().encode(text).length>20971520)throw Error('הסנכרון גדול מ־20MB');
        const path=`users/${uid}/sync/${crypto.randomUUID()}.json`;
        const object=`https://firebasestorage.googleapis.com/v0/b/${c.bucket}/o/${encodeURIComponent(path)}`;
        const boundary=crypto.randomUUID();
        const body=`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({name:path,contentType:'application/json'})}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
        await request(`https://firebasestorage.googleapis.com/v0/b/${c.bucket}/o?name=${encodeURIComponent(path)}`,c.token,{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary,'X-Goog-Upload-Protocol':'multipart'},body});
        const condition=remote?'currentDocument.updateTime='+encodeURIComponent(remote.updateTime):'currentDocument.exists=false';
        try{await request(doc+'?'+condition,c.token,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:{path:{stringValue:path},schema:{integerValue:'1'}}})});}
        catch(e){await request(object,c.token,{method:'DELETE'}).catch(()=>{});if([409,412,400].includes(e.status)){schedule();return;}throw e;}
      }
      // Defer importing while an editor is open; the next pass merges its saved work.
      if(!document.querySelector('#modal.on')&&!document.activeElement?.isContentEditable){
        state=SyncModel.merge(SyncModel.capture(state,Store.all,device),combined);
        const next=SyncModel.materialize(state,Store.all);
        if(SyncModel.stable(next)!==SyncModel.stable(Store.all)){
          applying=true;try{Store.import(JSON.stringify(next));}finally{applying=false;}
        }
        save();
      }
      last=Date.now();message='מסונכרן';failure=null;
      // Previous sync snapshots are transient; user-created backups are untouched.
      if(remote?.fields?.path?.stringValue)cleanup(c,remote.fields.path.stringValue).catch(()=>{});
    }catch(e){
      const stage=e.stage?' · '+e.stage:'';failure={stage:e.stage||'',status:e.status||0,code:e.code||e.name||'Error'};
      if(e.status===403)message='שגיאת הרשאה בסנכרון'+stage+' (403). בדוק שהחשבון מחובר ושכללי הסנכרון פורסמו.';
      else if(e.status===401||e.code==='AUTH')message='הכניסה לחשבון פגה. היכנס שוב כדי להמשיך בסנכרון.';
      else if(e.code==='ACCOUNT_CHANGED')message='החשבון השתנה במהלך הסנכרון. נסה שוב.';
      else if(e.code==='TIMEOUT'||['TimeoutError','AbortError'].includes(e.name))message='שגיאת חיבור בסנכרון'+stage+': השרת לא ענה בזמן. ננסה שוב אוטומטית.';
      else if(e.code==='NETWORK'||/failed to fetch|fetch failed|networkerror/i.test(e.message))message='שגיאת חיבור בסנכרון'+stage+'. ננסה שוב אוטומטית.'+(!window.MesimaDesktop?.syncRequest&&!window.MesimaNative?.syncRequest?' יש להתקין את גרסה 4.7.1 כדי לתקן את חיבור הסנכרון.':'');
      else if(e.status)message='שגיאת סנכרון'+stage+' ('+e.status+').';
      else if(e.code==='TOO_LARGE')message='הסנכרון גדול מ־20MB';
      else message=e.message||'הסנכרון ממתין לחיבור';
    }
    finally{running=false;changed();}
  }
  function init(){Store.onChange(localChange);window.addEventListener('backup-status',schedule);window.addEventListener('online',schedule);window.addEventListener('sync-status',()=>{if(UI.screen==='settings')UI.render();});setInterval(run,30000);schedule();}
  function enable(on){Store.setPref('syncEnabled',on);if(on){localStorage.removeItem('mesima.syncAccount');uid='';state=null;schedule();}else message='הסנכרון כבוי';changed();}
  return {init,info,run,enable};
})();
