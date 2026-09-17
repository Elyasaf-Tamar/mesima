/* Long press a row; scrolling remains normal until the hold activates. */
const Reorder=(()=>{
 const selector='.tsub[data-sub],.krow[data-kid],.tcard[data-id]',id=el=>el?.dataset.sub||el?.dataset.kid||el?.dataset.id;
 let press=null,drag=null,blockClick=0;
 function peers(el){const t=Store.task(id(el));if(!t)return [];return [...el.parentElement.children].filter(x=>x.matches(selector)).filter(x=>{const b=Store.task(id(x));return b&&Store.isHabit(t)===Store.isHabit(b)&&(t.parentId||!UI.grouped||t.kind===b.kind);});}
 function move(ids,from,to){
  const a=ids.indexOf(from),b=ids.indexOf(to),t=Store.task(from);if(a<0||b<0||a===b||!t)return false;
  const ordered=[...ids];ordered.splice(b,0,ordered.splice(a,1)[0]);
  const all=(t.parentId?Store.ordered(Store.all.tasks.filter(x=>x.parentId)):Store.allRoots()).map(x=>x.id),slots=ids.map(x=>all.indexOf(x)).sort((x,y)=>x-y);
  slots.forEach((s,i)=>all[s]=ordered[i]);Store.orderIds(all);return true;
 }
 function cancel(){if(press)clearTimeout(press.timer);press=null;}
 function start(el){const list=peers(el);if(list.length<2)return;drag={el,ids:list.map(id),target:el};el.classList.add('dragging');document.body.classList.add('reordering');navigator.vibrate?.(35);blockClick=Date.now()+1000;}
 function down(e,x,y){const el=e.target.closest(selector);if(!el||e.target.closest('input,textarea,select,.cb,.hbtn,[contenteditable],.tnotetog,.tsubmore,.tcl'))return;cancel();press={el,x,y,timer:setTimeout(()=>{start(el);press=null;},450)};}
 function motion(e,x,y){
  if(press&&Math.hypot(x-press.x,y-press.y)>9)cancel();if(!drag)return;e.preventDefault();
  const target=document.elementFromPoint(x,y)?.closest(selector);if(target&&drag.ids.includes(id(target))){drag.target.classList.remove('drop-target');drag.target=target;target.classList.add('drop-target');}
  const box=drag.el.closest('.mbody')||drag.el.closest('main')||document.scrollingElement,rect=box.getBoundingClientRect();if(y<rect.top+65)box.scrollTop-=18;else if(y>rect.bottom-65)box.scrollTop+=18;
 }
 function end(commit){cancel();if(!drag)return;const d=drag;drag=null;d.el.classList.remove('dragging');d.target.classList.remove('drop-target');document.body.classList.remove('reordering');blockClick=Date.now()+500;if(commit&&move(d.ids,id(d.el),id(d.target))){UI.renderTasks();document.dispatchEvent(new Event('tasks-reordered'));UI.toast('הסדר נשמר');}}
 function init(){
  document.addEventListener('mousedown',e=>{if(e.button===0)down(e,e.clientX,e.clientY);},true);document.addEventListener('mousemove',e=>motion(e,e.clientX,e.clientY),true);document.addEventListener('mouseup',()=>end(true),true);
  document.addEventListener('touchstart',e=>{if(e.touches.length===1)down(e,e.touches[0].clientX,e.touches[0].clientY);else end(false);},{capture:true,passive:true});document.addEventListener('touchmove',e=>{if(e.touches.length===1)motion(e,e.touches[0].clientX,e.touches[0].clientY);},{capture:true,passive:false});document.addEventListener('touchend',()=>end(true),true);document.addEventListener('touchcancel',()=>end(false),true);
  document.addEventListener('contextmenu',e=>{if(e.target.closest(selector))e.preventDefault();},true);document.addEventListener('click',e=>{if(Date.now()<blockClick&&e.target.closest(selector)){e.preventDefault();e.stopImmediatePropagation();}},true);document.addEventListener('keydown',e=>{if(e.key==='Escape')end(false);});window.addEventListener('blur',()=>end(false));
 }return {init,move};
})();
