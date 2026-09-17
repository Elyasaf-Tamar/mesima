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
    Store.onChange(()=>window.MesimaDesktop.schedule(Native.alarmList(),NativeState.projection()));
    window.MesimaDesktop.schedule(Native.alarmList(),NativeState.projection());
    window.MesimaDesktop.onReminder(a=>{if(window.__alarm?.(a.id))return;Modal.open({title:a.title,body:`<div class="note">${UI.esc(a.body)}</div>`,buttons:[{label:'סגור',act:()=>Modal.shut()},{label:'דחה ב־15 דקות',kind:'p',act:()=>{window.MesimaDesktop.snooze(a);Modal.shut();}}]});});
    document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key===','){e.preventDefault();UI.screen='settings';UI.render();}});
  }
  return {init,register};
})();
