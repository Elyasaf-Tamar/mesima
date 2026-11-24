/* פתקים מהירים — לרשום ולצאת. זרם בסגנון צ׳אט, מיון אחר כך.
   The composer is static markup in shell.html; this module renders only the
   list, so a re-render never steals the caret or the open keyboard. */
const Capture=(()=>{
  const $=s=>document.querySelector(s);
  const DRAFT='mesima.captureDraft';
  let filter='all',tag='',query='',searchOpen=false,booted=false,lastCount=-1;
  const esc=s=>UI.esc(s);
  const pad=n=>String(n).padStart(2,'0');
  const dayKey=t=>{const d=new Date(t);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
  const hm=t=>{const d=new Date(t);return pad(d.getHours())+':'+pad(d.getMinutes());};
  const active=()=>!UI.screen&&UI.section==='capture';

  /* ---------- derived data ---------- */
  // Dates are read relative to when the note was written ("מחר" = the day
  // after), and labelled relative to today; a passed date is marked as such.
  function when(c){
    if(c.noDate||c.state!=='inbox')return null;
    let r;try{r=CaptureParse.parse(c.text,new Date(c.createdAt));}catch{return null;}
    if(!r)return null;
    const today=Plan.today(),past=r.date<today||r.date===today&&!!r.time&&r.time<=new Date().toTimeString().slice(0,5);
    return {...r,past,label:CaptureParse.label(r.date,r.time,new Date())+(r.date<today?' · עבר':'')};
  }
  const unsorted=()=>Store.unsortedCaptures();
  function visible(){
    const q=query.trim().toLowerCase();
    return Store.captures().filter(c=>{
      if(filter==='inbox'&&c.state!=='inbox')return false;
      if(filter==='info'&&c.state!=='info')return false;
      if(tag&&!CaptureParse.tags(c.text).has(tag))return false;
      return !q||c.text.toLowerCase().includes(q);
    });
  }
  function dayLabel(key){
    const today=Plan.today();
    if(key===today)return 'היום';
    if(key===Plan.shift(today,-1))return 'אתמול';
    const d=new Date(key+'T12:00:00'),age=Math.round((new Date(today+'T12:00:00')-d)/86400000);
    if(age>0&&age<7)return 'יום '+UI.DAYL[d.getDay()]+'׳';
    return d.toLocaleDateString('he-IL',{day:'numeric',month:'long',...(d.getFullYear()!==new Date().getFullYear()?{year:'numeric'}:{})});
  }
  // URLs and plain text are split on the raw string first, so a tag inside
  // a URL (#install) or an escaped quote can never break the link markup.
  function plainPart(text){
    return esc(text).replace(/(^|[^\p{L}\p{N}_&#])#([\p{L}\p{N}_]{1,40})/gu,(m,pre,t)=>`${pre}<button class="ctag" data-captag="${t}">#${t}</button>`);
  }
  function richText(text){
    let html='',last=0;const r=/https?:\/\/[^\s<>"'״]+/g;let m;
    while((m=r.exec(text))){
      let url=m[0].replace(/[.,;:!?)\]]+$/,'');const safe=Store.cleanUrl(url);
      html+=plainPart(text.slice(last,m.index));
      html+=safe?`<a href="${esc(safe)}" data-caplink="${esc(safe)}" dir="ltr">${esc(url)}</a>`:esc(url);
      last=m.index+url.length;r.lastIndex=last;
    }
    html+=plainPart(text.slice(last));
    return html.replace(/\n/g,'<br>');
  }
  function stateLine(c){
    if(c.state==='info')return '<span class="cst">מידע</span>';
    if(c.state==='task'){const t=c.taskId&&Store.task(c.taskId);
      return t?`<button class="cst link" data-capopen="${esc(t.id)}">✓ משימה</button>`:'<span class="cst">הפך למשימה</span>';}
    if(c.state==='note'){const n=c.noteId&&Store.note(c.noteId);
      return n?`<button class="cst link" data-capnote="${esc(n.id)}">✓ ${esc(n.title||'הערה')}</button>`:'<span class="cst">הועבר להערה</span>';}
    return '';
  }
  function bubble(c){
    const w=when(c);
    const chip=w?`<button class="cchip${w.uncertain?' unsure':''}${w.past?' past':''}" data-capdate="${esc(c.id)}" title="${w.uncertain?'השעה משוערת · לחץ לביטול הזיהוי':'לחץ לביטול הזיהוי'}">${esc(w.label)}${w.uncertain?' ?':''}</button>`:'';
    return `<div class="cbub st-${c.state}" data-cap="${esc(c.id)}" role="button" tabindex="0">
      <div class="ct">${richText(c.text)}</div>
      <div class="cm">${chip}${stateLine(c)}<span class="ctime">${hm(c.createdAt)}</span></div></div>`;
  }

  /* ---------- rendering ---------- */
  function tools(){
    const n=unsorted().length,info=Store.captures().filter(c=>c.state==='info').length;
    const b=(k,label)=>`<button data-capf="${k}" aria-selected="${filter===k}">${label}</button>`;
    return `<div class="tabrow"><div class="tabs">${b('all','הכול')}${b('inbox','לסדר'+(n?' · '+n:''))}${b('info','מידע'+(info?' · '+info:''))}</div>
      ${n?'<button class="hbtn sm" data-capreview aria-label="מיון פתקים" title="מיון">⇅</button>':''}
      <button class="hbtn sm" data-capsearch aria-label="חיפוש בפתקים">⌕</button></div>
      ${tag?`<div class="ctagbar">מסונן לפי <b>#${esc(tag)}</b> <button class="txtbtn" data-capclear>× הסר</button></div>`:''}`;
  }
  function render(){
    const list=$('#capList');if(!list)return;
    $('#capTools').innerHTML=tools();
    const bar=$('#capSearchBar');bar.hidden=!searchOpen;
    const rows=visible();
    if(!Store.captures().length){
      list.innerHTML=`<div class="empty"><div class="h">כתוב לעצמך</div><div class="d">מילה, רעיון, משהו לזכור או לעשות — כותבים למטה ושולחים.<br>
        אפשר לכתוב תאריך ושעה כמו ״מחר ב־5״, ולהפוך את הפתק למשימה אחר כך.</div></div>`;
      return;
    }
    if(!rows.length){list.innerHTML='<div class="empty"><div class="d">אין פתקים שמתאימים לסינון</div></div>';return;}
    let html='',prev='';
    for(const c of rows){const k=dayKey(c.createdAt);if(k!==prev){html+=`<div class="cday"><span>${esc(dayLabel(k))}</span></div>`;prev=k;}html+=bubble(c);}
    const main=document.querySelector('main'),atEnd=main.scrollHeight-main.scrollTop-main.clientHeight<80;
    list.innerHTML=html;
    if(atEnd||lastCount!==rows.length)requestAnimationFrame(()=>{main.scrollTop=main.scrollHeight;});
    lastCount=rows.length;
  }
  function chrome(on){
    const bar=$('#capBar');if(bar)bar.hidden=!on;
    $('#app')?.classList.toggle('cap-on',!!on);
    const n=unsorted().length,badge=$('#capBadge');
    if(badge){badge.hidden=!n;badge.textContent=n>99?'99+':String(n);}
  }
  function todayCard(){
    const rows=unsorted();if(!rows.length)return '';
    return `<button class="ccard" data-capreview><span class="cc-n">${rows.length}</span>
      <span class="cc-b"><b>${rows.length===1?'פתק אחד לסדר':rows.length+' פתקים לסדר'}</b><small>${esc(rows[0].text.slice(0,70))}</small></span><span class="chev">‹</span></button>`;
  }

  /* ---------- writing ---------- */
  function grow(){const i=$('#capInput');i.style.height='auto';i.style.height=Math.min(i.scrollHeight,160)+'px';}
  function send(){
    const i=$('#capInput'),text=i.value;
    if(!text.trim()){i.focus();return;}
    let c;try{c=Store.addCapture(text);}catch(e){UI.toast(e.message||'לא נשמר');return;}
    if(!c)return;
    i.value='';try{localStorage.removeItem(DRAFT);}catch{}
    grow();filter=filter==='info'?'all':filter;tag='';query='';searchOpen=false;
    render();chrome(active());i.focus();
  }

  /* ---------- actions ---------- */
  function convert(c,afterSave){
    const w=CaptureParse.parse(c.text,new Date(c.createdAt));
    const today=Plan.today(),use=!c.noDate&&w,title=use?CaptureParse.strip(c.text,w):c.text.trim();
    const firstLine=title.split('\n')[0].slice(0,140),rest=title.length>firstLine.length?title.slice(firstLine.length).trim():'';
    const preset={title:firstLine||c.text.slice(0,140),note:rest};
    // Never preset a date or reminder that has already passed.
    if(use&&w.date>=today){preset.planned=w.date;
      if(w.time&&(w.date>today||w.time>new Date().toTimeString().slice(0,5)))preset.reminder={type:'time',at:w.time};}
    window.__taskModal?.({preset,planned:preset.planned,
      onCreated:id=>Store.updateCapture(c.id,{state:'task',taskId:id}),afterSave});
  }
  function toNote(c,after){
    const notes=Store.notes().slice(0,40);
    Modal.open({title:'העבר להערה',
      body:`<button class="pick" data-tonote="new"><span class="pn">+ הערה חדשה</span></button>`+
        notes.map(n=>`<button class="pick" data-tonote="${esc(n.id)}"><span class="pn">${esc(n.title||'ללא כותרת')}</span><span class="pm">${esc(UI.fmtDate(n.updatedAt))}</span></button>`).join(''),
      buttons:[{label:'ביטול',act:()=>Modal.shut()}]});
    Modal.body.addEventListener('click',e=>{
      const b=e.target.closest('[data-tonote]');if(!b)return;
      const para='<p>'+esc(c.text).replace(/\n/g,'<br>')+'</p>';
      try{Store.transaction(()=>{
        let id=b.dataset.tonote;
        if(id==='new')id=Store.addNote({title:c.text.split('\n')[0].slice(0,60),html:para}).id;
        else{const n=Store.note(id);if(!n)throw Error('ההערה לא נמצאה');
          if(n.multipart){const p={id:crypto.randomUUID(),title:dayLabel(dayKey(c.createdAt)),html:para,createdAt:Date.now(),updatedAt:Date.now(),
              order:Math.max(-1,...Object.values(n.parts||{}).map(x=>x?.order||0))+1};
            Store.updateNote(id,{parts:{...n.parts,[p.id]:p}});}
          else Store.updateNote(id,{html:(n.html||'')+para});}
        Store.updateCapture(c.id,{state:'note',noteId:id});
      });}catch(error){Modal.shut();UI.toast(error.message||'לא ניתן להעביר להערה');return;}
      Modal.shut();UI.toast('הועבר להערה');after?.();
    });
  }
  function edit(c){
    Modal.open({title:'עריכת פתק',body:`<textarea id="capEdit" rows="5">${esc(c.text)}</textarea>`,
      buttons:[{label:'ביטול',act:()=>Modal.shut()},{label:'שמור',kind:'p',act:()=>{
        const v=document.getElementById('capEdit').value;if(!v.trim()){UI.toast('פתק ריק לא נשמר');return;}
        Store.updateCapture(c.id,{text:v});Modal.shut();}}]});
    setTimeout(()=>document.getElementById('capEdit')?.focus(),60);
  }
  function remove(c){
    const copy=Store.delCapture(c.id);if(!copy)return;
    UI.undo('הפתק נמחק',()=>Store.restoreCapture(copy));
  }
  async function copy(c){
    try{await navigator.clipboard.writeText(c.text);UI.toast('הועתק');}
    catch{const t=document.createElement('textarea');t.value=c.text;document.body.append(t);t.select();
      try{document.execCommand('copy');UI.toast('הועתק');}catch{UI.toast('לא ניתן להעתיק');}t.remove();}
  }
  function menu(id){
    const c=Store.capture(id);if(!c)return;
    const w=when(c),opt=(k,label,dsc='')=>`<button class="pick" data-capact="${k}"><span class="pn">${label}${dsc?`<div class="dsc">${dsc}</div>`:''}</span></button>`;
    let body=`<div class="cpreview">${richText(c.text)}</div>`;
    if(c.state==='task'&&c.taskId&&Store.task(c.taskId))body+=opt('opentask','פתח את המשימה');
    else body+=opt('task','הפוך למשימה',w?'עם '+esc(w.label):'');
    body+=c.state==='info'?opt('inbox','החזר ל״לסדר״'):c.state==='inbox'?opt('info','סמן כמידע','נשאר כאן לחיפוש, ויוצא מהמונה'):'';
    if(c.state!=='note')body+=opt('note','העבר להערה');
    body+=opt('edit','ערוך')+opt('copy','העתק')+opt('delete','מחק');
    Modal.open({title:'פתק',body,buttons:[{label:'סגור',act:()=>Modal.shut()}]});
    Modal.body.addEventListener('click',e=>{
      const b=e.target.closest('[data-capact]');if(!b)return;const k=b.dataset.capact;
      if(k==='note'){toNote(c);return;}
      Modal.shut();
      if(k==='task')convert(c);
      else if(k==='opentask')window.__openTask?.(c.taskId);
      else if(k==='info'||k==='inbox')Store.updateCapture(c.id,{state:k});
      else if(k==='edit')edit(c);
      else if(k==='copy')copy(c);
      else if(k==='delete')remove(c);
    });
  }

  /* ---------- review: one note at a time ---------- */
  // "דלג" moves a note to the back of this review session only.
  const skipped=new Set();
  function review(){
    const rows=unsorted();
    if(!rows.length){skipped.clear();Modal.shut();UI.toast('הכול מסודר');return;}
    if(rows.every(c=>skipped.has(c.id)))skipped.clear();
    const c=rows.find(x=>!skipped.has(x.id)),w=when(c);
    Modal.open({title:'מיון פתקים · נשארו '+rows.length,
      body:`<div class="creview"><div class="ct">${richText(c.text)}</div>
        <div class="cm">${w?`<span class="cchip${w.uncertain?' unsure':''}">${esc(w.label)}</span>`:''}<span class="ctime">${esc(dayLabel(dayKey(c.createdAt)))} · ${hm(c.createdAt)}</span></div></div>
        <div class="crev-btns">
          <button class="btn p" data-rev="task">משימה</button>
          <button class="btn" data-rev="info">מידע</button>
          <button class="btn" data-rev="note">להערה</button>
          <button class="btn" data-rev="delete">מחק</button></div>`,
      buttons:[{label:'סיום',act:()=>{skipped.clear();Modal.shut();}},...(rows.length>1?[{label:'דלג',act:()=>{skipped.add(c.id);review();}}]:[])]});
    Modal.body.addEventListener('click',e=>{
      const b=e.target.closest('[data-rev]');if(!b)return;const k=b.dataset.rev;
      if(k==='task'){Modal.shut();convert(c,()=>{if(unsorted().length)review();});return;}
      if(k==='note'){toNote(c,()=>setTimeout(review,0));return;}
      if(k==='info')Store.updateCapture(c.id,{state:'info'});
      if(k==='delete'){const copy=Store.delCapture(c.id);UI.undo('הפתק נמחק',()=>Store.restoreCapture(copy));}
      review();
    });
  }

  /* ---------- settings ---------- */
  function settingsNote(){
    const p=Store.all.prefs;return (p.captureReview?'מיון ב־'+p.captureReview:'בלי תזכורת מיון')+(p.captureStart!==false?' · פתיחה בפתקים':'');
  }
  function settingsHTML(){
    const p=Store.all.prefs;
    return `<div class="set"><div class="sb"><div class="st">פתיחה במסך הפתקים</div><div class="sd">כשהאפליקציה עולה מחדש, היא נפתחת ישר לכתיבה</div></div>
        <button class="sw" id="capStartSw" aria-checked="${p.captureStart!==false}"></button></div>
      <div class="set"><div class="sb"><div class="st">תזכורת מיון יומית</div><div class="sd">פעם ביום, רק אם יש פתקים שעוד לא סודרו${window.MesimaNative?'. בטלפון היא מוצגת כרגע בתוך האפליקציה (כרטיס במסך היום); התראה ברקע תגיע עם גרסת APK הבאה':''}</div></div>
        <button class="sw" id="capReviewSw" aria-checked="${!!p.captureReview}"></button></div>
      ${p.captureReview?`<div class="set"><div class="sb"><div class="st">שעת המיון</div></div><input type="time" id="capReviewAt" value="${esc(p.captureReview)}" style="width:auto"></div>`:''}
      <div class="sd" style="margin-top:14px">טיפים: Enter שולח · אפשר לכתוב ״מחר ב־5״, ״ביום רביעי בערב״ או ״בעוד שעה״ · #מילה הופכת לתגית.</div>`;
  }

  /* ---------- wiring ---------- */
  function boot(){
    // Cold start only: the WebView/Electron page is fresh, so this runs once.
    if(Store.all.prefs.captureStart!==false)UI.section='capture';
  }
  function init(){
    if(booted)return;booted=true;
    const i=$('#capInput');
    try{i.value=localStorage.getItem(DRAFT)||'';}catch{}
    grow();
    i.addEventListener('input',()=>{grow();try{if(i.value)localStorage.setItem(DRAFT,i.value);else localStorage.removeItem(DRAFT);}catch{}});
    i.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}
    });
    $('#capSend').addEventListener('click',e=>{e.preventDefault();send();});
    $('#capSend').addEventListener('mousedown',e=>e.preventDefault()); // keep the keyboard open
    $('#capSearch').addEventListener('input',e=>{query=e.target.value;render();});
    document.addEventListener('click',e=>{
      const t=e.target;
      const review_=t.closest('[data-capreview]');if(review_){e.preventDefault();skipped.clear();review();return;}
      // Links may also appear in the note menu and review previews.
      const link=t.closest('[data-caplink]');if(link){e.preventDefault();e.stopPropagation();try{window.open(link.dataset.caplink,'_blank','noopener');}catch{}return;}
      if(!t.closest('#s-capture'))return;
      const tg=t.closest('[data-captag]');if(tg){e.stopPropagation();tag=tg.dataset.captag;filter='all';render();return;}
      const dt=t.closest('[data-capdate]');if(dt){e.stopPropagation();Store.updateCapture(dt.dataset.capdate,{noDate:true});UI.toast('זיהוי התאריך בוטל');return;}
      const op=t.closest('[data-capopen]');if(op){e.stopPropagation();window.__openTask?.(op.dataset.capopen);return;}
      const nt=t.closest('[data-capnote]');if(nt){e.stopPropagation();NoteView.open(nt.dataset.capnote);return;}
      const f=t.closest('[data-capf]');if(f){filter=f.dataset.capf;render();return;}
      if(t.closest('[data-capclear]')){tag='';render();return;}
      if(t.closest('[data-capsearch]')){searchOpen=!searchOpen;if(!searchOpen){query='';$('#capSearch').value='';}render();if(searchOpen)$('#capSearch').focus();return;}
      const b=t.closest('[data-cap]');if(b&&!window.getSelection()?.toString())menu(b.dataset.cap);
    });
    document.addEventListener('keydown',e=>{if(e.target.matches?.('[data-cap]')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();menu(e.target.dataset.cap);}});
    document.addEventListener('click',e=>{
      const t=e.target;
      if(t.id==='capStartSw'){Store.setPref('captureStart',Store.all.prefs.captureStart===false);UI.render();}
      if(t.id==='capReviewSw'){Store.setPref('captureReview',Store.all.prefs.captureReview?'':'20:30');UI.render();}
    });
    document.addEventListener('change',e=>{if(e.target.id==='capReviewAt'&&/^\d{2}:\d{2}$/.test(e.target.value)){Store.setPref('captureReview',e.target.value);}});
    // Sync and edits elsewhere refresh the list even while the composer has focus.
    Store.onChange(()=>{if(active())render();chrome(active());});
    window.__captureReview=()=>{document.activeElement?.blur?.();UI.screen=null;UI.section='today';UI.render();skipped.clear();review();};
  }
  return {boot,init,render,chrome,todayCard,review,settingsHTML,settingsNote};
})();
