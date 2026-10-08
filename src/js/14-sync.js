/* Schema 2 gives nested items independent clocks and persistent tombstones.
   Schema 1 is read and migrated. Older clients reject schema 2 before writing,
   so an old whole-array update cannot silently overwrite merged items.
   Firestore's pointer document remains transport schema 1. */
const SyncModel=(()=>{
  const collections=['tasks','events','notes','lists','places','links','eventTypes','completions','reflections'];
  const unsafe=k=>['__proto__','constructor','prototype'].includes(k);
  const clone=x=>JSON.parse(JSON.stringify(x));
  const stable=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const newer=(a,b)=>!b||a[0]>b[0]||(a[0]===b[0]&&a[1]>b[1]);
  const pathKey=path=>JSON.stringify(path),orderKey=path=>'order:'+pathKey(path);
  const empty=()=>({schema:2,clock:0,records:{}});
  function runtime(next,old){
    if(!next||typeof next!=='object')return next;
    if(Array.isArray(next))return next.map((v,i)=>runtime(v,Array.isArray(old)?(v?.id?old.find(x=>x.id===v.id):old[i]):null));
    if(old?.rt&&(!next.cycleDay||next.cycleDay===old.cycleDay))next.rt=clone(old.rt);
    for(const k of Object.keys(next))if(k!=='rt')next[k]=runtime(next[k],old?.[k]);return next;
  }
  function tree(fields){
    const root={children:new Map()};
    for(const [key,field]of Object.entries(fields)){
      if(key==='_alive')continue;
      const order=key.startsWith('order:'),path=JSON.parse(order?key.slice(6):key);let node=root;
      for(const part of path){if(!node.children.has(part))node.children.set(part,{children:new Map()});node=node.children.get(part);}
      if(order)node.position=field;else node.field=field;
    }return root;
  }
  function valueOf(node,root=false){
    const f=node?.field;if(!root&&(!f||f.deleted))return undefined;
    const type=root?'object':f.value.type;
    if(type==='value')return clone(f.value.value);
    const entries=[...node.children].filter(([key,n])=>!f?.value.legacyMembers||f.value.legacyMembers.includes(key)||n.field&&newer(n.field.stamp,f.stamp))
      .map(([key,n])=>[key,valueOf(n),n]).filter(x=>x[1]!==undefined);
    if(type==='list')return entries.sort((a,b)=>(a[2].position?.value||0)-(b[2].position?.value||0)||a[0].localeCompare(b[0])).map(x=>x[1]);
    if(type==='set')return entries.map(x=>x[0]).sort();
    return Object.fromEntries(entries.map(([k,v])=>[k,v]));
  }
  // Keep the longest unchanged subsequence; a move changes only moved items'
  // position clocks, and simultaneous insertions retain both new identities.
  function positions(ids,path,fields){
    const old=ids.map(id=>({id,f:fields[pathKey([...path,id])],p:fields[orderKey([...path,id])]}))
      .filter(x=>x.f&&!x.f.deleted&&x.p&&!x.p.deleted).sort((a,b)=>a.p.value-b.p.value||a.id.localeCompare(b.id));
    const rank=new Map(old.map((x,i)=>[x.id,i])),tails=[],links=new Map();
    for(const id of ids){if(!rank.has(id))continue;const n=rank.get(id);let lo=0,hi=tails.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(rank.get(tails[mid])<n)lo=mid+1;else hi=mid;}
      links.set(id,lo?tails[lo-1]:null);tails[lo]=id;
    }
    const keep=new Set();let last=tails.at(-1);while(last!=null){keep.add(last);last=links.get(last);}
    const out=new Map(),anchors=ids.map((id,i)=>keep.has(id)?i:-1).filter(i=>i>=0);anchors.push(ids.length);
    let start=0,left=null;
    for(const end of anchors){const right=end<ids.length?fields[orderKey([...path,ids[end]])].value:null,count=end-start;
      for(let i=0;i<count;i++){const p=left==null?(right==null?i:right-count+i):right==null?left+i+1:left+(right-left)*(i+1)/(count+1);out.set(ids[start+i],p);}
      if(end<ids.length){out.set(ids[end],right);left=right;}start=end+1;
    }
    const values=ids.map(id=>out.get(id));
    if(values.some((n,i)=>!Number.isFinite(n)||(i&&n<=values[i-1])))ids.forEach((id,i)=>out.set(id,i));
    return out;
  }
  function checklistOccurrence(c){return c.repeat?(c.cycleDay||c.rt?.cycle||''):'once-'+(c.manualCycle||0);}
  const checkPath=path=>path.length===6&&path[0]==='checklists'&&path[2]==='items'&&path[4]==='checked';
  const cycleOrder=(a,b)=>a.startsWith('once-')&&b.startsWith('once-')?Number(a.slice(5))-Number(b.slice(5)):a.localeCompare(b);
  function pruneChecks(state){
    for(const [key,r]of Object.entries(state.records)){
      if(!key.startsWith('tasks/'))continue;
      const lists=tree(r.fields).children.get('checklists');
      for(const [cid,node]of lists?.children||[]){
        const c=valueOf(node);if(!c)continue;const current=checklistOccurrence(c);
        for(const item of c.items||[]){
          const values=item.checked;if(!values||typeof values!=='object')continue;
          const previous=Object.keys(values).filter(day=>cycleOrder(day,current)<0).sort(cycleOrder).at(-1);
          // Older occurrence registers cannot influence the current cycle.
          // Retain just the current and nearest earlier cycle; pruning is safe
          // even when a stale peer later brings an older register back.
          if(previous!==undefined)for(const day of Object.keys(values))if(cycleOrder(day,previous)<0)
            delete r.fields[pathKey(['checklists',cid,'items',item.id,'checked',day])];
        }
      }
    }return state;
  }
  function flatten(value,path,fields,set,legacy=false,cycle){
    if(path.length===2&&path[0]==='checklists'&&value&&typeof value==='object')cycle=checklistOccurrence(value);
    if(path.length===5&&path[0]==='checklists'&&path[2]==='items'&&path[4]==='checked'&&cycle!==undefined){
      // A check belongs to an occurrence, not to all future uses of the item.
      // Independent devices can finish an old cycle while another has reset it.
      set(pathKey(path),{type:'checks'});
      set(pathKey([...path,cycle]),{type:'value',value:!!value});return;
    }
    const container=(type,members)=>{const old=fields[pathKey(path)]?.value;
      return {type,...(legacy?{legacyMembers:members}:old?.type===type&&old.legacyMembers?{legacyMembers:old.legacyMembers}:{})};};
    if(Array.isArray(value)){
      const isSet=['parentIds','relatedTaskIds','skipTypes'].includes(path.at(-1));
      const ids=value.map(x=>x?.id),isList=!isSet&&(value.length?ids.every(id=>typeof id==='string'&&id)&&new Set(ids).size===ids.length:['items','checklists','projects'].includes(path.at(-1))||fields[pathKey(path)]?.value?.type==='list');
      if(isSet){const members=[...new Set(value)].filter(x=>typeof x==='string'&&!unsafe(x));set(pathKey(path),container('set',members));for(const id of members)set(pathKey([...path,id]),{type:'value',value:true});return;}
      if(isList){const order=positions(ids,path,fields);set(pathKey(path),container('list',ids));
        value.forEach(item=>{flatten(item,[...path,item.id],fields,set,legacy,cycle);set(orderKey([...path,item.id]),order.get(item.id));});return;}
      set(pathKey(path),{type:'value',value:clone(value)});return;
    }
    if(value&&typeof value==='object'){
      set(pathKey(path),container('object',Object.keys(value).filter(k=>k!=='rt'&&!unsafe(k))));
      for(const [k,v]of Object.entries(value))if(k!=='rt'&&!unsafe(k))flatten(v,[...path,k],fields,set,legacy,cycle);
      return;
    }
    set(pathKey(path),{type:'value',value:value??null});
  }
  function upgrade(state){
    if(state.schema===2)return state;
    const out={schema:2,clock:state.clock,records:{}};
    for(const [key,r]of Object.entries(state.records)){
      const fields={};out.records[key]={fields};
      if(r.fields._alive)fields._alive=clone(r.fields._alive);
      const parts=Object.entries(r.fields).filter(([k])=>key.startsWith('notes/')&&k.startsWith('part:'));
      for(const [name,f]of Object.entries(r.fields)){
        if(name==='_alive'||name==='rt'||unsafe(name)||parts.length&&(name==='parts'||name.startsWith('part:')))continue;
        if(f.deleted)fields[pathKey([name])]={...clone(f),value:{type:'value',value:null}};
        else flatten(f.value,[name],{},(k,v)=>{fields[k]={stamp:clone(f.stamp),value:v,deleted:false};},true);
      }
      if(parts.length){let stamp=parts[0][1].stamp;for(const [,f]of parts)if(newer(f.stamp,stamp))stamp=f.stamp;
        fields[pathKey(['parts'])]={stamp:clone(stamp),value:{type:'object'},deleted:false};
        for(const [name,f]of parts){const path=['parts',name.slice(5)];
          if(f.deleted)fields[pathKey(path)]={...clone(f),value:{type:'object'}};
          else flatten(f.value,path,{},(k,v)=>{fields[k]={stamp:clone(f.stamp),value:v,deleted:false};},true);
        }
      }
    }return out;
  }
  function capture(input,data,device){
    const state=upgrade(input),next=clone(state),seen=new Set(),clock=state.clock+1;let changed=false;
    for(const type of collections)for(const original of data[type]||[]){
      if(!original.id)continue;const key=type+'/'+original.id;seen.add(key);
      const record=next.records[key] ||= {fields:{}},fieldsSeen=new Set(['_alive']);
      const set=(name,value,deleted=false)=>{fieldsSeen.add(name);const old=record.fields[name];
        if(!old||!!old.deleted!==deleted||stable(old.value)!==stable(value)){
          const checked=name[0]==='['&&checkPath(JSON.parse(name));
          record.fields[name]={stamp:[clock,device],value,deleted,...(checked?{at:Date.now()}: {})};changed=true;}};
      set('_alive',true);
      const row={...original};
      if(type==='tasks'&&row.parentId&&!Array.isArray(row.parentIds))row.parentIds=[row.parentId];
      for(const [k,v]of Object.entries(row))if(k!=='rt'&&k!=='id'&&!unsafe(k))flatten(v,[k],record.fields,set);
      for(const [name,f]of Object.entries(record.fields))if(!fieldsSeen.has(name)&&!f.deleted){
        const order=name.startsWith('order:'),path=JSON.parse(order?name.slice(6):name);
        let hidden=false;for(let n=order?path.length:path.length-1;n>0;n--){const parent=record.fields[pathKey(path.slice(0,n))];
          if(parent?.deleted||['value','checks'].includes(parent?.value?.type)){hidden=true;break;}}
        if(!hidden)set(name,f.value,true);
      }
    }
    for(const [key,record]of Object.entries(next.records))if(!seen.has(key)&&record.fields._alive?.value!==false){record.fields._alive={stamp:[clock,device],value:false,deleted:false};changed=true;}
    if(changed)next.clock=clock;return pruneChecks(next);
  }
  function merge(a,b){
    a=upgrade(a);b=upgrade(b);const out=clone(a);out.clock=Math.max(a.clock,b.clock);
    for(const [key,record]of Object.entries(b.records)){
      const dst=out.records[key] ||= {fields:{}};
      for(const [k,v]of Object.entries(record.fields))if(newer(v.stamp,dst.fields[k]?.stamp))dst.fields[k]=clone(v);
    }
    // A schema-1 container snapshot implicitly deleted members it no longer
    // contained. Materialize that evidence as tombstones when an older peer
    // brings those members back during migration.
    for(const r of Object.values(out.records)){
      const walk=(node,path)=>{const f=node.field;
        for(const [key,child]of node.children){const p=[...path,key];
          if(f?.value.legacyMembers&&!f.value.legacyMembers.includes(key)&&child.field&&!newer(child.field.stamp,f.stamp)){
            r.fields[pathKey(p)]={...clone(child.field),stamp:clone(f.stamp),deleted:true};
          }else walk(child,p);
        }
      };walk(tree(r.fields),[]);
    }
    return pruneChecks(out);
  }
  function materialize(input,local){
    const state=upgrade(input),out=clone(local);collections.forEach(k=>out[k]=[]);
    for(const [key,r]of Object.entries(state.records)){
      const at=key.indexOf('/'),type=key.slice(0,at),id=key.slice(at+1);
      if(!collections.includes(type)||r.fields._alive?.value===false)continue;
      const row={id,...valueOf(tree(r.fields),true)},old=(local[type]||[]).find(x=>x.id===id);
      if(type==='tasks'&&Array.isArray(row.parentIds))row.parentId=row.parentIds.includes(row.parentId)?row.parentId:row.parentIds[0]||null;
      const prepared=runtime(row,old);
      if(type==='tasks')for(const c of prepared.checklists||[]){
        const occurrence=checklistOccurrence(c);let latest=0;
        for(const item of c.items||[]){
          if(item.checked&&typeof item.checked==='object')item.checked=!!item.checked[occurrence];
          if(item.checked)latest=Math.max(latest,r.fields[pathKey(['checklists',c.id,'items',item.id,'checked',occurrence])]?.at||0);
        }
        const completion=state.records['completions/checklist:'+id+':'+c.id+':'+occurrence];
        const active=completion&&valueOf(tree(completion.fields),true).active;
        const oldTask=state.records['completions/task:'+id+':once'];
        const legacy=oldTask&&valueOf(tree(oldTask.fields),true);
        if(latest&&c.items.length&&c.items.every(i=>i.checked)&&!active&&!(legacy?.active&&legacy.legacy)){
          c.rt=c.rt||{};c.rt.mergedCheckAt=latest;
        }
      }
      out[type].push(prepared);
    }return out;
  }
  function validate(s){
    if(Number.isInteger(s?.schema)&&s.schema>2)throw Error('נתוני הענן נוצרו בגרסה חדשה יותר. עדכן את משימה בכל המכשירים כדי להמשיך בסנכרון.');
    if(![1,2].includes(s?.schema)||!Number.isSafeInteger(s.clock)||s.clock<0||!s.records||typeof s.records!=='object'||Array.isArray(s.records))throw Error('נתוני סנכרון לא תקינים');
    for(const [key,r]of Object.entries(s.records)){
      if(!collections.includes(key.split('/')[0])||!r?.fields||typeof r.fields!=='object'||Array.isArray(r.fields))throw Error('רשומת סנכרון לא תקינה');
      for(const [k,v]of Object.entries(r.fields)){
        if(unsafe(k)||!v||!Array.isArray(v.stamp)||!Number.isSafeInteger(v.stamp[0])||v.stamp[0]<0||v.stamp[0]>s.clock||typeof v.stamp[1]!=='string')throw Error('חותמת סנכרון לא תקינה');
        if(v.at!==undefined&&(!Number.isSafeInteger(v.at)||v.at<=0||Number.isNaN(new Date(v.at).getTime())))throw Error('תאריך סימון בסנכרון אינו תקין');
        if(s.schema===2&&k!=='_alive'){
          let path;try{path=JSON.parse(k.startsWith('order:')?k.slice(6):k);}catch{throw Error('שדה סנכרון לא תקין');}
          if(!Array.isArray(path)||!path.length||path.some(p=>typeof p!=='string'||unsafe(p)))throw Error('נתיב סנכרון לא תקין');
          if(k.startsWith('order:')?!Number.isFinite(v.value):!['value','object','list','set','checks'].includes(v.value?.type))throw Error('ערך סנכרון לא תקין');
          if(v.value?.legacyMembers!==undefined&&(!Array.isArray(v.value.legacyMembers)||v.value.legacyMembers.some(p=>typeof p!=='string'||unsafe(p))))throw Error('רשימת שדות בסנכרון אינה תקינה');
        }
      }
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
      if(!document.querySelector('#modal.on')&&!document.activeElement?.isContentEditable&&!(typeof NoteView!=='undefined'&&NoteView.editing)){
        state=SyncModel.merge(SyncModel.capture(state,Store.all,device),combined);
        const next=SyncModel.materialize(state,Store.all);
        if(SyncModel.stable(next)!==SyncModel.stable(Store.all)){
          applying=true;try{Store.import(JSON.stringify(next),{reconcileChecklists:true});}finally{applying=false;}
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
