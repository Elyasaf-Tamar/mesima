/* Reflection belongs to the selected calendar day, never to another navigation screen. */
const Reflection=(()=>{
 const opened=new Set();
 const esc=s=>UI.esc(s??'');
 const dateOf=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const dateObj=key=>new Date(key+'T12:00:00');
 function available(day,now=new Date()){const today=dateOf(now);return day<today||(day===today&&now.getHours()>=18);}
 function weekDays(sunday){return Array.from({length:7},(_,i)=>Plan.shift(sunday,i-7));}
 const count=n=>n===1?'דבר אחד הושלם':`${n} דברים הושלמו`;
 function entries(rows){return `<ul class="reflection-items">${rows.map(r=>`<li><span class="reflection-check" aria-hidden="true">✓</span><div><span>${Store.task(r.taskId)?`<button class="reflection-task" data-reflection-task="${esc(r.taskId)}" ${r.checklistId?`data-reflection-checklist="${esc(r.checklistId)}"`:""}>${esc(r.title)}</button>`:esc(r.title)}</span>${r.projects?.length?`<small>${r.projects.map(p=>esc(p.title)).join(' · ')}</small>`:''}</div><time>${r.at?esc(new Date(r.at).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})):'—'}</time></li>`).join('')}</ul>`;}
 function field(kind,key,label){const id='reflection-'+kind+'-'+key;return `<label class="reflection-label" for="${id}">${label}</label><textarea id="${id}" data-reflection-note="${kind}" data-reflection-key="${key}" rows="4" placeholder="מה תרצה לזכור?">${esc(Store.reflection(kind,key))}</textarea><small class="reflection-saved" aria-live="polite">נשמר אוטומטית במכשיר${Store.reflection(kind,key)?' · הסיכום שלך':''}</small>`;}
 function card(kind,key,title,subtitle,content){const id=kind+':'+key,isOpen=opened.has(id);return `<section class="reflection-card"><button class="reflection-head" data-reflection-toggle="${id}" aria-expanded="${isOpen}" aria-controls="reflection-body-${kind}-${key}"><span><strong>${title}</strong><small>${subtitle}</small></span><span class="reflection-arrow" aria-hidden="true">${isOpen?'⌄':'‹'}</span></button>${isOpen?`<div class="reflection-body" id="reflection-body-${kind}-${key}">${content()}</div>`:''}</section>`;}
 function render(day,now=new Date()){
  if(!available(day,now))return '';
  const rows=Store.completionsFor(day);
  let html=card('day',day,'היום שלך',count(rows.length),()=> (rows.length?entries(rows):'<p class="note">עדיין אין השלמות רשומות ביום הזה.</p>')+field('day',day,'איך עבר היום?'));
  if(dateObj(day).getDay()===0){const days=weekDays(day),total=days.reduce((n,d)=>n+Store.completionsFor(d).length,0);
   html+=card('week',days[0],'השבוע שעבר',`${count(total)} · ${esc(dateObj(days[0]).toLocaleDateString('he-IL',{day:'numeric',month:'numeric'}))}–${esc(dateObj(days[6]).toLocaleDateString('he-IL',{day:'numeric',month:'numeric'}))}`,()=>
    days.map(d=>{const done=Store.completionsFor(d),note=Store.reflection('day',d);return `<div class="reflection-day"><h3>${esc(dateObj(d).toLocaleDateString('he-IL',{weekday:'long'}))}<span>${done.length}</span></h3>${done.length?entries(done):'<p class="note">אין השלמות רשומות</p>'}${note?`<p class="reflection-day-note">${esc(note)}</p>`:''}</div>`;}).join('')+field('week',days[0],'איך עבר השבוע?'));
  }
  return `<div class="reflections" aria-label="סיכומים">${html}</div>`;
 }
 function init(){
  document.addEventListener('click',e=>{const task=e.target.closest('[data-reflection-task]');if(task){if(task.dataset.reflectionChecklist)window.__alarm?.('cl_'+task.dataset.reflectionTask+'_'+task.dataset.reflectionChecklist);else window.__openTask?.(task.dataset.reflectionTask);return;}const b=e.target.closest('[data-reflection-toggle]');if(!b)return;const key=b.dataset.reflectionToggle;opened.has(key)?opened.delete(key):opened.add(key);UI.render();});
  document.addEventListener('input',e=>{const el=e.target;if(!el.matches('[data-reflection-note]'))return;Store.setReflection(el.dataset.reflectionNote,el.dataset.reflectionKey,el.value);const status=el.nextElementSibling;if(status)status.textContent=Store.canPersist?'נשמר אוטומטית במכשיר':'השמירה נכשלה — העתק את הטקסט לפני סגירה';});
  let stamp='';const refresh=()=>{const now=new Date(),next=dateOf(now)+':'+(now.getHours()>=18);if(next!==stamp){stamp=next;UI.render();}};
  refresh();setInterval(refresh,15000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 }
 return {available,weekDays,render,init,opened};
})();
