/* State survives unrelated renders (GPS, sync, timers). Results are never written into a detached node. */
const PlaceSearch=(()=>{
 const state={query:'',area:'',busy:false,rows:[],error:'',searched:false,serial:0};let bound=false;
 function render(box){
  if(box.querySelector('#placeQuery'))return;
  box.innerHTML=`<h2 class="sh">הוסף מקום</h2><form id="placeForm"><label for="placeQuery">שם מקום או כתובת</label><input id="placeQuery" type="search" placeholder="למשל: סטימצקי, גן שמואל" autocomplete="off"><label for="placeArea" style="margin-top:10px">עיר / אזור (אפשר להשאיר ריק)</label><input id="placeArea" type="text" autocomplete="off"><button class="btn p wide" id="placeFind" style="margin-top:12px">חפש מקום</button></form><div id="placeResults" aria-live="polite"></div><button class="txtbtn" id="placeManual">לא מצאת? הוסף תת־מיקום ידנית</button><div class="rule"></div><button class="txtbtn" id="placeHere">שמור את המיקום הנוכחי</button><span class="note"> · אפשר גם להדביק קישור מפה עם קואורדינטות בשדה החיפוש</span><h2 class="sh">מקומות שמורים</h2><div id="savedPlaces"></div>`;
  box.querySelector('#placeQuery').value=state.query;box.querySelector('#placeArea').value=state.area;
  box.querySelector('#placeForm').onsubmit=e=>{e.preventDefault();search();};
  box.querySelector('#placeQuery').oninput=e=>state.query=e.target.value;box.querySelector('#placeArea').oninput=e=>state.area=e.target.value;
  box.querySelector('#placeManual').onclick=()=>manual();
  box.querySelector('#placeHere').onclick=async()=>{try{const p=await Geo.now();choose({...p,name:'המיקום שלי'});}catch{UI.toast('נדרשת הרשאת מיקום ומיקום זמין');Native.askLocation();}};
  box.querySelector('#placeResults').onclick=e=>{const b=e.target.closest('[data-result]');if(b)choose(state.rows[+b.dataset.result]);};
  box.querySelector('#savedPlaces').onclick=e=>{const b=e.target.closest('[data-place-edit]');if(b){const p=Store.place(b.dataset.placeEdit);if(p)choose(p);}};
  results();saved();
  if(!bound){bound=true;Store.onChange(saved);}
 }
 function saved(){const box=document.getElementById('savedPlaces');if(!box)return;box.innerHTML=Store.all.places.map(p=>`<button class="prow" data-place-edit="${UI.esc(p.id)}" style="width:100%;text-align:start"><span class="pb"><b>${UI.esc(p.name)}</b><small class="pm2">${p.parentId?UI.esc(Store.place(p.parentId)?.name||'')+' · ':''}${p.lat==null?'ניווט למיקום הראשי':Math.round(p.radius)+' מטר'} · עריכה</small></span><span>‹</span></button>`).join('')||'<div class="note">עדיין אין מקומות שמורים</div>';}
 function results(){
  const b=document.getElementById('placeResults'),btn=document.getElementById('placeFind');if(!b)return;if(btn){btn.disabled=state.busy;btn.textContent=state.busy?'מחפש…':'חפש מקום';}
  b.innerHTML=state.error?`<div class="notice">${UI.esc(state.error)}</div>`:state.rows.map((r,i)=>`<button class="prow" data-result="${i}" style="width:100%;text-align:start"><span class="pb"><b>${UI.esc(r.name)}</b><small class="pm2" style="display:block">${UI.esc(r.city||'')}</small></span><span>בחר</span></button>`).join('')+(state.rows.length?'<div class="note">תוצאות מפות פתוחות · © OpenStreetMap contributors</div>':state.searched&&!state.busy?'<div class="notice">לא נמצאה התאמה. נסה שם ויישוב בנפרד, כתובת רחוב, או הדבק קישור מפה שמכיל קואורדינטות.</div>':'');
 }
 async function search(){
  if(state.busy||state.query.trim().length<2)return;const serial=++state.serial;state.busy=true;state.error='';state.rows=[];state.searched=true;results();
  try{const answer=await Search.run(state.query,state.area);if(serial===state.serial)state.rows=answer.results;}
  catch(e){if(serial===state.serial)state.error=e.message;}finally{if(serial===state.serial){state.busy=false;results();}}
 }
 function choose(r){if(!r)return;if(r.id&&r.parentId&&(r.lat==null||r.lng==null)){manual(r);return;}
  Modal.open({title:r.id?'עריכת מקום':'שמירת מקום',body:`<label>שם המקום</label><input id="placeSaveName" value="${UI.esc(r.name)}"><div class="note">${UI.esc(r.city||'')}</div><a href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=17/${r.lat}/${r.lng}" target="_blank" rel="noopener">בדוק את הנקודה במפה</a><div class="fgrid" style="margin-top:12px"><div><label>קו רוחב</label><input id="placeLat" value="${r.lat}" type="number" step="any"></div><div><label>קו אורך</label><input id="placeLng" value="${r.lng}" type="number" step="any"></div></div><label style="margin-top:12px">בתוך מקום</label><select id="placeParent"><option value="">מקום עצמאי</option>${Store.topPlaces().filter(p=>p.id!==r.id).map(p=>`<option value="${p.id}" ${r.parentId===p.id?'selected':''}>${UI.esc(p.name)}</option>`).join('')}</select><label style="margin-top:12px">רדיוס התזכורת במטרים</label><input id="placeRadius" type="number" value="${r.radius||250}" min="140" max="5000">`,buttons:[{label:'ביטול',act:()=>Modal.shut()},...(r.id?[{label:'מחק',act:()=>{Store.delPlace(r.id);Modal.shut();saved();}}]:[]),{label:'שמור מקום',kind:'p',act:()=>{
   const name=document.getElementById('placeSaveName').value.trim(),lat=Number(document.getElementById('placeLat').value),lng=Number(document.getElementById('placeLng').value),radius=Math.max(140,Math.min(5000,Number(document.getElementById('placeRadius').value)||250));
   if(!name||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){UI.toast('מלא שם ומיקום תקינים');return;}
   const parentId=document.getElementById("placeParent").value||null; if(r.id){Object.assign(Store.place(r.id),{name,lat,lng,radius,parentId});Store.commit();}else Store.addPlace(name,lat,lng,radius,parentId);
   Modal.shut();saved();UI.toast('המקום נשמר וניתן לבחור אותו בתזכורת');
  }}]});
 }
 function manual(existing){
  const roots=Store.topPlaces().filter(p=>Store.placeCoordinates(p.id));
  if(!roots.length){UI.toast('שמור תחילה מיקום ראשי עם נקודה במפה');return;}
  Modal.open({title:existing?'עריכת תת־מיקום':'תת־מיקום ידני',body:`<label for="manualPlaceName">שם תת־המיקום</label><input id="manualPlaceName" value="${UI.esc(existing?.name||state.query)}" placeholder="למשל סופר־פארם"><label for="manualPlaceParent" style="margin-top:16px">בתוך המיקום הראשי</label><select id="manualPlaceParent">${roots.map(p=>`<option value="${p.id}" ${p.id===existing?.parentId||p.name===state.area?'selected':''}>${UI.esc(p.name)}</option>`).join('')}</select><p class="note">הניווט והתזכורת יהיו במיקום הראשי. השם יעזור לך למצוא את המקום בתוכו.</p>`,buttons:[{label:'ביטול',act:()=>Modal.shut()},...(existing?[{label:'מחק',act:()=>{Store.delPlace(existing.id);Modal.shut();saved();}}]:[]),{label:'שמור',kind:'p',act:()=>{
   const name=document.getElementById('manualPlaceName').value.trim(),parentId=document.getElementById('manualPlaceParent').value;
   if(!name){UI.toast('כתוב שם לתת־המיקום');return;}
   if(existing){Object.assign(Store.place(existing.id),{name,parentId,lat:null,lng:null,radius:Store.place(parentId).radius});Store.commit();}
   else Store.addManualPlace(name,parentId);
   Modal.shut();saved();UI.toast('תת־המיקום נשמר');
  }}]});
 }
 return {render,state,search};
})();
