/* Device-local widget choices reference existing entities; they never schedule them. */
const Widgets=(()=>{
 const eligible=t=>!!t&&t.kind==='short'&&!t.archived&&!t.done&&!Store.isHabit(t)&&!(t.checklists||[]).length;
 function configs(){try{return JSON.parse(window.MesimaNative?.widgetConfigs?.()||'[]');}catch{return [];}}
 function project(config){
  if(config.kind==='tasks')return {ids:[...new Set(config.ids||[])].filter(id=>eligible(Store.task(id)))};
  if(config.kind==='shopping'){
   const l=Store.list(config.contentId);return l?{id:l.id,title:l.name,items:l.items.map(i=>({id:i.id,title:i.title,done:!!i.done,detail:i.where||''}))}:{};
  }
  if(config.kind==='notes'){
   const n=Store.note(config.contentId);if(!n)return {};
   // Only an explicitly chosen note, and only opt-in preview text, crosses to Android.
   return {id:n.id,title:n.title||'ללא כותרת',preview:!!config.preview,
    text:config.preview?UI.noteText(NoteView.clean(NoteView.html(n))).slice(0,6000):'',updatedAt:n.updatedAt};
  }return {};
 }
 function payload(){return Object.fromEntries(configs().map(c=>[String(c.widgetId),project(c)]));}
 function open(widgetId){
  const config=configs().find(c=>String(c.widgetId)===String(widgetId));
  if(!config){UI.toast('הוסף יישומון למסך הבית ופתח ממנו את הבחירה');return;}
  let ids=new Set((config.ids||[]).filter(id=>eligible(Store.task(id)))),contentId=config.contentId||'',preview=!!config.preview,path=[];
  const esc=UI.esc,kind=config.kind;
  const title=kind==='tasks'?'מה להציג ביישומון?':kind==='shopping'?'בחירת רשימת קניות':'בחירת הערה';
  Modal.open({title,body:'<div id="widgetPicker"></div>',buttons:[{label:'ביטול',act:()=>Modal.shut()},{label:'שמור',kind:'p',act:()=>{
   const next={kind,ids:[...ids],contentId,preview};
   try{if(!window.MesimaNative.configureWidget(+widgetId,JSON.stringify(next)))throw Error();NativeState.publish();Modal.shut();UI.toast('היישומון עודכן');}catch{UI.toast('לא ניתן לשמור. פתח את הבחירה שוב מהיישומון.');}
  }}]});
  const root=document.getElementById('widgetPicker');
  const useful=(t,seen=new Set())=>{if(seen.has(t.id)||t.archived||t.done)return false;seen.add(t.id);return eligible(t)||Store.children(t.id).some(c=>useful(c,seen));};
  function paint(){
   if(kind==='tasks'){
    const current=path.at(-1);let rows;
    if(!current)rows=Store.allRoots().filter(t=>t.kind==='long'&&useful(t));
    else if(current==='standalone')rows=Store.allRoots().filter(t=>t.kind!=='long'&&useful(t));
    else rows=Store.children(current).filter(t=>useful(t));
    root.innerHTML=`<p class="note">תוכן היום מופיע אוטומטית. כאן בוחרים מה להציג מתחתיו.</p><div class="widget-picker-path"><button class="txtbtn" data-root>כל המשימות</button>${path.map((id,i)=>`<button class="txtbtn" data-path="${i}">‹ ${esc(id==='standalone'?'משימות עצמאיות':Store.task(id)?.title||'')}</button>`).join('')}</div><div class="note">${ids.size} נבחרו</div>`+
     (!current?'<div class="widget-choice"><button class="txtbtn" data-enter="standalone">משימות קצרות עצמאיות ‹</button></div>':'')+
     rows.map(t=>`<div class="widget-choice">${eligible(t)?`<label><input type="checkbox" data-task="${t.id}" ${ids.has(t.id)?'checked':''}><span>${esc(t.title)}</span></label>`:`<button class="txtbtn" data-enter="${t.id}">${esc(t.title)} ‹</button>`}${eligible(t)&&Store.children(t.id).some(x=>useful(x))?`<button class="hbtn" data-enter="${t.id}" aria-label="תתי־משימות">‹</button>`:''}</div>`).join('')+(!rows.length&&current?'<p class="note">אין כאן משימות רגילות פתוחות לבחירה</p>':'');
   }else{
    const rows=kind==='shopping'?Store.all.lists:Store.notes();
    root.innerHTML=rows.map(n=>`<div class="widget-choice"><label><input type="radio" name="widget-content" value="${n.id}" ${contentId===n.id?'checked':''}><span>${esc(n.name||n.title||'ללא כותרת')}</span></label></div>`).join('')||'<p class="note">אין עדיין תוכן לבחירה</p>';
    if(kind==='notes')root.innerHTML+=`<label class="membership"><input type="checkbox" id="widgetPreview" ${preview?'checked':''}>הצג גם תוכן במסך הבית</label><p class="note">התוכן יהיה גלוי למי שרואה את מסך הבית. ללא סימון תוצג רק הכותרת.</p>`;
   }
  }
  root.onchange=e=>{
   if(e.target.dataset.task){e.target.checked?ids.add(e.target.dataset.task):ids.delete(e.target.dataset.task);paint();}
   if(e.target.name==='widget-content')contentId=e.target.value;
   if(e.target.id==='widgetPreview')preview=e.target.checked;
  };
  root.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-root'))path=[];else if(b.dataset.path!==undefined)path=path.slice(0,+b.dataset.path+1);else if(b.dataset.enter)path.push(b.dataset.enter);else return;paint();};paint();
 }
 return {eligible,configs,project,payload,open};
})();
