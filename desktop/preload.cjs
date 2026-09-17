const {contextBridge,ipcRenderer}=require('electron');
let status=ipcRenderer.sendSync('backup-initial');
const send=(channel,...args)=>ipcRenderer.invoke(channel,...args).catch(()=>{});
contextBridge.exposeInMainWorld('MesimaDesktop',{
  status:()=>status,
  searchPlaces:url=>ipcRenderer.invoke('search-places',url),
  credentials:()=>ipcRenderer.invoke('credentials'),
  syncRequest:input=>ipcRenderer.invoke('sync-request',input),
  snapshot:text=>send('snapshot',text),chooseFolder:()=>send('choose-folder'),configure:days=>send('configure',days),
  backup:()=>send('backup-local'),cloud:(action,...args)=>send('cloud',action,args),save:(name,text)=>send('save',name,text),
  schedule:(list,state)=>send('schedule',list,state),snooze:a=>send('snooze',a),openData:()=>send('open-data'),
  onOpen:cb=>ipcRenderer.on('open',()=>cb()),
  onStatus:cb=>ipcRenderer.on('backup-status',(_e,s)=>{status=s;cb();}),
  onList:cb=>ipcRenderer.on('cloud-list',(_e,rows)=>cb(rows)),
  onRestore:cb=>ipcRenderer.on('cloud-restore',(_e,text)=>cb(text)),
  onReminder:cb=>ipcRenderer.on('reminder',(_e,a)=>cb(a))
});
