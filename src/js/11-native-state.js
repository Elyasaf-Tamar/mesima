/* Stable routing shared by system notifications, widgets and desktop. */
const ReminderLink=(()=>{
 function resolve(id){
  if(typeof id!=='string')return null;
  for(const e of Store.all.events)if(id===e.id||id==='e_'+e.id)return {kind:'event',eventId:e.id};
  for(const t of [...Store.all.tasks].sort((a,b)=>b.id.length-a.id.length)){
   if([t.id,'loc_'+t.id,'trip_'+t.id].includes(id))return {kind:'task',taskId:t.id,day:Plan.today(),daily:Store.isHabit(t)};
   for(const c of t.checklists||[])for(const p of ['cl_','co_','c_','cp_','ca_']){const base=p+t.id+'_'+c.id;
    if(id===base||id.startsWith(base+'_'))return {kind:'checklist',taskId:t.id,checklistId:c.id,day:id.slice(base.length+1,base.length+11),occurrence:c.repeat?(id.slice(base.length+1,base.length+11)||Store.checklistCycle(c)):Store.checklistOccurrence(c)};}
   for(const p of ['h_','hp_','ha_','t_'])if(id.startsWith(p+t.id+'_'))return {kind:'task',taskId:t.id,day:id.slice((p+t.id+'_').length,(p+t.id+'_').length+10),daily:p!=='t_'};
  }return null;
 }return {resolve};
})();
const NativeState=(()=>{
 let busy=false,initialized=false,last='',location=null;
 const available=()=>typeof window.MesimaNative?.syncState==='function';
 function projection(){
  const tasks=Store.all.tasks.map(t=>({id:t.id,title:t.title,note:t.note||'',kind:t.kind,archived:!!t.archived,done:!!t.done,checklists:(t.checklists||[]).map(c=>({id:c.id,cycle:Store.checklistOccurrence(c),complete:!!c.items.length&&c.items.every(x=>x.checked)})),daily:Store.isHabit(t),manualEligible:Widgets.eligible(t),log:t.log||{},reminder:t.reminder||null,parentNames:Store.parentsOf(t).map(p=>p.title).join(' · ')}));
  const days={};
  for(let i=0;i<42;i++){
   const day=Plan.shift(Plan.today(),i),seen=new Set();
   const rows=Plan.agenda(day).filter(r=>!r.ref.archived&&!r.ref.done).map(r=>({id:r.ref.id,title:r.ref.title,kind:r.kind==='event'?'event':'task',time:r.ref.allDay?'כל היום':r.at||'',detail:r.kind==='event'?r.ref.note||'':Store.parentsOf(r.ref).map(p=>p.title).join(' · '),done:r.kind==='habit'&&Store.habitFull(r.ref,day),check:r.kind!=='event'&&r.ref.kind==='short'}));
   for(const x of Store.activeChecklists(day))rows.push({id:'cl_'+x.task.id+'_'+x.cl.id,title:x.cl.name,kind:'checklist',time:x.at||'',check:false});
   days[day]=rows.filter(r=>{const k=r.kind+':'+r.id;if(seen.has(k))return false;seen.add(k);return true;});
  }
  const widgetChecklists=[];
  for(const t of Store.all.tasks.filter(t=>!t.archived&&!t.done))for(const c of t.checklists||[]){
   if(!c.repeat||!Recur.times(c.repeat).length)continue;
   const cycle=Store.checklistCycle(c),slots=[];let from=cycle?Plan.shift(cycle,1):Plan.today();
   for(let i=0;i<90;i++){const nx=Recur.nextOccurrence(c.repeat,from);if(!nx||nx.day>Plan.shift(Plan.today(),42))break;slots.push(nx);from=Plan.shift(nx.day,1);}
   widgetChecklists.push({id:'cl_'+t.id+'_'+c.id,taskId:t.id,title:c.name,cycle,complete:Store.checklistCycleDone(c),time:Recur.times(c.repeat)[0],slots});
  }
  return {schema:1,date:Plan.today(),tasks,days,widgetChecklists,widgets:Widgets.payload(),geo:!!Store.all.prefs.geo,places:Store.all.places};
 }
 function drain(){
  if(!available()||busy)return;busy=true;
  try{
   const commands=JSON.parse(window.MesimaNative.pendingActions()||'[]');
   if(commands.length){Store.transaction(()=>commands.forEach(c=>{
    if(c.action==='shopping'){Store.updateItem(c.listId,c.itemId,{done:!!c.done});return;}
    const t=Store.task(c.taskId);if(!t)return;
    if(c.action==='complete'){if(Store.isHabit(t)){if(!Store.habitFull(t,c.day))Store.tickHabit(t.id,c.day,c.at||Date.now());}else if(!t.archived&&!t.done)Store.finishTask(t.id,c.at||Date.now(),c.day);}
   }));if(Store.canPersist){window.MesimaNative.syncState(JSON.stringify(projection()));window.MesimaNative.ackActions(JSON.stringify(commands.map(c=>c.id)));last="";}}
   location=JSON.parse(window.MesimaNative.locationState()||'null');
  }catch(e){console.warn('Native state',e.message);}finally{busy=false;}
 }
 function publish(){
  if(!available()||busy||!initialized)return;drain();busy=true;
  try{const data=JSON.stringify(projection());if(data!==last){window.MesimaNative.syncState(data);last=data;}}
  catch(e){console.warn('Native projection',e.message);}finally{busy=false;}
 }
 function init(){
  if(!available())return;initialized=true;drain();publish();
  window.__widget=(action,id)=>{drain();UI.closeAlert();Modal.shut();
   if(action==='configure')Widgets.open(id);
   else if(action==='note')NoteView.open(id);
   else if(action==='shopping'){if(Store.list(id)){UI.screen='lists';UI.openList=id;UI.render();}}
   else if(action==='notes'){UI.screen='notes';UI.openNote=null;UI.render();}
   else if(action==='lists'){UI.screen='lists';UI.openList=null;UI.render();}
   else if(action==='newEvent')window.__newEvent?.();else if(action==='new')window.__newTask?.();else if(action==='task')window.__openTask?.(id);else if(action==='event')window.__openEvent?.(id);else if(action==='checklist')window.__alarm?.(id);
   else{UI.section='today';UI.screen=null;UI.selDate=Plan.today();UI.tview='day';UI.render();}
  };
  window.addEventListener('native-state',()=>{drain();publish();UI.render();});window.addEventListener('focus',()=>{drain();publish();});setInterval(()=>{
   drain();publish();const el=document.getElementById('gpsTxt'),gps=document.getElementById('gps');
   if(el&&gps){gps.classList.toggle('on',!!location?.running);el.textContent=location?.running?(location.trip?.meters>200?(location.trip.meters/1000).toFixed(1)+' ק״מ':'מיקום פעיל'):'GPS כבוי';}
  },15000);
 }
 return {available,projection,publish,drain,init,get location(){return location;}};
})();
