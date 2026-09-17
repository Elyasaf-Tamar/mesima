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
  const tasks=Store.all.tasks.map(t=>({id:t.id,title:t.title,note:t.note||'',kind:t.kind,archived:!!t.archived,done:!!t.done,checklists:(t.checklists||[]).map(c=>({id:c.id,cycle:Store.checklistOccurrence(c),complete:!!c.items.length&&c.items.every(x=>x.checked)})),daily:Store.isHabit(t),log:t.log||{},reminder:t.reminder||null,parentNames:Store.parentsOf(t).map(p=>p.title).join(' · ')}));
  const days={};
  for(let i=0;i<42;i++){
   const day=Plan.shift(Plan.today(),i),seen=new Set();
   const rows=Plan.agenda(day).filter(r=>!r.ref.archived&&!r.ref.done).map(r=>({id:r.ref.id,title:r.ref.title,kind:r.kind==='event'?'event':'task',time:r.ref.allDay?'כל היום':r.at||'',detail:r.kind==='event'?r.ref.note||'':Store.parentsOf(r.ref).map(p=>p.title).join(' · '),done:r.kind==='habit'&&Store.habitFull(r.ref,day),check:r.kind!=='event'&&r.ref.kind==='short'}));
   for(const x of Store.activeChecklists(day))rows.push({id:'cl_'+x.task.id+'_'+x.cl.id,title:x.cl.name,kind:'checklist',time:x.at||'',check:false});
   days[day]=rows.filter(r=>{const k=r.kind+':'+r.id;if(seen.has(k))return false;seen.add(k);return true;});
  }
  return {schema:1,date:Plan.today(),tasks,days,geo:!!Store.all.prefs.geo,places:Store.all.places};
 }
 function drain(){
  if(!available()||busy)return;busy=true;
  try{
   const commands=JSON.parse(window.MesimaNative.pendingActions()||'[]');
   if(commands.length){Store.transaction(()=>commands.forEach(c=>{const t=Store.task(c.taskId);if(!t)return;
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
   if(action==='newEvent')window.__newEvent?.();else if(action==='new')window.__newTask?.();else if(action==='task')window.__openTask?.(id);else if(action==='event')window.__openEvent?.(id);else if(action==='checklist')window.__alarm?.(id);
   else{UI.section='today';UI.screen=null;UI.selDate=Plan.today();UI.tview='day';UI.render();}
  };
  window.addEventListener('native-state',()=>{drain();publish();UI.render();});window.addEventListener('focus',()=>{drain();publish();});setInterval(()=>{
   drain();publish();const el=document.getElementById('gpsTxt'),gps=document.getElementById('gps');
   if(el&&gps){gps.classList.toggle('on',!!location?.running);el.textContent=location?.running?(location.trip?.meters>200?(location.trip.meters/1000).toFixed(1)+' ק״מ':'מיקום פעיל'):'GPS כבוי';}
  },15000);
 }
 return {available,projection,publish,drain,init,get location(){return location;}};
})();
