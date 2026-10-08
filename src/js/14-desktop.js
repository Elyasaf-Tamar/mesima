/* Stable extension boundary for desktop-only modules. */
const Desktop=(()=>{
  if(window.MesimaDesktop){
    const d=window.MesimaDesktop;
    window.DesktopBackup={backupStatus:()=>JSON.stringify(d.status()),saveSnapshot:text=>d.snapshot(text),chooseBackupFolder:()=>d.chooseFolder(),configureBackup:n=>d.configure(n),backupNow:()=>d.backup(),cloudSignIn:(e,p,c)=>d.cloud('login',e,p,c),cloudSignOut:()=>d.cloud('logout'),cloudBackup:()=>d.cloud('backup'),cloudList:()=>d.cloud('list'),cloudRestore:id=>d.cloud('restore',id)};
    d.onStatus(()=>window.dispatchEvent(new Event('backup-status')));
    d.onList(rows=>window.__cloudBackups?.(rows));d.onRestore(text=>window.__import?.(text));
  }
  const modules=new Map();
  function register(id,module){if(modules.has(id))throw Error('Duplicate desktop module');modules.set(id,module);}
  function init(){
    if(!window.MesimaDesktop)return;
    document.documentElement.classList.add('desktop');
    modules.forEach(m=>m.init?.({Store,UI,Native,DataCare}));
    window.MesimaDesktop.onOpen(()=>{UI.screen=null;UI.section='today';UI.render();});
    const refreshSchedule=()=>window.MesimaDesktop.schedule(Native.alarmList(undefined,null),NativeState.projection());
    Store.onChange(refreshSchedule);
    window.MesimaDesktop.onScheduleRefresh?.(refreshSchedule);
    refreshSchedule();
    window.MesimaDesktop.onReminder(a=>{
      if(window.__alarm?.(a.id,a.meta||a))return;
      let pending=false;
      Modal.open({title:a.title,body:`<div class="note">${UI.esc(a.body)}</div>`,buttons:[
        {label:'סגור',act:()=>Modal.shut()},
        {label:'דחה ב־15 דקות',kind:'p',act:async()=>{
          if(pending)return;pending=true;
          try{
            if(await window.MesimaDesktop.snooze(a)===false)throw Error('התזכורת לא נשמרה');
            if(Modal.body===body)Modal.shut();
            UI.toast('נדחה ב־15 דקות');
          }catch(error){UI.toast('לא ניתן לדחות את התזכורת. נסה שוב.');}
          finally{pending=false;}
        }}
      ]});
      const body=Modal.body;
    });
    document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key===','){e.preventDefault();UI.screen='settings';UI.render();}});
  }
  return {init,register};
})();
