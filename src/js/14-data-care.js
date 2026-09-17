/* Version 4.5: device backups, opt-in archive retention and cloud controls.
   Local data remains authoritative. Cloud operations are explicit snapshots,
   never an implicit two-way sync or replacement of the local database. */
const DataCare = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bridge = () => window.MesimaNative || window.DesktopBackup;
  let pendingDays=0;
  const available = () => typeof bridge()?.backupStatus === 'function';
  const status = () => {try{return available()?JSON.parse(bridge().backupStatus()):{};}catch{return {};}};
  const date = n => n ? new Date(n).toLocaleString('he-IL') : 'עדיין לא נוצר';
  const retentionOptions = [[0,'לעולם לא'],[30,'אחרי 30 יום'],[90,'אחרי 90 יום'],[180,'אחרי חצי שנה'],[365,'אחרי שנה']];
  let lastPurge=0;

  // Delete a family only when EVERY descendant is expired. Unknown dates and
  // cycles are retained; a recently archived or active child protects its parent.
  function expiredIds(tasks,days,now=Date.now()){
    if(!retentionOptions.some(([n])=>n===days) || !days) return [];
    const limit=now-days*86400000, children=new Map(), byId=new Map(tasks.map(t=>[t.id,t]));
    tasks.forEach(t=>{if(t.parentId){if(!children.has(t.parentId)) children.set(t.parentId,[]);children.get(t.parentId).push(t);}});
    const expired=t=>t.archived && Number.isFinite(t.archivedAt) && t.archivedAt>0 && t.archivedAt<=limit;
    const safe=(t,path=new Set())=>{
      if(path.has(t.id)||!expired(t)) return false;
      const next=new Set(path).add(t.id);
      return (children.get(t.id)||[]).every(c=>safe(c,next));
    };
    return tasks.filter(t=>{
      if((t.parentIds||[]).some(id=>!byId.get(id)?.archived))return false;
      // A descendant of an archived parent follows the whole family's retention.
      let top=t, seen=new Set();
      while(top.parentId && byId.get(top.parentId)?.archived){
        if(seen.has(top.id))return false;seen.add(top.id);top=byId.get(top.parentId);
      }
      return safe(top);
    }).map(t=>t.id);
  }
  function purge(now=Date.now(),force=false){
    if(!force && now-lastPurge<3600000) return 0;
    lastPurge=now;
    const ids=expiredIds(Store.all.tasks,Number(Store.all.prefs.archiveDays||0),now);
    if(!ids.length) return 0;
    // A recovery copy is required before deletion. Failure leaves archive intact.
    try{localStorage.setItem('mesima.before-archive-cleanup',Store.export());}
    catch{UI.toast('ניקוי הארכיון נדחה: אין מקום לעותק שחזור');return 0;}
    const kill=new Set(ids);
    Store.all.tasks=Store.all.tasks.filter(t=>!kill.has(t.id));
    Store.all.prefs.lastArchiveCleanup=now;Store.commit();return ids.length;
  }
  function snapshot(){
    if(!available()) return;
    try{bridge().saveSnapshot(Store.export());}catch{ /* status shows native write failure */ }
  }
  function settingsHTML(){
    const s=status(), cloud=s.cloud||{};
    return `<h2 class="sh">גיבוי אוטומטי לנייד</h2>
      ${available()?`<div class="notice">בחר תיקייה ותקופת גיבוי. כל גיבוי הוא קובץ חדש הכולל גם תמונות.
      ${window.MesimaDesktop?'הגיבוי פועל כל עוד משימה רצה, גם כשהחלון סגור לשורת המערכת.':'אנדרואיד עשוי לדחות את ההרצה כדי לחסוך בסוללה.'}</div>
      <button class="btn wide" data-care="folder">${s.folder?'שנה תיקיית גיבוי':'בחר תיקיית גיבוי'}</button>
      <div class="sd">${s.folder?'תיקייה נבחרה':'טרם נבחרה תיקייה'} · גיבוי אחרון: ${esc(date(s.lastLocal))}</div>
      <label for="backupDays">תדירות</label><select id="backupDays">${[[0,'כבוי'],[1,'כל יום'],[7,'כל שבוע'],[30,'כל חודש (30 יום)']].map(([n,t])=>`<option value="${n}" ${s.days===n?'selected':''}>${t}</option>`).join('')}</select>
      <button class="btn wide" data-care="local-now" ${!s.folder?'disabled':''}>גבה עכשיו לתיקייה</button>
      ${s.error?`<div class="notice warn">${esc(s.error)}</div>`:''}`:
      `<div class="notice">גיבוי לתיקייה ברקע זמין באפליקציית Android מגרסת מעטפת 1.2.
       כאן אפשר להמשיך לייצא גיבוי ידני.</div>`}
      <h2 class="sh">ניקוי הארכיון</h2>
      <label for="archiveDays">מחק לצמיתות פריטים שנמצאים בארכיון</label>
      <select id="archiveDays">${retentionOptions.map(([n,t])=>`<option value="${n}" ${Number(Store.all.prefs.archiveDays||0)===n?'selected':''}>${t}</option>`).join('')}</select>
      <div class="sd">הניקוי מתבצע בפתיחה ובזמן השימוש. משפחה נשמרת כל עוד יש בה ילד פעיל או חדש יותר.
      לפני הניקוי נשמר עותק שחזור מקומי אחד.</div>
      <button class="btn wide" data-care="recover" ${localStorage.getItem('mesima.before-archive-cleanup')?'':'disabled'}>ייצא עותק מלפני הניקוי האחרון</button>
      <h2 class="sh">גיבוי בענן · Firebase</h2>
      ${!cloud.configured?`<div class="notice">החיבור מוכן להגדרה, אך עדיין לא חובר פרויקט Firebase.
      לאחר יצירת הפרויקט והתקנת המעטפת המחוברת יופיעו כאן כניסה וגיבוי בענן.</div>`:
      `<div class="notice">גיבוי של כל הנתונים והתמונות לחשבון שלך. שחזור מחליף את המידע המקומי רק לאחר אישור.
      הסנכרון האוטומטי מעביר שינויים בנפרד מהגיבויים השמורים.</div>
      ${cloud.email?`<div class="sd" dir="ltr">${esc(cloud.email)}</div>
        <button class="btn wide" data-care="cloud-now">גבה עכשיו לענן</button>
        <button class="btn wide" data-care="cloud-list">בחר גיבוי לשחזור</button>
        <button class="btn wide" data-care="logout">התנתק מהענן</button>
        <div class="sd">גיבוי ענן אחרון במכשיר זה: ${esc(date(cloud.lastBackup))}</div>`:
        `<button class="btn wide" data-care="login">כניסה / יצירת חשבון</button>`}
      ${cloud.busy?'<div role="status" class="notice">פעולת הענן מתבצעת…</div>':''}
      ${cloud.message?`<div role="status" class="notice">${esc(cloud.message)}</div>`:''}`}`;
  }
  function login(){
    Modal.open({title:'חשבון לגיבוי בענן',body:`
      <label for="cloudEmail">כתובת דוא״ל</label><input id="cloudEmail" type="email" autocomplete="username" dir="ltr">
      <label for="cloudPassword">סיסמה</label><input id="cloudPassword" type="password" autocomplete="current-password" dir="ltr">
      <div class="ex">השתמש באותו חשבון כדי לשחזר במכשיר אחר.</div>`,
      buttons:[{label:'ביטול',act:()=>Modal.shut()},
        {label:'צור חשבון',act:()=>auth(true)},{label:'היכנס',kind:'p',act:()=>auth(false)}]});
    function auth(create){
      const email=document.getElementById('cloudEmail').value.trim(), pass=document.getElementById('cloudPassword').value;
      if(!email.includes('@')||pass.length<6){UI.toast('הכנס דוא״ל וסיסמה באורך 6 תווים לפחות');return;}
      bridge().cloudSignIn(email,pass,create);Modal.shut();UI.render();
    }
  }
  async function copyDescription(el){
    const text=el.dataset.copyNoteId ? Store.task(el.dataset.copyNoteId)?.note : el.textContent;
    if(!text)return;
    try{
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw Error('fallback');
    }catch{
      const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';
      document.body.append(input);input.select();const ok=document.execCommand('copy');input.remove();
      if(!ok){UI.toast('בחר את הטקסט והעתק ידנית');return;}
    }
    UI.toast('התיאור הועתק');
  }
  function init(){
    Store.onChange(snapshot);snapshot();purge();setInterval(()=>purge(),60000);
    document.addEventListener('keydown',e=>{
      const el=e.target.closest('[data-copy-note-id]');
      if(el && (e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopImmediatePropagation();copyDescription(el);}
    },true);
    document.addEventListener('click',e=>{
      const copy=e.target.closest('[data-copy-note-id]');
      if(copy){e.preventDefault();e.stopImmediatePropagation();copyDescription(copy);return;}
      const el=e.target.closest('[data-care]');if(!el)return;
      e.preventDefault();e.stopPropagation();
      switch(el.dataset.care){
        case 'now': {snapshot();const s=status();if(s.folder)bridge().backupNow();if(s.cloud?.email)bridge().cloudBackup();if(!s.folder&&!s.cloud?.email)UI.download('mesima-backup.json',Store.export(),'application/json');break;}
        case 'folder':bridge().chooseBackupFolder();break;
        case 'recover-import':{const s=localStorage.getItem('mesima.before-import');if(s)UI.download('Mesima_before_restore.json',s,'application/json');break;}
        case 'local-now':snapshot();bridge().backupNow();break;
        case 'recover':{const s=localStorage.getItem('mesima.before-archive-cleanup');if(s)UI.download('Mesima_before_archive_cleanup.json',s,'application/json');break;}
        case 'login':login();break;
        case 'logout':bridge().cloudSignOut();UI.render();break;
        case 'cloud-now':snapshot();bridge().cloudBackup();UI.render();break;
        case 'cloud-list':bridge().cloudList();break;
      }
    },true);
    document.addEventListener('change',e=>{
      if(e.target.id==='backupDays'){const days=Number(e.target.value);if(days&&!status().folder){pendingDays=days;bridge().chooseBackupFolder();}else bridge().configureBackup(days);UI.render();}
      if(e.target.id==='archiveDays'){
        const days=Number(e.target.value), old=Number(Store.all.prefs.archiveDays||0);
        if(!days){Store.setPref('archiveDays',0);return;}
        Modal.open({title:'להפעיל מחיקה אוטומטית?',body:`<div class="note">פריטים שנמצאים בארכיון ${days} ימים ומעלה יימחקו לצמיתות.
          עותק שחזור אחד יישמר במכשיר לפני הניקוי.</div>`,buttons:[
          {label:'ביטול',act:()=>{Modal.shut();UI.render();}},
          {label:'הפעל',kind:'p',act:()=>{Store.setPref('archiveDays',days);purge(Date.now(),true);Modal.shut();UI.render();}}]});
        e.target.value=String(old);
      }
    });
    window.addEventListener('backup-status',()=>{if(pendingDays){const days=pendingDays;pendingDays=0;if(status().folder)bridge().configureBackup(days);}UI.render();});
    window.__cloudBackups = rows => {
      Modal.open({title:'בחר גיבוי מהענן',body:rows.length?rows.map(r=>`<button class="pick" data-cloud-restore="${esc(r.id)}"><span class="pn">${esc(date(r.createdAt))}</span><span class="pm">${esc(r.taskCount)} משימות</span></button>`).join(''):'<div class="note">אין עדיין גיבויים בחשבון הזה.</div>',buttons:[{label:'סגור',act:()=>Modal.shut()}]});
      Modal.body.onclick=e=>{const b=e.target.closest('[data-cloud-restore]');if(b){bridge().cloudRestore(b.dataset.cloudRestore);Modal.shut();}};
    };
  }
  return {init,settingsHTML,expiredIds,purge,snapshot,status};
})();
