/* Settings is navigation, not a stack of expanded configuration forms. */
const Permissions = (() => {
  function missing(){
    if(!Native.on)return [];
    const n=Native.status()||{}, tasks=Store.active();
    const place=tasks.some(t=>['place','trip'].includes(t.reminder?.type));
    const time=Native.alarmList().length>0;
    const out=[];
    if((place||time) && n.notifications===false)out.push(['notif','אפשר התראות']);
    if(place && n.locationBackground===false)out.push(['loc','אפשר תזכורות מיקום ברקע']);
    if(time && n.alarms?.exact===false)out.push(['exact','אפשר תזכורות מדויקות']);
    if((time||place) && n.channel?.blocked)out.push(['chan','הפעל את ערוץ ההתראות']);
    return out;
  }
  function forTask(t){
    if(!Native.on)return;
    const n=Native.status()||{};
    if(t.reminder||t.repeat){
      if(n.notifications===false)Native.askNotifications();
      else if(['place','trip'].includes(t.reminder?.type) && !n.locationBackground)Native.askLocation();
      else if((t.reminder?.type==='time'||t.repeat) && n.alarms?.exact===false)Native.askExact();
    }
  }
  return {missing,forTask};
})();
const Settings = (() => {
  let page='home';
  const titles={home:'הגדרות',update:'עדכון האפליקציה',data:'גיבוי ונתונים',advanced:'מתקדם',notifications:'התראות',auto:'גיבוי אוטומטי',cloud:'גיבוי בענן',archive:'מחיקה מהארכיון',behavior:'התנהגות האפליקציה',perms:'הרשאות מערכת',fix:'נדרשת פעולה',diag:'אבחון',restore:'ייבוא / שחזור',source:'מקור עדכונים',wipe:'מחיקת כל הנתונים'};
  const parent={update:'home',data:'home',advanced:'home',auto:'data',cloud:'data',archive:'data',fix:'home'};
  const row=(key,note='')=>`<button class="settings-row" data-settings-page="${key}"><span><b>${titles[key]}</b>${note?`<small>${UI.esc(note)}</small>`:''}</span><span aria-hidden="true">‹</span></button>`;
  function section(html,title){
    const box=document.createElement('div');box.innerHTML=html;
    const h=[...box.querySelectorAll('h2')].find(x=>x.textContent===title);
    if(!h)return '';
    let s='',e=h.nextElementSibling;
    while(e && e.tagName!=='H2'){s+=e.outerHTML;e=e.nextElementSibling;}return s;
  }
  const frequency=s=>s.days ? ({1:'כל יום',7:'כל שבוע',30:'כל חודש'}[s.days]||'פעיל') : 'כבוי';
  function render({updateBody,permsBody,diagBody,moreBody,n,capWarn}){
    const s=DataCare.status(),c=s.cloud||{},needs=Permissions.missing();
    const backup=DataCare.settingsHTML();
    const auto=frequency(s),cloud=c.email?'מחובר':'לא מחובר';
    let html='';
    if(page==='home'){
      if(needs.length)html+=`<div class="notice warn">נדרשות ${needs.length} הגדרות מערכת <button class="btn" data-settings-page="fix">תקן</button></div>`;
      if(NativeState.available()&&n.locationError)html+=`<div class="notice warn">${UI.esc(n.locationError)} <button class="btn" data-nat="loc">תקן</button></div>`;
      if(!Store.canPersist)html+='<div class="notice warn">לא ניתן לשמור נתונים במכשיר הזה.</div>';
      if(s.error)html+='<div class="notice warn">הגיבוי דורש טיפול <button class="btn" data-settings-page="auto">בדוק</button></div>';
      if(c.email&&Store.all.prefs.syncEnabled!==false&&/שגיאת|כללי|לא תקין|השתנה|גדול/.test(CloudSync.info().message))html+='<div class="notice warn">הסנכרון דורש טיפול <button class="btn" data-settings-page="cloud">בדוק</button></div>';
      html+=row('update',n.updatePending?'עדכון זמין':Native.on&&Native.apkOld()?'נדרשת התקנת גרסה חדשה':`גרסה ${BUILD.split(' ·')[0]}`)+row('data',`גיבוי אוטומטי: ${auto} · ענן: ${cloud}`)+row('advanced');
    }else if(page==='data'){
      html=row('auto',auto)+row('cloud',cloud)+row('archive',Store.all.prefs.archiveDays?`אחרי ${Store.all.prefs.archiveDays} יום`:'לעולם לא')+'<button class="btn p wide" data-care="now">גבה עכשיו</button>';
      if(c.busy)html+='<div role="status" class="notice">הגיבוי לענן מתבצע…</div>';
      if(c.message)html+=`<div role="status" class="notice">${UI.esc(c.message)}</div>`;
    }else if(page==='advanced'){
      html=['notifications','behavior','perms','diag','restore',...(Native.on?['source']:[]),'wipe'].map(x=>row(x)).join('');
    }else if(page==='update')html=window.MesimaDesktop?'<div class="notice">גרסת מחשב '+UI.esc(BUILD)+'</div><div class="sd">עדכון מתבצע באמצעות התקנת גרסה חדשה.</div>':updateBody;
    else if(page==='auto')html=section(backup,'גיבוי אוטומטי לנייד').replace(/<button[^>]*data-care="local-now"[\s\S]*?<\/button>/,'');
    else if(page==='cloud')html=section(backup,'גיבוי בענן · Firebase').replace(/<button[^>]*data-care="cloud-now"[\s\S]*?<\/button>/,'')+`<div class="set"><span>סנכרון אוטומטי בין מכשירים</span><button class="sw" id="syncEnabled" aria-checked="${Store.all.prefs.syncEnabled!==false}"></button></div><div class="sd" role="status">${UI.esc(CloudSync.info().message)}</div>`;
    else if(page==='archive')html=section(backup,'ניקוי הארכיון');
    else if(page==='notifications'){
      let pref={};try{pref=JSON.parse(window.MesimaNative?.notificationPreferences?.()||'{}');}catch{}
      html=Native.on?`<button class="settings-row" data-nat="chan"><span><b>צליל ההתראה</b><small>בחר צליל בהגדרות Android</small></span><span>‹</span></button><button class="settings-row" data-notification-vibration><span><b>דפוס רטט</b><small>${UI.esc(pref.pattern||'ברירת מחדל')}</small></span><span>‹</span></button><p class="note">אפשרויות הצליל והרטט תלויות במכשיר. ההגדרות שבחרת בערוץ של Android נשמרות עבור כל דפוס.</p><button class="btn" data-nat="testnow">בדוק התראה</button>`:'<p class="note">בחירת צליל ודפוס רטט זמינה באפליקציית Android.</p>';
    }
    else if(page==='behavior')html=section(moreBody,'התראות באפליקציה');
    else if(page==='restore')html=section(moreBody,'גיבוי ידני').replace(/<div class="set">[\s\S]*?<\/div><\/div>/g,'')+(localStorage.getItem('mesima.before-import')?'<button class="btn wide" data-care="recover-import">ייצא עותק מלפני השחזור / הסנכרון האחרון</button>':'');
    else if(page==='source')html=section(moreBody,'מקור העדכונים');
    else if(page==='wipe')html=section(moreBody,'מסוכן');
    else if(page==='perms')html=permsBody;
    else if(page==='diag')html=capWarn+diagBody;
    else if(page==='fix')html=needs.map(([act,label])=>`<div class="set"><span>${label}</span><button class="btn" data-nat="${act}">תקן</button></div>`).join('')||'<div class="notice">הכול תקין</div>';
    document.getElementById('settingsBody').innerHTML=(page==='home'?'':`<button class="txtbtn settings-back" data-settings-page="${parent[page]||'advanced'}">› חזרה</button><h2>${titles[page]}</h2>`)+html;
  }
  return {render,open(key){page=titles[key]?key:'home';UI.render();},back(){if(page==='home')return false;page=parent[page]||'advanced';UI.render();return true;}};
})();

document.addEventListener('click',e=>{if(e.target.closest('[data-notification-vibration]')){if(window.MesimaNative?.chooseNotificationVibration)window.MesimaNative.chooseNotificationVibration();else UI.toast('יש להתקין את גרסת Android החדשה');}});
