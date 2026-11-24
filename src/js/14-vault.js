/* כספת — פתקים סודיים מוצפנים בסיסמה. The decrypted text lives only in
   memory while the vault is open; it locks after a minute without activity,
   when leaving the vault screen and when the app goes to the background. */
const Vault=(()=>{
  const $=s=>document.querySelector(s);
  const IDLE=60000,FAILS='mesima.vaultFails';
  const keys=new Map(),items=new Map();
  let query='',idleTimer=0,busy=0,lastSecrets='',gen=0,inFlight=false;
  const esc=s=>UI.esc(s);
  const isSetUp=()=>Store.vaultKeys().length>0;
  const unlocked=()=>keys.size>0;
  const primary=()=>Store.vaultKeys().find(k=>keys.has(k.id))?.id;
  const first=t=>String(t||'').trim().split('\n')[0].slice(0,80)||'ללא כותרת';
  /* A secret is {text} (plain) or a formatted note moved from הערות:
     {text,title,html} or {text,title,parts:[{title,html}]}. text is the plain
     version used for search and copy. */
  const rich=v=>!!v&&(typeof v.html==='string'||Array.isArray(v.parts));
  const label=v=>(v?.title||'').trim().slice(0,80)||first(v?.text);
  function plain(html){
    const t=document.createElement('template');
    t.innerHTML=String(html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi,'$&\n');
    return (t.content.textContent||'').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  }
  function textOf(v){
    if(!rich(v))return String(v?.text||'');
    const body=v.parts?v.parts.map(p=>[p.title,plain(p.html)].filter(Boolean).join('\n')).join('\n\n'):plain(v.html);
    return [v.title,body].filter(Boolean).join('\n').trim();
  }
  // Only the fields a secret may carry; html is cleaned with the notes sanitizer.
  function payload(v){
    if(!rich(v))return {text:String(v?.text??v??'')};
    const out={title:String(v.title||'').trim()};
    if(Array.isArray(v.parts))out.parts=v.parts.map(p=>({title:String(p.title||'').trim(),html:NoteView.clean(p.html||'')}));
    else out.html=NoteView.clean(v.html||'');
    out.text=textOf(out);return out;
  }
  const MAX=700000;

  /* ---------- native helpers: fingerprint, protected screen ---------- */
  const N=()=>window.MesimaNative,D=()=>window.MesimaDesktop;
  const bioCan=()=>{try{return typeof N()?.vaultBioEnable==='function'&&!!N().vaultBioAvailable();}catch{return false;}};
  const bioOn=()=>{try{return bioCan()&&!!N().vaultBioEnabled();}catch{return false;}};
  let bioWait=null,autoBio=false;
  function bio(op,arg){return new Promise(res=>{bioWait=res;
    try{op==='enable'?N().vaultBioEnable(arg):N().vaultBioUnlock();}catch(e){bioWait=null;res({ok:false,error:e.message});}});}
  function secure(on){try{N()?.setSecure?.(!!on);}catch{}try{D()?.setSecure?.(!!on);}catch{}}
  // Fingerprint returns the stored password, which then unlocks like a typed one.
  async function bioUnlock(opts){
    const r=await bio('unlock');
    if(!r?.ok){
      if(r?.error==='invalidated')UI.toast('נוספה טביעת אצבע חדשה למכשיר, ולכן הפתיחה בטביעת אצבע כובתה. פתח בסיסמה והפעל מחדש');
      else if(r?.error&&r.error!=='cancel'&&r.error!=='off')UI.toast(r.error);
      return false;
    }
    try{await unlockWith(r.password,opts);return true;}
    catch(e){if(/שגויה/.test(e.message)){try{N().vaultBioDisable();}catch{}UI.toast('הסיסמה שונתה. פתח בסיסמה החדשה והפעל מחדש טביעת אצבע');}else UI.toast(e.message);return false;}
  }
  function bioOff(){if(bioOn()){try{N().vaultBioDisable();}catch{}return true;}return false;}

  /* ---------- attempts ---------- */
  function fails(){try{return JSON.parse(localStorage.getItem(FAILS))||{n:0,until:0};}catch{return {n:0,until:0};}}
  function waitLeft(){return Math.max(0,fails().until-Date.now());}
  function failed(){const f=fails();f.n++;if(f.n>=5)f.until=Date.now()+Math.min(3600000,30000*2**(f.n-5));
    try{localStorage.setItem(FAILS,JSON.stringify(f));}catch{}}
  function succeeded(){try{localStorage.removeItem(FAILS);}catch{}}
  function waitText(){const s=Math.ceil(waitLeft()/1000);return s>90?`נסה שוב בעוד ${Math.ceil(s/60)} דקות`:`נסה שוב בעוד ${s} שניות`;}

  /* ---------- keys and decryption ---------- */
  // gen changes on every lock; results of a slow derive/decrypt that finish
  // after a lock are dropped instead of re-opening the vault.
  async function unlockWith(password,{decrypt=true}={}){
    if(inFlight)throw Error('רגע…');
    if(waitLeft())throw Error('יותר מדי ניסיונות. '+waitText());
    inFlight=true;const g=gen;let ok=0;const found=[];
    try{
      for(const rec of Store.vaultKeys()){
        if(keys.has(rec.id)){ok++;continue;}
        try{const k=await VaultCrypto.unlock(rec,password);if(k){found.push([rec.id,k]);ok++;}}catch{}
      }
    }finally{inFlight=false;}
    if(g!==gen)throw Error('הכספת ננעלה');
    if(!ok){failed();throw Error(waitLeft()?'סיסמה שגויה. '+waitText():'סיסמה שגויה');}
    found.forEach(([id,k])=>keys.set(id,k));succeeded();touch();secure(true);
    if(decrypt){await decryptAll();await consolidate();}
    return true;
  }
  async function openBox(s){
    const order=[s.keyId,...[...keys.keys()].filter(k=>k!==s.keyId)];
    for(const keyId of order){const k=keys.get(keyId);if(!k)continue;
      const v=await VaultCrypto.open(k,keyId,s.id,s.box);if(v)return {v,keyId};}
    return null;
  }
  async function decryptAll(){
    const g=gen;
    for(const s of Store.secrets()){
      const cached=items.get(s.id);if(cached&&cached.box===s.box)continue;
      const r=await openBox(s);if(g!==gen)return;
      if(r)items.set(s.id,{...r.v,box:s.box,keyId:r.keyId});else items.delete(s.id);
    }
    for(const id of [...items.keys()])if(!Store.secret(id))items.delete(id);
    lastSecrets=signature();
  }
  // Two devices that created vaults offline end up with two keys. When the
  // password opens both, notes move to the oldest key and the extra key is
  // removed, so there is always one key and one recovery code.
  async function consolidate(){
    const keep=primary();if(!keep||keys.size<2)return;const g=gen;
    for(const s of Store.secrets()){const it=items.get(s.id);
      if(it&&it.keyId!==keep){await seal(it,s.id);if(g!==gen)return;}}
    for(const id of [...keys.keys()])if(id!==keep&&!Store.secrets().some(s=>s.keyId===id&&!items.has(s.id))){Store.delVaultKey(id);keys.delete(id);}
  }
  const signature=()=>Store.secrets().map(s=>s.id+':'+s.box.length+':'+s.updatedAt).join('|');
  function lock(){
    gen++;
    if(UI.screen!=='vault')autoBio=false;
    if(!unlocked()&&!items.size)return;
    // An open editor is sealed as it is, so a lock never throws away typing.
    const draft=readEditor(),edId=document.querySelector('[data-vedit]')?.dataset.id||'',keyId=primary(),k=keys.get(keyId);
    keys.clear();items.clear();clearTimeout(idleTimer);query='';
    if(draft&&k){const id=edId||Store.newId();VaultCrypto.seal(k,keyId,id,draft).then(box=>{Store.putSecret({id,keyId,box});UI.toast('הטיוטה נשמרה מוצפנת בכספת');}).catch(()=>{});}
    // The recovery-code dialog stays open: the user may be copying it.
    const body=Modal.body;if($('#modal.on')&&body?.querySelector('[data-vault]')&&!body.querySelector('#vSaved'))Modal.shut();
    const vb=$('#vaultBody');if(vb)vb.innerHTML='';
    if(!document.getElementById('vSaved'))secure(false);
    if(UI.screen==='vault')render();
  }
  function touch(){clearTimeout(idleTimer);if(unlocked())idleTimer=setTimeout(()=>{lock();UI.toast('הכספת ננעלה');},IDLE);}

  async function seal(value,id=Store.newId()){
    const keyId=primary(),g=gen;if(!keyId)throw Error('הכספת נעולה');
    const v=payload(typeof value==='string'?{text:value}:value);
    if(JSON.stringify(v).length>MAX)throw Error('ההערה גדולה מדי לכספת (כנראה בגלל תמונות). הסר תמונות ונסה שוב');
    const box=await VaultCrypto.seal(keys.get(keyId),keyId,id,v);
    if(g!==gen)throw Error('הכספת ננעלה לפני השמירה');
    Store.putSecret({id,keyId,box});items.set(id,{...v,box,keyId});lastSecrets=signature();return id;
  }

  /* ---------- password prompt for actions from outside the vault ---------- */
  function ask(title,{why='',onOk}){
    Modal.open({title,body:`<div data-vault>${why?`<div class="ex" style="margin-bottom:10px">${why}</div>`:''}
        <input type="password" id="vPw" autocomplete="current-password" placeholder="סיסמת הכספת" dir="auto">
        <div class="verr" id="vErr" role="alert"></div></div>`,
      buttons:[{label:'ביטול',act:()=>Modal.shut()},...(bioOn()?[{label:'טביעת אצבע',act:viaBio}]:[]),{label:'פתח',kind:'p',act:submit}]});
    const pw=$('#vPw');setTimeout(()=>pw?.focus(),60);
    if(bioOn())setTimeout(viaBio,150);
    async function viaBio(){busy++;try{if(await bioUnlock({decrypt:false})){Modal.shut();await onOk();}}finally{busy--;}}
    pw.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submit();}});
    async function submit(){
      const err=$('#vErr');err.textContent='פותח…';
      busy++;try{await unlockWith(pw.value,{decrypt:false});Modal.shut();await onOk();}
      catch(e){if(document.getElementById('vErr')){err.textContent=e.message||'לא נפתח';pw.select();}}
      finally{busy--;}
    }
  }
  /* Runs fn with the vault open; locks again afterwards unless the user is in the vault. */
  async function withKey(fn,why){
    if(!isSetUp()){UI.toast('צור קודם כספת בספרייה');UI.screen='vault';UI.render();return false;}
    const done=async()=>{busy++;try{await fn();}catch(e){UI.toast(e.message||'הפעולה נכשלה');}finally{busy--;if(UI.screen!=='vault')lock();}};
    if(unlocked()){await done();return true;}
    ask('פתיחת הכספת',{why,onOk:done});return true;
  }
  async function storeText(text,after){
    const value=String(text||'').trim();if(!value)return false;
    return withKey(async()=>{await seal(value);UI.toast('נשמר בכספת · מוצפן');after?.();},'הטקסט יישמר מוצפן בכספת.');
  }

  /* Moves a note from הערות into the vault, formatting and parts included.
     The note is removed only after the encrypted copy is saved. */
  async function moveNote(id,after){
    const n=Store.note(id);if(!n)return false;
    const v=n.multipart?{title:n.title,parts:NoteView.parts(n).map(p=>({title:p.title,html:p.html}))}:{title:n.title,html:n.html||''};
    if(!textOf(payload(v)).trim()&&!/<img/i.test(JSON.stringify(v))){UI.toast('ההערה ריקה');return false;}
    return withKey(async()=>{
      if(!Store.note(id))throw Error('ההערה כבר לא קיימת');
      await seal(v);Store.delNote(id);after?.();UI.toast('ההערה הועברה לכספת · מוצפנת');
    },'ההערה תוצפן ותעבור לכספת, עם העיצוב שלה, ותימחק מרשימת ההערות.');
  }
  function backToNotes(id){
    const v=items.get(id);if(!v||!Store.secret(id))return;
    Modal.open({title:'להחזיר להערות?',body:'<div data-vault><p class="ex">הפתק יוצא מהכספת ויהיה גלוי שוב לכל מי שפותח את האפליקציה.</p></div>',
      buttons:[{label:'ביטול',act:()=>Modal.shut()},{label:'החזר להערות',kind:'p',act:()=>{
        const n=Store.addNote({title:v.title||first(v.text),html:v.parts?'':(rich(v)?v.html:esc(v.text).replace(/\n/g,'<br>'))});
        if(v.parts){const now=Date.now(),parts={};v.parts.forEach((p,i)=>{const pid=crypto.randomUUID();parts[pid]={id:pid,title:p.title,html:p.html,order:i,createdAt:now+i,updatedAt:now};});
          Store.updateNote(n.id,{multipart:true,parts});}
        Store.delSecret(id);items.delete(id);lastSecrets=signature();Modal.shut();render();UI.toast('הוחזר להערות');}}]});
  }

  // Copied secrets are wiped from the clipboard after 30 seconds (best effort).
  let clipTimer=0;
  async function copySecret(text,msg='הועתק · הלוח יתנקה בעוד 30 שניות'){
    const native=typeof N()?.copySensitive==='function';
    try{if(native){if(!N().copySensitive(text))throw 0;}else await navigator.clipboard.writeText(text);
      UI.toast(msg);clearTimeout(clipTimer);
      clipTimer=setTimeout(()=>{try{native?N().copySensitive(''):navigator.clipboard.writeText('').catch(()=>{});}catch{}},30000);}
    catch{UI.toast('העתקה לא זמינה — העתק ידנית');}
  }

  /* ---------- recovery code display ---------- */
  function showCode(code,then,onConfirm){
    secure(true);
    Modal.open({title:'קוד השחזור שלך',body:`<div data-vault>
        <p class="ex">אם תשכח את הסיסמה, רק הקוד הזה פותח את הכספת. שמור אותו מחוץ לטלפון ולמחשב — הדפס, כתוב על דף, או שמור במנהל סיסמאות. הוא לא יוצג שוב.</p>
        <div class="vcode" dir="ltr">${esc(code)}</div>
        <button class="btn wide" id="vCopy">העתק</button>
        <label class="vchk"><input type="checkbox" id="vSaved"> שמרתי את הקוד במקום בטוח</label>
        <div class="verr" id="vErr" role="alert"></div></div>`,
      buttons:[{label:'סיום',kind:'p',act:()=>{if(!$('#vSaved').checked){$('#vErr').textContent='סמן שהקוד שמור לפני שממשיכים';return;}onConfirm?.();Modal.shut();secure(unlocked());then?.();}}]});
    Modal.closeGuard=()=>{if($('#vSaved')?.checked)return true;$('#vErr').textContent='סמן שהקוד שמור לפני שממשיכים';return false;};
    $('#vCopy').addEventListener('click',()=>copySecret(code,'הועתק — הדבק במקום בטוח. הלוח יתנקה בעוד 30 שניות'));
  }

  /* ---------- screen ---------- */
  function render(){
    const box=$('#vaultBody');if(!box)return;
    if(!isSetUp())return void(box.innerHTML=setupView());
    if(!unlocked()){box.innerHTML=lockedView();
      if(bioOn()&&!autoBio&&!waitLeft()){autoBio=true;setTimeout(()=>{if(UI.screen==='vault'&&!unlocked())bioUnlock().then(ok=>{if(ok)render();});},200);}
      return;}
    box.innerHTML=listView();
  }
  function setupView(){
    return `<div class="vintro"><div class="vico">🔒</div><h2>כספת לפתקים רגישים</h2>
      <p>סיסמאות, מספרים, פרטים אישיים — כל מה שלא צריך להיות גלוי למי שמחזיק את הטלפון או יושב מול המחשב.</p>
      <ul><li>כל פתק מוצפן בסיסמה שלך לפני שהוא נשמר או מסתנכרן.</li><li>הכספת ננעלת לבד אחרי דקה בלי שימוש.</li>
      <li>אחרי יצירת הכספת תקבל קוד שחזור. בלי הסיסמה ובלי הקוד אי אפשר לפתוח אותה — גם לא אנחנו.</li></ul></div>
      <form id="vSetup" class="vform" autocomplete="off">
        <input type="password" id="vNew1" autocomplete="new-password" placeholder="סיסמה חדשה (לפחות 8 תווים)" dir="auto">
        <input type="password" id="vNew2" autocomplete="new-password" placeholder="שוב את אותה סיסמה" dir="auto">
        <div class="verr" id="vErr" role="alert"></div>
        <button class="btn p wide" type="submit">צור כספת</button></form>`;
  }
  function lockedView(){
    const wait=waitLeft();
    return `<div class="vintro"><div class="vico">🔒</div><h2>הכספת נעולה</h2>
      <p>${Store.secrets().length?Store.secrets().length+' פתקים מוצפנים':'אין עדיין פתקים'}</p></div>
      <form id="vUnlock" class="vform" autocomplete="off">
        <input type="password" id="vPwMain" autocomplete="current-password" placeholder="סיסמת הכספת" dir="auto">
        <div class="verr" id="vErr" role="alert">${wait?esc('יותר מדי ניסיונות. '+waitText()):''}</div>
        <button class="btn p wide" type="submit">פתח</button>
        ${bioOn()?'<button class="btn wide" type="button" data-vact="bio">פתח בטביעת אצבע</button>':''}
        <button class="txtbtn" type="button" data-vact="forgot">שכחתי את הסיסמה</button></form>`;
  }
  function listView(){
    const q=query.trim().toLowerCase();
    const rows=Store.secrets().filter(s=>items.has(s.id)).map(s=>({s,v:items.get(s.id)}))
      .filter(({v})=>!q||String(v.text||'').toLowerCase().includes(q)).sort((a,b)=>b.s.updatedAt-a.s.updatedAt);
    const hidden=Store.secrets().filter(s=>!items.has(s.id)).length;
    return `<div class="vbar"><input type="search" id="vSearch" placeholder="חיפוש בכספת" value="${esc(query)}" autocomplete="off">
        <button class="btn" data-vact="lock">נעל</button></div>
      <button class="btn p wide" data-vact="new" style="margin:10px 0 14px">+ פתק סודי</button>
      ${rows.length?rows.map(({s,v})=>`<button class="row vrow" data-vitem="${esc(s.id)}" style="width:100%;text-align:start">
        <div class="bd"><div class="t">${esc(label(v))}</div><div class="m">${rich(v)?'הערה · ':''}${esc(UI.fmtDate(s.updatedAt))}</div></div><span class="chev">‹</span></button>`).join('')
        :`<div class="empty"><div class="d">${q?'אין התאמות':'אין עדיין פתקים סודיים. אפשר לשלוח ישר לכספת ממסך הפתקים (🔒), או להעביר הערה קיימת דרך התפריט ⋯ שלה.'}</div></div>`}
      ${hidden?`<div class="ex" style="margin-top:10px">${hidden} פתקים לא נפתחו: ${Store.secrets().some(s=>!items.has(s.id)&&!Store.vaultKeys().some(k=>k.id===s.keyId))?'המפתח שלהם לא נמצא (אולי שוחזר גיבוי ישן).':'הם מוצפנים בסיסמה אחרת.'}</div>`:''}
      <h2 class="sh" style="margin-top:26px">אבטחה</h2>
      <button class="row" data-vact="password" style="width:100%;text-align:start"><div class="bd"><div class="t">שינוי סיסמה</div></div><span class="chev">‹</span></button>
      <button class="row" data-vact="recovery" style="width:100%;text-align:start"><div class="bd"><div class="t">קוד שחזור חדש</div><div class="m">הקוד הקודם יפסיק לעבוד</div></div><span class="chev">‹</span></button>
      ${bioCan()?`<div class="set" style="margin-top:6px"><div class="sb"><div class="st">פתיחה בטביעת אצבע</div><div class="sd">במכשיר הזה בלבד. הסיסמה נשמרת במנעול של Android ונפתחת רק בטביעת אצבע</div></div>
        <button class="sw" data-vact="bio-toggle" aria-checked="${bioOn()}"></button></div>`:''}`;
  }

  /* ---------- note view / edit ---------- */
  function bodyHtml(v){
    if(!rich(v))return `<div class="vtext">${esc(v.text).replace(/\n/g,'<br>')}</div>`;
    if(v.parts)return v.parts.map(p=>`<section class="vpart"><h3>${esc(p.title||'ללא כותרת')}</h3><article class="note-reading">${NoteView.clean(p.html)}</article></section>`).join('');
    return `<article class="note-reading vrich">${NoteView.clean(v.html)||'<p class="note">אין תוכן</p>'}</article>`;
  }
  function view(id){
    const v=items.get(id),s=Store.secret(id);if(!v||!s)return;
    Modal.open({title:label(v),body:`<div data-vault>${bodyHtml(v)}
        <div class="m" style="margin-top:8px">עודכן ${esc(UI.fmtDate(s.updatedAt))}</div>
        <button class="txtbtn" data-vact="to-notes" data-id="${esc(id)}" style="margin-top:6px">החזר להערות</button></div>`,
      buttons:[{label:'מחק',act:()=>{Modal.shut();const copy=Store.delSecret(id);items.delete(id);render();
          UI.undo('הפתק הסודי נמחק',()=>{Store.restoreSecret(copy);decryptAll().then(render);});}},
        {label:'העתק',act:()=>copySecret(v.text)},
        {label:'ערוך',kind:'p',act:()=>edit(id)}]});
  }
  // Whatever is in the open editor, as a payload (or null when empty).
  function readEditor(){
    const root=document.querySelector('[data-vedit]');if(!root)return null;
    if(root.dataset.vedit==='plain'){const t=root.value.trim();return t?{text:t}:null;}
    const title=root.querySelector('.vtitle')?.value.trim()||'';
    const v=root.dataset.vedit==='parts'
      ?{title,parts:[...root.querySelectorAll('[data-vpart]')].map(p=>({title:p.querySelector('.vptitle').value.trim(),html:p.querySelector('.vbody').innerHTML}))}
      :{title,html:root.querySelector('.vbody').innerHTML};
    const out=payload(v);return out.text.trim()||/<img/i.test(JSON.stringify(out))?out:null;
  }
  function edit(id){
    const v=id?items.get(id):null,eid=id?esc(id):'';
    const ed=!rich(v)?`<textarea id="vText" data-vedit="plain" data-id="${eid}" rows="8" dir="auto" placeholder="מה לשמור בסוד?">${v?esc(v.text):''}</textarea>`
      :`<div data-vedit="${v.parts?'parts':'rich'}" data-id="${eid}" class="vedit"><input class="vtitle" value="${esc(v.title||'')}" placeholder="כותרת" dir="auto">
        ${v.parts?v.parts.map(p=>`<div data-vpart class="vpart"><input class="vptitle" value="${esc(p.title||'')}" placeholder="כותרת החלק" dir="auto"><div class="vbody note-reading" contenteditable="true" dir="auto">${NoteView.clean(p.html)}</div></div>`).join('')
          :`<div class="vbody note-reading" contenteditable="true" dir="auto">${NoteView.clean(v.html)}</div>`}</div>`;
    Modal.open({title:id?'עריכת פתק סודי':'פתק סודי חדש',body:`<div data-vault>${ed}<div class="verr" id="vErr" role="alert"></div></div>`,
      buttons:[{label:'ביטול',act:()=>Modal.shut()},{label:'שמור',kind:'p',act:async()=>{
        const p=readEditor();if(!p){$('#vErr').textContent='פתק ריק לא נשמר';return;}
        try{await seal(p,id||undefined);Modal.shut();render();UI.toast(id?'נשמר':'נשמר בכספת');}catch(e){$('#vErr').textContent=e.message;}}}]});
    setTimeout(()=>($('#vText')||document.querySelector('[data-vedit] .vbody'))?.focus(),60);
  }

  /* ---------- password / recovery flows ---------- */
  function form(title,fields,submitLabel,run){
    Modal.open({title,body:`<div data-vault>${fields.map(f=>f.note?`<p class="ex">${f.note}</p>`:
        `<input type="${f.type||'password'}" id="${f.id}" placeholder="${f.ph}" autocomplete="${f.ac||'off'}" dir="${f.dir||'auto'}">`).join('')}
        <div class="verr" id="vErr" role="alert"></div></div>`,
      buttons:[{label:'ביטול',act:()=>Modal.shut()},{label:submitLabel,kind:'p',act:go}]});
    setTimeout(()=>document.getElementById(fields.find(f=>f.id).id)?.focus(),60);
    async function go(){const err=$('#vErr');err.textContent='רגע…';
      try{await run(id=>document.getElementById(id).value);}catch(e){err.textContent=e.message||'נכשל';}}
  }
  const same=(a,b)=>{if(a!==b)throw Error('הסיסמאות לא זהות');if(a.length<8)throw Error('הסיסמה צריכה לפחות 8 תווים');};
  function forgot(){
    form('שחזור עם קוד השחזור',[{note:'הקלד את קוד השחזור שקיבלת כשיצרת את הכספת, ובחר סיסמה חדשה.'},
      {id:'vRc',ph:'קוד שחזור',type:'text',dir:'ltr'},{id:'vN1',ph:'סיסמה חדשה',ac:'new-password'},{id:'vN2',ph:'שוב את הסיסמה החדשה',ac:'new-password'}],'שחזר',async val=>{
      // The 160-bit recovery code needs no attempt throttle.
      same(val('vN1'),val('vN2'));let ok=0;
      for(const rec of Store.vaultKeys()){const next=await VaultCrypto.setPassword(rec,val('vRc'),true,val('vN1'));if(next){Store.setVaultKey(next);ok++;}}
      if(!ok)throw Error('קוד השחזור לא מתאים');
      succeeded();const hadBio=bioOff();await unlockWith(val('vN1'));Modal.shut();render();UI.toast('הסיסמה הוחלפה'+(hadBio?' · הפעל מחדש טביעת אצבע':''));});
  }
  function changePassword(){
    form('שינוי סיסמה',[{id:'vOld',ph:'הסיסמה הנוכחית',ac:'current-password'},{id:'vN1',ph:'סיסמה חדשה',ac:'new-password'},{id:'vN2',ph:'שוב את הסיסמה החדשה',ac:'new-password'}],'שנה',async val=>{
      if(waitLeft())throw Error('יותר מדי ניסיונות. '+waitText());
      same(val('vN1'),val('vN2'));let ok=0;
      for(const rec of Store.vaultKeys()){const next=await VaultCrypto.setPassword(rec,val('vOld'),false,val('vN1'));if(next){Store.setVaultKey(next);ok++;}}
      if(!ok){failed();throw Error('הסיסמה הנוכחית שגויה');}
      succeeded();Modal.shut();UI.toast('הסיסמה שונתה · קוד השחזור לא השתנה'+(bioOff()?' · הפעל מחדש טביעת אצבע':''));render();});
  }
  function newRecovery(){
    form('קוד שחזור חדש',[{note:'הקוד הקודם יפסיק לעבוד. יוצג קוד חדש פעם אחת.'},{id:'vOld',ph:'סיסמת הכספת',ac:'current-password'}],'צור קוד',async val=>{
      if(waitLeft())throw Error('יותר מדי ניסיונות. '+waitText());
      const rec=Store.vaultKeys().find(k=>k.id===primary());const out=rec&&await VaultCrypto.newRecovery(rec,val('vOld'));
      if(!out){failed();throw Error('הסיסמה שגויה');}
      // The new code replaces the old one only after the user confirms it is saved.
      succeeded();showCode(out.recovery,null,()=>{const cur=Store.vaultKeys().find(k=>k.id===out.record.id);if(cur)Store.setVaultKey({...cur,rc:out.record.rc});UI.toast('קוד השחזור הוחלף');});});
  }

  function toggleBio(){
    if(bioOn()){try{N().vaultBioDisable();}catch{}UI.toast('פתיחה בטביעת אצבע כובתה');render();return;}
    form('הפעלת טביעת אצבע',[{note:'הקלד את סיסמת הכספת. היא תישמר מוצפנת במנעול של Android ותיפתח רק בטביעת אצבע.'},{id:'vOld',ph:'סיסמת הכספת',ac:'current-password'}],'המשך',async val=>{
      const rec=Store.vaultKeys().find(k=>k.id===primary());if(!rec||!await VaultCrypto.unlock(rec,val('vOld')))throw Error('הסיסמה שגויה');
      const pw=val('vOld');Modal.shut();const r=await bio('enable',pw);
      UI.toast(r?.ok?'מעכשיו אפשר לפתוח בטביעת אצבע':(r?.error==='cancel'?'בוטל':(r?.error||'לא הופעל')));render();});
  }

  /* ---------- wiring ---------- */
  function init(){
    document.addEventListener('submit',async e=>{
      if(e.target.id==='vSetup'){e.preventDefault();const a=$('#vNew1').value,b=$('#vNew2').value,err=$('#vErr');
        try{same(a,b);if(isSetUp())throw Error('כבר קיימת כספת');err.textContent='יוצר…';
          const {record,key,recovery}=await VaultCrypto.create(Store.newId(),a);
          Store.setVaultKey(record);keys.set(record.id,key);touch();showCode(recovery,()=>render());render();}
        catch(x){err.textContent=x.message;}}
      if(e.target.id==='vUnlock'){e.preventDefault();const err=$('#vErr'),pw=$('#vPwMain');err.textContent='פותח…';
        try{await unlockWith(pw.value);render();}catch(x){err.textContent=x.message;pw.select();}}
    });
    document.addEventListener('click',e=>{
      const t=e.target;if(!t.closest('#s-vault')&&!t.closest('#modal'))return;
      if(unlocked())touch();
      const a=t.closest('[data-vact]');
      if(a){const k=a.dataset.vact;
        if(k==='lock'){autoBio=true;lock();UI.toast('הכספת ננעלה');}
        else if(k==='bio')bioUnlock().then(ok=>{if(ok)render();});
        else if(k==='bio-toggle')toggleBio();
        else if(k==='new')edit(null);
        else if(k==='forgot')forgot();
        else if(k==='password')changePassword();
        else if(k==='recovery')newRecovery();
        else if(k==='to-notes')backToNotes(a.dataset.id);
        return;}
      const it=t.closest('[data-vitem]');if(it)view(it.dataset.vitem);
    });
    document.addEventListener('input',e=>{if(e.target.closest?.('#s-vault,#modal')&&unlocked())touch();
      if(e.target.id==='vSearch'){query=e.target.value;const pos=e.target.selectionStart;render();const s=$('#vSearch');s.focus();s.setSelectionRange(pos,pos);}});
    // While the system fingerprint dialog is up the app may count as hidden; that is not leaving.
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&!bioWait)lock();});
    window.__vaultLock=()=>{if(!bioWait)lock();};
    window.__vaultBio=r=>{const w=bioWait;bioWait=null;w?.(r);};
    // Leaving the vault screen locks it (actions from other screens lock themselves).
    setInterval(()=>{if(unlocked()&&!busy&&UI.screen!=='vault')lock();},800);
    Store.onChange(()=>{if(unlocked()&&signature()!==lastSecrets)decryptAll().then(()=>{if(UI.screen==='vault'&&!UI.typing())render();});});
  }
  return {init,render,lock,storeText,moveNote,withKey,isSetUp,unlocked};
})();
