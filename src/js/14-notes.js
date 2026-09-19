/* Reading is the default; only the selected section enters the existing rich editor. */
const NoteView=(()=>{
 let editing=null,editor=null,flush=null;
 const parts=n=>Object.values(n.parts||{}).filter(p=>p&&p.id).sort((a,b)=>a.createdAt-b.createdAt||(a.order||0)-(b.order||0)||a.id.localeCompare(b.id));
 const html=n=>n.multipart?parts(n).map(p=>`<h2>${UI.esc(p.title||'ללא כותרת')}</h2>${p.html||''}`).join(''):n.html||'';
 const stamp=t=>new Date(t).toLocaleDateString('he-IL',{day:'numeric',month:'numeric',year:'numeric'});
 const collapseKey='mesima.noteFolds';
 function folds(){try{return JSON.parse(localStorage.getItem(collapseKey)||'{}');}catch{return {};}}
 function bind(e,f){editor=e;flush=f;}
 function open(id){
  if(editing)finish(false);
  if(!Store.note(id))return;editing=null;UI.screen='notes';UI.openNote=id;UI.render();
 }
 function edit(id,partId=null){
  const n=Store.note(id),p=partId?n?.parts?.[partId]:n;if(!p)return;
  if(editing)finish(false);
  editing={id,partId};editor(id,p);UI.render();
 }
 function save(title,body){
  const e=editing,n=e&&Store.note(e.id);if(!n)return;
  const old=e.partId?n.parts?.[e.partId]:n;if(!old||old.title===title&&old.html===body)return;
  if(e.partId)Store.updateNote(n.id,{parts:{...n.parts,[e.partId]:{...old,title,html:body,updatedAt:Date.now()}}});
  else Store.updateNote(n.id,{title,html:body});
 }
 function finish(render=true){
  if(!editing)return;flush(true);const id=editing.id;editing=null;
  if(render){UI.openNote=id;UI.render();}
 }
 function close(){
  if(editing){finish();return;}
  UI.openNote=null;UI.render();
 }
 function addPart(id){
  const n=Store.note(id);if(!n)return;
  const p={id:crypto.randomUUID(),title:'',html:'',createdAt:Date.now(),updatedAt:Date.now(),order:Math.max(-1,...parts(n).map(p=>p.order||0))+1};
  Store.updateNote(id,{parts:{...n.parts,[p.id]:p}});edit(id,p.id);
 }
 function convert(id){
  const n=Store.note(id);if(!n||n.multipart)return;
  const p={id:crypto.randomUUID(),title:n.title||'הערה ראשונה',html:n.html||'',createdAt:n.createdAt,updatedAt:n.updatedAt,order:0};
  Store.updateNote(id,{multipart:true,parts:{[p.id]:p},html:''});open(id);
 }
 function rename(id){
  const n=Store.note(id);if(!n)return;
  Modal.open({title:'שם ההערה',body:`<input id="noteName" value="${UI.esc(n.title||'')}">`,buttons:[{label:'ביטול',act:()=>Modal.shut()},{label:'שמור',kind:'p',act:()=>{Store.updateNote(id,{title:document.getElementById('noteName').value.trim()});Modal.shut();}}]});
 }
 function render(){
  const n=Store.note(UI.openNote),root=document.getElementById('noteRead');if(!n)return;
  // Never replace the editable DOM during an autosave or a remote update.
  const active=editing?.id===n.id;
  document.getElementById('noteEdit').hidden=!active;root.hidden=active;if(active)return;
  const esc=UI.esc,collapsed=folds();
  root.innerHTML=`<div class="note-read-head"><button class="hbtn" data-note-back aria-label="חזרה להערות">›</button><h2>${esc(n.title||'ללא כותרת')}</h2><button class="txtbtn" data-note-edit>${n.multipart?'שם ההערה':'ערוך'}</button></div>`+
   (n.multipart?parts(n).map(p=>`<section class="note-part"><button class="note-part-head" data-fold="${p.id}" aria-expanded="${!collapsed[p.id]}"><span>${collapsed[p.id]?'▸':'▾'} ${esc(p.title||'ללא כותרת')}<small>נכתב ב־${stamp(p.createdAt)}</small></span></button><div ${collapsed[p.id]?'hidden':''}><article class="note-reading">${clean(p.html)}</article><div class="note-part-actions"><button class="txtbtn" data-part-edit="${p.id}">ערוך חלק</button><button class="txtbtn" data-part-delete="${p.id}">מחק חלק</button></div></div></section>`).join('')+`<button class="btn wide" data-part-add>＋ הערה חדשה</button>`:
    `<div class="note-date">נכתב ב־${stamp(n.createdAt)}</div><article class="note-reading">${clean(n.html)||'<p class="note">אין תוכן עדיין</p>'}</article><details class="note-options"><summary>אפשרויות נוספות</summary><button class="txtbtn" data-convert>הוסף חלקים להערה הזאת</button></details>`);
  root.onclick=e=>{
   const b=e.target.closest('button');if(!b)return;
   if(b.hasAttribute('data-note-back'))close();
   if(b.hasAttribute('data-note-edit'))n.multipart?rename(n.id):edit(n.id);
   if(b.hasAttribute('data-part-add'))addPart(n.id);
   if(b.hasAttribute('data-convert'))convert(n.id);
   if(b.dataset.partEdit)edit(n.id,b.dataset.partEdit);
   if(b.dataset.fold){const f=folds();f[b.dataset.fold]=!f[b.dataset.fold];localStorage.setItem(collapseKey,JSON.stringify(f));render();}
   if(b.dataset.partDelete){const id=b.dataset.partDelete;Modal.open({title:'למחוק את החלק הזה?',body:'שאר חלקי ההערה יישארו.',buttons:[{label:'ביטול',act:()=>Modal.shut()},{label:'מחק',kind:'p',act:()=>{const current=Store.note(n.id),next={...current.parts};delete next[id];Store.updateNote(n.id,{parts:next});Modal.shut();}}]});}
  };
 }
 // Imported/cloud HTML is untrusted too, not just clipboard HTML.
 function clean(value){
  const t=document.createElement('template');t.innerHTML=value||'';
  t.content.querySelectorAll('script,style,iframe,object,embed,form,input,button,meta,link,svg,math').forEach(e=>e.remove());
  t.content.querySelectorAll('*').forEach(e=>{for(const a of [...e.attributes]){
   if(/^on/i.test(a.name)||['srcdoc','contenteditable'].includes(a.name))e.removeAttribute(a.name);
   if(['href','src'].includes(a.name)&&!(/^(https?:|mailto:|tel:|#)/i.test(a.value)||a.name==='src'&&/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(a.value)))e.removeAttribute(a.name);
   if(a.name==='style'&&/url\s*\(|expression\s*\(|position\s*:/i.test(a.value))e.removeAttribute(a.name);
  }if(e.tagName==='A'){e.target='_blank';e.rel='noopener noreferrer';}});
  return t.innerHTML;
 }
 window.addEventListener('pagehide',()=>editing&&flush?.(true));
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&editing)flush?.(true);});
 return {bind,open,edit,save,finish,close,render,parts,html,clean,get editing(){return editing;}};
})();
