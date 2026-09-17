const Wire = (() => {
  const $  = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = UI.esc;
  const CAT = { army:'צבא', home:'בית', free:'אישי' };
  const DAYL = ['א','ב','ג','ד','ה','ו','ש'];

  function init(){

    /* ================= מעטפת ================= */
    $('#nav').addEventListener('click', e => {
      const b = e.target.closest('button[data-s]'); if(!b) return;
      if (b.dataset.s === 'today'){ UI.trail.length = 0; UI.tview = 'day';
                                    UI.selDate = Plan.today(); UI.rangeFrom = Plan.today(); }
      UI.screen = null; UI.section = b.dataset.s; UI.openNote = null; UI.openList = null;
      UI.render();
    });

    /* תפריט עליון: ארכיון · מקומות · הגדרות (סעיף 4) */
    $('#topMenu').addEventListener('click', () => {
      Modal.open({ title:'משימה',
        body:`<button class="pick" data-go="archive"><span class="pn">ארכיון</span>
                <span class="pm">${Store.archivedCount()} פריטים</span></button>
              <button class="pick" data-go="places"><span class="pn">מקומות</span>
                <span class="pm">${Store.all.places.length}</span></button>
              <button class="pick" data-go="settings"><span class="pn">הגדרות</span></button>`,
        buttons:[{label:'סגור',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-go]'); if(!b) return;
        Modal.shut(); UI.screen = b.dataset.go; UI.render();
      });
    });

    /* כפתור הוספה — משתמש בהקשר ולא שואל מה שכבר ידוע (סעיף 43) */
    $('#fab').addEventListener('click', () => {
      if (UI.screen === 'notes'){ openNote(Store.addNote({}).id); return; }
      if (UI.screen === 'lists'){ newList(); return; }
      if (UI.section === 'tasks'){ addFlow(); return; }
      Modal.open({ title:'מה להוסיף?',
        body:`<button class="pick" data-add="task"><span class="pn">משימה
                <div class="dsc">משהו שצריך לעשות, ואחר כך לסמן שבוצע.</div></span></button>
              <button class="pick" data-add="event"><span class="pn">אירוע
                <div class="dsc">משהו שקורה בשעה מסוימת, עם התחלה וסוף.</div></span></button>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-add]'); if(!b) return;
        Modal.shut();
        if (b.dataset.add === 'task') taskModal({ planned: UI.selDate });
        else eventModal(null);
      });
    });

    /* ----------------------------------------------------------------
       זרימת ההוספה במסך המשימות. תת-משימה, הרגל וצ׳קליסט נוצרים מכאן —
       בלי להיכנס מראש לפרטי משימת האב. פריט בודד לא מופיע כאן: הוא
       שייך לצ׳קליסט מסוים, ומוסיפים אותו מתוכו.
       ---------------------------------------------------------------- */
    function addFlow(){
      const roots = Store.allRoots();
      Modal.open({ title:'מה תרצה לעשות?',
        body:`<button class="pick" data-f="new"><span class="pn">משימה חדשה
                <div class="dsc">משהו שעומד בפני עצמו.</div></span></button>
              ${roots.length ? `<button class="pick" data-f="into"><span class="pn">להוסיף למשימה קיימת
                <div class="dsc">להוסיף למשימה ארוכת טווח תת-משימה, צ׳קליסט או הרגל.</div></span></button>` : ''}`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-f]'); if(!b) return;
        if (b.dataset.f === 'new'){
          taskModal(UI.filter === 'all' ? {} : { mission: UI.filter });
          return;
        }
        pickTargetTask();
      });
    }

    /** בחירת משימת אב, לפי היררכיה וחיפוש */
    function pickTargetTask(){
      let q = '';
      const line = (t, depth) => `<button class="pick" data-t="${t.id}"
          style="padding-inline-start:${depth*16}px">
          <span class="pn">${depth ? '<span style="opacity:.45">↳ </span>' : ''}${esc(t.title)}</span>
          <span class="pm">${depth ? '' : CAT[t.mission]}</span></button>`;
      function branch(t, depth){
        /* פריט חוזר הוא פעולה אטומית ולכן אינו יעד חוקי להוספה */
        if (!Store.canHoldContent(t)) return '';
        const kids = Store.subtasksOf(t.id);
        const sub  = kids.map(k => branch(k, depth + 1)).filter(Boolean);
        const hit  = !q || t.title.toLowerCase().includes(q);
        if (!hit && !sub.length) return '';
        return line(t, depth) + sub.join('');
      }
      const listHTML = () => Store.allRoots().map(t => branch(t, 0)).filter(Boolean).join('')
        || '<div class="ex" style="padding:14px 2px">אין התאמה</div>';

      Modal.open({ title:'לאיזו משימה?',
        body:`<input type="search" id="tgQ" placeholder="חיפוש משימה…" autocomplete="off">
              <div id="tgList">${listHTML()}</div>`,
        buttons:[{label:'חזרה',act:()=>addFlow()}]});
      Modal.body.addEventListener('input', e => {
        if (e.target.id !== 'tgQ') return;
        q = e.target.value.trim().toLowerCase();
        document.getElementById('tgList').innerHTML = listHTML();
      });
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-t]'); if(!b) return;
        pickWhatToAdd(b.dataset.t);
      });
    }

    function pickWhatToAdd(taskId){
      const t = Store.task(taskId); if(!t) return;
      /* "הרגל" כבר אינו דבר נפרד ליצור. תת-משימה שחוזרת היא ההרגל —
         בוחרים "חוזרת" בהתראה שלה, וזהו. שני מסלולים לאותו דבר היו
         בדיוק סוג הכפילות שהמוצר הזה מנסה להיפטר ממנה. */
      Modal.open({ title:'להוסיף ל"' + t.title + '"',
        body:`<button class="pick" data-w="sub"><span class="pn">תת-משימה
                <div class="dsc">פעולה שצריך לבצע כחלק מהמשימה. למשל "לכבס מדים".
                  אם היא חוזרת בימים קבועים — בחר "חוזרת" בהתראה שלה.</div></span></button>
              <button class="pick" data-w="cl"><span class="pn">צ׳קליסט
                <div class="dsc">תוכן פשוט לסימון, עם שם משלו. למשל "ציוד לקחת".</div></span></button>`,
        buttons:[{label:'חזרה',act:()=>pickTargetTask()}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-w]'); if(!b) return;
        if (b.dataset.w === 'sub'){ taskModal({ parentId:taskId, mission:t.mission }); return; }
        newChecklistModal(taskId);
      });
    }

    /**
     * יצירת צ׳קליסט. "רגיל או חוזר" היא שאלה שנשאלת כאן, בזרימה, ולא
     * פעולה נסתרת בתפריט ⋯ שצריך לגלות אחר כך. חוזר נשאר צ׳קליסט —
     * הוא לא הופך להרגל ולא למשימה, והוא נשאר מחובר למשימה שלו.
     */
    /**
     * שאלת ההגדרה של צ׳קליסט חדש — שם, וחד-פעמי מול רב-פעמי. משמשת גם
     * ליצירה מתוך זרימת ה-+ וגם להוספת צ׳קליסט לתוך מיכל, כדי שהשאלה
     * תישאל אותו דבר בשני המקומות.
     */

    function checklistSetupModal(done, back, cur){
      const c0 = cur || {};
      let rep = !!(c0.repeat && (c0.repeat.days||[]).length);
      let days = rep ? c0.repeat.days.slice() : [6];
      let skipTypes = rep ? (c0.repeat.skipTypes||[]).slice() : [];
      let skipScope = (rep && c0.repeat.skipScope === 'week') ? 'week' : 'day';
      let around = !!(rep && c0.repeat.around);
      const types = Store.eventTypes();
      const editing = !!cur;
      Modal.open({ title: editing ? 'הגדרות הצ׳קליסט' : 'צ׳קליסט חדש', body:`
        <div style="margin-bottom:12px"><label>שם הצ׳קליסט</label>
          <input type="text" id="clNew" value="${esc(c0.name || '')}"
                 placeholder="למשל: ציוד ליום ראשון" autocomplete="off"></div>
        <label>איזה צ׳קליסט</label>
        <div class="seg" id="clKind">
          <button data-ck="once" aria-selected="${!rep}">חד-פעמי</button>
          <button data-ck="rep"  aria-selected="${rep}">רב-פעמי</button>
        </div>
        <div class="ex" id="clKindEx">${rep
          ? 'קבוצת פריטים שחוזרת. היא נשארת צ׳קליסט — לא הרגל ולא משימה.'
          : 'רשימה אחת לסימון. אפשר לקבוע לה שעה, או להשאיר אותה בלי.'}</div>

        <div id="clOnceBox" ${rep ? 'hidden' : ''}>
          <label style="margin-top:12px">תזכורת — אופציונלי</label>
          <div class="fgrid">
            <div><input type="date" id="clOnceDate" value="${esc(c0.onceDate || '')}"></div>
            <div><input type="time" id="clOnceTime" value="${esc(c0.onceTime || '')}"></div>
          </div>
          <div class="ex">אם תמלא שעה — תקבל תזכורת אחת על הצ׳קליסט הזה.
            אפשר גם להשאיר ריק.</div>
        </div>

        <div id="clRepBox" ${rep ? '' : 'hidden'}>
          <label style="margin-top:12px">באילו ימים</label>
          <div class="days" id="clNewDays">${DAYL.map((x,i) =>
            `<button data-d="${i}" aria-selected="${days.includes(i)}">${x}</button>`).join('')}</div>
          <label style="margin-top:12px">באיזו שעה</label>
          <input type="time" id="clNewTime" value="${esc((c0.repeat && c0.repeat.time) || '23:00')}">
          <div class="ex">אותו צ׳קליסט חוזר בכל מחזור. סימון כל הפריטים סוגר את
            המחזור לבד, מחזור שלא הספקת נשאר פתוח, והסימונים מתאפסים שש שעות
            לפני המופע הבא.</div>
          ${types.length ? `
          <div class="esechead" style="margin-top:14px"><span>חריגים</span></div>
          <div class="ex">דלג כשיש אירוע מסוג…</div>
          <div id="clSkip2" style="margin-top:6px">${types.map(x => `
            <button class="pick" data-skt2="${x.id}" aria-checked="${skipTypes.includes(x.id)}"
                    style="border-bottom:0;padding:8px 2px">
              <span class="bx">✓</span>
              <span class="edot" style="background:${x.color};width:10px;height:10px"></span>
              <span class="pn">${esc(x.name)}</span></button>`).join('')}</div>
          <div id="clScope2Wrap" ${skipTypes.length ? '' : 'hidden'}>
            <label style="margin-top:10px">מתי לדלג</label>
            <div class="seg" id="clScope2">
              <button data-sc="day"  aria-selected="${skipScope==='day'}">ביום האירוע</button>
              <button data-sc="week" aria-selected="${skipScope==='week'}">בשבוע של האירוע</button>
            </div></div>` : ''}
          <div class="esechead" style="margin-top:14px"><span>התאמה סביב אירועים</span></div>
          <button class="pick" id="clAround2" aria-checked="${around}"
                  style="border-bottom:0;padding:8px 2px">
            <span class="bx">✓</span>
            <span class="pn">אל תזכיר באמצע אירוע</span></button>
          <div class="ex">המחזור עדיין נדרש — הוא רק לא יצלצל באמצע האירוע.
            תזכורת הכנה שש שעות לפני, ותזכורת מעקב שעתיים אחרי.</div>
        </div>`,
        buttons:[{label:'ביטול',act:()=>{ Modal.shut(); back && back(); }},
                 {label: editing ? 'שמור' : 'צור', kind:'p', act:()=>{
                    const n = (document.getElementById('clNew').value || '').trim() || 'צ׳קליסט';
                    if (rep && !days.length){ UI.toast('צריך לבחור לפחות יום אחד'); return; }
                    const time = (document.getElementById('clNewTime')||{}).value || '23:00';
                    const od = (document.getElementById('clOnceDate')||{}).value || '';
                    const ot = (document.getElementById('clOnceTime')||{}).value || '';
                    Modal.shut();
                    done({ name:n,
                      repeat: rep
                        ? { days:days.slice(), time, skipTypes:skipTypes.slice(), skipScope, around }
                        : null,
                      onceDate: rep ? '' : od, onceTime: rep ? '' : ot });
                 }}]});
      Modal.body.addEventListener('click', e => {
        const k = e.target.closest('#clKind button');
        if (k){
          rep = k.dataset.ck === 'rep';
          Modal.body.querySelectorAll('#clKind button').forEach(x =>
            x.setAttribute('aria-selected', x === k));
          document.getElementById('clRepBox').hidden = !rep;
          document.getElementById('clOnceBox').hidden = rep;
          document.getElementById('clKindEx').textContent = rep
            ? 'קבוצת פריטים שחוזרת. היא נשארת צ׳קליסט — לא הרגל ולא משימה.'
            : 'רשימה אחת לסימון. אפשר לקבוע לה שעה, או להשאיר אותה בלי.';
          return;
        }
        const d = e.target.closest('#clNewDays button');
        if (d){ const i = +d.dataset.d;
                days = days.includes(i) ? days.filter(x => x !== i) : days.concat(i);
                d.setAttribute('aria-selected', days.includes(i)); return; }
        const sk = e.target.closest('[data-skt2]');
        if (sk){ const id = sk.dataset.skt2;
                 skipTypes = skipTypes.includes(id) ? skipTypes.filter(x => x !== id) : skipTypes.concat(id);
                 sk.setAttribute('aria-checked', skipTypes.includes(id));
                 const w = document.getElementById('clScope2Wrap'); if (w) w.hidden = !skipTypes.length;
                 return; }
        const sc = e.target.closest('#clScope2 button');
        if (sc){ skipScope = sc.dataset.sc;
                 Modal.body.querySelectorAll('#clScope2 button').forEach(x =>
                   x.setAttribute('aria-selected', x === sc)); return; }
        if (e.target.closest('#clAround2')){
          around = !around;
          document.getElementById('clAround2').setAttribute('aria-checked', around); return; }
      });
      Modal.closeGuard = () => { Modal.shut(); if(back) back(); return false; };
      setTimeout(() => document.getElementById('clNew')?.focus(), 60);
    }

    // The shared setup screen only produces a draft. Store is touched on Save.
    function newChecklistModal(taskId, back){
      const cancel = () => { Modal.shut(); if (back) back(); else pickWhatToAdd(taskId); };
      let cfg = null, items = [];
      const settings = () => checklistSetupModal(next => { cfg=next; editor(); },
        () => cfg ? editor() : cancel(), cfg);
      function editor(){
        const paint = () => {
          document.getElementById('draftClItems').innerHTML = items.map((x,i) =>
            `<div class="subrow"><span class="sb2">${esc(x)}</span>
             <button class="x" data-draft-remove="${i}" aria-label="הסר פריט">×</button></div>`).join('');
        };
        const add = () => {
          const input=document.getElementById('draftClInput'), title=input.value.trim();
          if(title){items.push(title);input.value='';paint();} input.focus();
        };
        Modal.open({title:cfg.name,body:`
          <div class="ex">${cfg.repeat ? 'צ׳קליסט חוזר' : 'צ׳קליסט חד־פעמי'} · יתווסף למשימה רק אחרי שמירה.</div>
          <button class="txtbtn" id="draftClSettings">הגדרות הצ׳קליסט</button>
          <div id="draftClItems"></div>
          <div class="subrow"><input id="draftClInput" type="text" placeholder="פריט חדש" autocomplete="off">
          <button class="btn" id="draftClAdd">הוסף פריט</button></div>`,
          buttons:[{label:'בטל צ׳קליסט',act:cancel},{label:'שמור צ׳קליסט',kind:'p',act:()=>{
            add(); if(!items.length){UI.toast('הוסף לפחות פריט אחד');return;}
            const c=Store.addChecklist(taskId,cfg.name);
            if(!c){UI.toast('אי אפשר להוסיף כאן צ׳קליסט');return;}
            items.forEach(title=>Store.addChecklistItem(taskId,c.id,title,''));
            if(cfg.repeat) Store.setChecklistRepeat(taskId,c.id,cfg.repeat);
            else if(cfg.onceTime) Store.setChecklistOnce(taskId,c.id,{date:cfg.onceDate||Plan.today(),time:cfg.onceTime});
            Modal.shut(); checklistView(taskId,c.id);
          }}]});
        Modal.closeGuard=()=>{cancel();return false;};
        document.getElementById('draftClAdd').onclick=add;
        document.getElementById('draftClSettings').onclick=()=>{add();settings();};
        document.getElementById('draftClInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add();}};
        Modal.body.addEventListener('click',e=>{const b=e.target.closest('[data-draft-remove]');
          if(b){items.splice(+b.dataset.draftRemove,1);paint();}});
        paint();document.getElementById('draftClInput').focus();
      }
      settings();
    }


    /* ================= היום ================= */
    /* שומר את מצב התצוגה הנוכחי לפני מעבר, בשביל כפתור החזרה */
    function mark(){
      const st = { tview:UI.tview, selDate:UI.selDate, rangeFrom:UI.rangeFrom,
                   calY:UI.calY, calM:UI.calM };
      const last = UI.trail[UI.trail.length-1];
      if (last && last.tview===st.tview && last.selDate===st.selDate
          && last.rangeFrom===st.rangeFrom) return;
      UI.trail.push(st);
      if (UI.trail.length > 20) UI.trail.shift();
    }

    $('#tvModes').addEventListener('click', e => {
      const b = e.target.closest('button'); if(!b) return;
      if (b.dataset.v === UI.tview && b.dataset.v !== 'day') return;
      mark();
      UI.tview = b.dataset.v;
      if(b.dataset.v==='day'){UI.selDate=Plan.today();UI.rangeFrom=Plan.today();UI.trail.length=0;}
      if (UI.tview === 'month'){
        const [y,m] = UI.selDate.split('-').map(Number); UI.calY = y; UI.calM = m-1;
      }
      /* החלון שומר על מקומו בין מעברים. רק אם הוא נשאר מאחור — מחזירים להיום. */
      if ((UI.tview === 'd3' || UI.tview === 'week') && UI.rangeFrom < Plan.today())
        UI.rangeFrom = Plan.today();
      UI.render();
    });

    $('#todayBody').addEventListener('click', e => {
      const ntg = e.target.closest('[data-act="notetog"]');
      if (ntg){ const nid = ntg.dataset.nid;
        if (UI.noteShut.has(nid)) UI.noteShut.delete(nid); else UI.noteShut.add(nid);
        UI.render(); return; }
      if (e.target.closest('[data-act="add"]')){ $('#fab').click(); return; }

      /* צ׳קליסט חוזר ב"היום" נפתח ישר לצ׳קליסט, בלי לעבור דרך ההורה */
      const cld = e.target.closest('[data-clday]');
      if (cld){ checklistView(cld.dataset.clt, cld.dataset.clday); return; }

      const mo = e.target.closest('[data-mo]');
      if (mo){
        let m = UI.calM + (+mo.dataset.mo), y = UI.calY;
        if (m < 0){ m = 11; y--; } if (m > 11){ m = 0; y++; }
        UI.calM = m; UI.calY = y; UI.render(); return;
      }
      const rng = e.target.closest('[data-rng]');
      if (rng){
        UI.rangeFrom = rng.dataset.rng === 'today'
          ? Plan.today() : Plan.shift(UI.rangeFrom, +rng.dataset.rng);
        UI.render(); return;
      }
      const dayBtn = e.target.closest('[data-day]');
      if (dayBtn){
        if (UI.tview !== 'month' || dayBtn.dataset.day !== UI.selDate) mark();
        UI.selDate = dayBtn.dataset.day;
        if (UI.tview === 'month'){ $('#mDay').innerHTML = UI.monthDayList(UI.selDate);
                                   UI.render(); }
        else { UI.tview = 'day'; UI.render(); }
        return;
      }
      const ev = e.target.closest('[data-ev]');
      if (ev){ const o = Store.event(ev.dataset.ev); if (o) eventMenu(o); return; }

      const kid = e.target.closest('[data-kid]');
      if (kid){
        if (e.target.closest('[data-act="doneKid"]')){ finish(kid.dataset.kid); return; }
        taskModal({ id: kid.dataset.kid }); return;
      }
      const row = e.target.closest('[data-id]'); if(!row) return;
      const id = row.dataset.id;
      const act = (e.target.closest('[data-act]') || {}).dataset?.act;
      if (act === 'done'){ finish(id); return; }
      taskModal({ id });
    });

    /* ================= משימות ================= */
    $('#tFilters').addEventListener('click', e => {
      const b = e.target.closest('button'); if(!b) return;
      UI.filter = b.dataset.f; UI.render();
    });
    /* חיפוש מוסתר כברירת מחדל, נחשף בפעולה קטנה ליד המסננים */
    const openSearch = () => {
      $('#tSearchBar').hidden = false;
      $('#tSearchOpen').hidden = true;
      $('#tSearch').focus();
    };
    const closeSearch = () => {
      $('#tSearch').value = '';
      UI.taskQ = '';
      $('#tSearchBar').hidden = true;
      $('#tSearchOpen').hidden = false;
      UI.renderTasks();
    };
    $('#tSearchOpen').addEventListener('click', openSearch);
    $('#tSearchClose').addEventListener('click', closeSearch);
    /* מרנדר רק את הרשימה — שדה החיפוש עצמו לא נבנה מחדש תוך כדי הקלדה */
    $('#tSearch').addEventListener('input', e => {
      UI.taskQ = e.target.value;
      UI.renderTasks();
    });
    $('#tSearch').addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSearch();
      /* ניקוי שדה שכבר ריק סוגר את החיפוש */
      if (e.key === 'Backspace' && !e.target.value) closeSearch();
    });
    UI.closeSearch = closeSearch;

    $('#tasksBody').addEventListener('click', e => {
      const actEl = e.target.closest('[data-act]');
      const act = actEl ? actEl.dataset.act : null;

      if (act === 'notetog'){ const nid = actEl.dataset.nid;
        if (UI.noteShut.has(nid)) UI.noteShut.delete(nid); else UI.noteShut.add(nid);
        UI.renderTasks(); return; }
      if (act === 'add'){ addFlow(); return; }
      if (act === 'groupOn'){  UI.grouped = true;  UI.renderTasks(); return; }
      if (act === 'groupOff'){ UI.grouped = false; UI.renderTasks(); return; }
      if (act === 'rootOrderOn'){
        UI.reorder = { root:true, group:actEl.dataset.group }; UI.renderTasks(); return; }
      if (act === 'rootOrderOff'){ UI.reorder = null; UI.renderTasks(); return; }

      const row = e.target.closest('[data-id]'); if(!row) return;
      const id = row.dataset.id;

      if (act === 'rootup' || act === 'rootdown'){
        const ids = [...$('#tasksBody').querySelectorAll('.tcard')].map(c => c.dataset.id);
        Store.moveRootIn(id, act === 'rootup' ? -1 : 1, ids);
        return;
      }
      if (act === 'openEv'){ const o = Store.event(actEl.dataset.ev);
                             if (o) eventMenu(o); return; }
      /* שורות תת-המשימה שבתוך הכרטיס: סימון ופתיחה, ותו לא */
      if(act==='childrenToggle'){const map={...Store.all.prefs.expandedChildren};map[id]=!map[id];Store.setPref('expandedChildren',map);return;}
      if (act === 'subdone'){ finish(actEl.dataset.sid); return; }
      if (act === 'subopen'){ openTask(actEl.dataset.sid); return; }
      /* צ׳קליסט נפתח בתוך הכרטיס, ומסמנים ממנו בלי לעזוב את המסך */
      if (act === 'clToggle'){
        const k = actEl.dataset.clid;
        if (UI.openCl.has(k)) UI.openCl.delete(k); else UI.openCl.add(k);
        UI.renderTasks(); return;
      }
      if (act === 'clTick'){
        Store.toggleChecklistItem(id, actEl.dataset.iid);
        UI.renderTasks(); return;
      }
      if (act === 'clOpen'){ checklistView(id, actEl.dataset.clid); return; }
      if (act === 'done'){ finish(id); return; }
      if (act === 'menu'){ taskMenu(id); return; }
      if (act === 'open' && UI.taskQ){ revealTask(id); return; }
      if (UI.reorder) return;
      /* נגיעה רגילה פותחת פרטים — לא טופס עריכה, ולא חלון ביניים.
         משימה שכולה צ׳קליסט נפתחת ישר לצ׳קליסט. */
      openTask(id);
    });

    /**
     * הפתיחה הנכונה למשימה. אם המשימה היא בעצם צ׳קליסט — כלומר קצרת
     * טווח שכל התוכן שלה הוא צ׳קליסט אחד, בלי תת-משימות — אין סיבה
     * להעביר את המשתמש דרך מסך פרטים כדי להגיע לפריטים.
     */
    function openTask(id){
      const only = Store.soleChecklist(id);
      if (only) checklistView(id, only.id);
      else taskDetail(id);
    }

    /** תוצאת חיפוש: פותחים את כל ההורים ומנקים את החיפוש (סעיף 36) */
    /** תוצאת חיפוש נפתחת ישר בפרטים שלה — שם באמת משתמשים בה */
    function revealTask(id){
      if (UI.closeSearch) UI.closeSearch(); else { UI.taskQ = ''; $('#tSearch').value = ''; }
      Store.commit();
      setTimeout(() => openTask(id), 40);
    }

    /** ✓ — להרגל סימון יומי, לשאר סיום + ארכיון (סעיפים 25, 31) */
    function finish(id){
      const t = Store.task(id); if(!t) return;
      if (Store.isHabit(t)){
        const was = Store.habitFull(t, Plan.today());
        Store.toggleTask(id);
        UI.toast(was ? 'הסימון בוטל' : 'סומן להיום');
        return;
      }
      if (t.kind === 'long'){ UI.toast('פריט ארוך-טווח נסגר מהתפריט'); return; }
      Store.finishTask(id);
      UI.undo('הושלם ונשמר בסיכום היום',()=>Store.undoCompletion(id));
    }

    /* ================= ספרייה ================= */
    $('#s-library').addEventListener('click', e => {
      if (e.target.closest('#libAddLink')){ linkModal(null); return; }
      const lk = e.target.closest('[data-link]');
      if (lk){
        const l = Store.links().find(x => x.id === lk.dataset.link); if(!l) return;
        const act = (e.target.closest('[data-act]') || {}).dataset?.act;
        if (act === 'linkMenu'){ linkMenu(l); return; }
        openLink(l.url);
        return;
      }
      const b = e.target.closest('[data-lib]'); if(!b) return;
      UI.screen = b.dataset.lib; UI.render();
    });

    /* פתיחה בדפדפן. במעטפת המותקנת ה-WebView מוסר קישורים חיצוניים
       החוצה בעצמו (shouldOverrideUrlLoading), ולכן אותה קריאה עובדת בשניהם. */
    function openLink(url){
      try { window.open(url, '_blank', 'noopener'); }
      catch(e){ location.href = url; }
    }

    function linkModal(l){
      Modal.open({ title: l ? 'עריכת קיצור' : 'קיצור חדש', body:`
        <div style="margin-bottom:14px"><label>שם</label>
          <input type="text" id="lkName" value="${l ? esc(l.name) : ''}"
                 placeholder="למשל: מערכת השעות" autocomplete="off"></div>
        <div style="margin-bottom:6px"><label>כתובת</label>
          <input type="url" id="lkUrl" value="${l ? esc(l.url) : ''}" dir="ltr"
                 inputmode="url" placeholder="example.com" autocomplete="off"></div>
        <div class="ex">אפשר להדביק כתובת בלי https — היא תושלם לבד.
          שם ריק יקבל את שם האתר.</div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label: l ? 'שמור' : 'הוסף', kind:'p', act:()=>{
            const name = document.getElementById('lkName').value;
            const url  = document.getElementById('lkUrl').value;
            if (!Store.cleanUrl(url)){ UI.toast('כתובת לא תקינה'); return; }
            if (l) Store.updateLink(l.id, { name, url });
            else   Store.addLink(name, url);
            Modal.shut(); UI.render(); UI.toast('נשמר');
         }}]});
      setTimeout(() => document.getElementById('lkName')?.focus(), 80);
    }

    function linkMenu(l){
      const links = Store.links();
      const i = links.findIndex(x => x.id === l.id);
      Modal.open({ title:l.name,
        body:`<button class="pick" data-lm="open"><span class="pn">פתח</span>
                <span class="pm" dir="ltr" style="unicode-bidi:isolate">${esc(Store.hostOf(l.url))}</span></button>
              <button class="pick" data-lm="edit"><span class="pn">ערוך</span></button>
              ${i > 0 ? `<button class="pick" data-lm="up"><span class="pn">הזז למעלה</span></button>` : ''}
              ${i < links.length-1 ? `<button class="pick" data-lm="down"><span class="pn">הזז למטה</span></button>` : ''}
              <button class="pick" data-lm="del"><span class="pn"
                style="color:var(--danger)">מחק</span></button>`,
        buttons:[{label:'סגור',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-lm]'); if(!b) return;
        const k = b.dataset.lm;
        if (k === 'open'){ Modal.shut(); openLink(l.url); return; }
        if (k === 'edit'){ linkModal(l); return; }
        if (k === 'up' || k === 'down'){
          Store.moveLink(l.id, k === 'up' ? -1 : 1); Modal.shut(); UI.render(); return;
        }
        const gone = Store.delLink(l.id);
        Modal.shut(); UI.render();
        if (gone) UI.undo('הקיצור נמחק', () => { Store.insertLink(gone.link, gone.at); UI.render(); });
      });
    }

    /* ================= ארכיון ================= */
    $('#archiveBody').addEventListener('click', e => {
      const row = e.target.closest('[data-id]'); if(!row) return;
      if (e.target.closest('[data-act="restore"]')){
        Store.restoreTask(row.dataset.id); UI.toast('הוחזר למשימות'); return;
      }
    });

    /* ================= תפריט משימה ================= */
    /* ====================================================================
       פרטי משימה — המקום שבו משתמשים בתוכן.
       מציג רק מה שקיים: צ׳קליסט שנוצר, תת-משימות שיש, הרגלים שיש,
       ומידע מתקדם שהוגדר בפועל. עריכה היא פעולה מפורשת.
       ==================================================================== */
    function taskDetail(id){
      const t0 = Store.task(id); if(!t0) return;

      const ordOn = key => !!(UI.reorder && UI.reorder.taskId === id && UI.reorder.sec === key);
      const ordAny = () => !!(UI.reorder && UI.reorder.taskId === id);

      function head(key, name, n, acts){
        return `<div class="sechead">
          <span class="secname">${esc(name)}</span>
          ${ordOn(key)
            ? `<button class="secact" data-act="reorderOff">סיום</button>`
            : (ordAny() ? '' : acts.filter(Boolean).map(a =>
                `<button class="secact" data-d="${a[0]}"${
                  a[2] ? ` data-cl="${a[2]}"` : ''}>${a[1]}</button>`).join(''))}
        </div>`;
      }

      function body(){
        const t = Store.task(id); if(!t) return '';
        const lists = Store.checklists(id);
        const subs  = Store.subtasksOf(id);
        const habs  = Store.habitsOf(id);
        const meta  = UI.taskMeta(t, { noKids:true });
        const r     = t.reminder || {};
        const ev    = t.eventId ? Store.event(t.eventId) : null;

        /* מידע מתקדם — רק מה שהוגדר. אין שורות "לא הוגדר". */
        const facts = [];
        if (r.type === 'place') facts.push(['מיקום', UI.whereLabel(r)]);
        if (r.type === 'trip')  facts.push(['נסיעה', r.km + ' ק״מ רצוף']);

        /* ---------- סדר המסך ----------
           1. התיאור, ישר מתחת לשם. זה מה שמזכיר למה המשימה קיימת.
           2. תמונה, אם יש.
           3. שורת המידע — קטגוריה, מתי, תזכורת. היא מופרדת בקו ובתווית
              משלה, כי כשהיא ישבה בלי הפרדה היא נקראה ככותרת של התוכן
              שמתחתיה, והקטגוריה נראתה כאילו היא שייכת ליצירת תת-משימה.
           4. אירוע ורצף — הקשר.
           5. ורק אז התוכן: צ׳קליסטים, תת-משימות, חוזרות. */
        let out = '';
        out += UI.noteBlock(t);
        if(t.done)out+=`<button class="txtbtn" data-reopen-task="${t.id}">הושלמה · בטל השלמה</button>`;
        const related=Store.relatedTasks(id);if(related.length)out+=`<div class="esec"><div class="esechead"><span>מקושרת ל</span></div>${related.map(x=>`<button class="settings-row" data-related-task="${x.id}"><span>${esc(x.title)}</span><span>‹</span></button>`).join('')}</div>`;

        const info = [];
        info.push(['קטגוריה', CAT[t.mission]]);
        const when = UI.taskMeta(t, { noKids:true, noCat:true });
        if (when) info.push(['מתי', when]);
        facts.forEach(f => info.push(f));
        out += `<div class="dinfo">${info.map(([k,v]) =>
          `<div class="dfact"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>`;

        /* הרגל נושא היסטוריה — היא מידע קיים, ולכן היא מוצגת כאן */
        if (Store.isHabit(t)){
          const today = Plan.today(), cells = [];
          for (let i = 13; i >= 0; i--){
            const k = Plan.shift(today, -i);
            cells.push(`<i class="${!Store.habitDay(t,k) ? 'off'
              : (Store.habitFull(t,k) ? 'full' : '')}${k===today?' td':''}" title="${k}"
              >${DAYL[new Date(k+'T00:00:00').getDay()]}</i>`);
          }
          const n = Store.streak(t.id);
          out += `<div class="sechead"><span class="secname">רצף</span></div>
            <div class="strip">${cells.join('')}</div>
            <div class="ex">${n ? n + (n===1?' יום':' ימים') + ' ברצף' : 'עוד לא התחלת רצף'}</div>`;
        }
        /* מיכל פתוח: הפעולות שלו הן הוספת תוכן, ולכן הן יושבות מיד לפני
           התוכן ובגודל שמתאים לתפקיד שלהן. */
        if (t.kind === 'long')
          out += `<div class="dsep">הוספה למשימה</div>
            <div class="esec addrow hero" style="margin:0 0 8px">
              <button class="secact" data-d="addkid">+ תת-משימה</button>
              <button class="secact" data-d="addlist">+ צ׳קליסט</button>
            </div>
            <div class="ex" style="margin-bottom:14px">רוצה הרגל? הוסף
              <b>תת-משימה</b> ובחר לה התראה <b>חוזרת</b> — זה ההרגל.</div>`;
        if (ev) out += `<div class="esec"><div class="esechead"><span>אירוע ביומן</span>
            <button class="secact" data-d="evopen">פתח</button></div>
          <div class="evcur"><div class="el">${esc(ev.title)}</div>
            <div class="em">${esc(Plan.longDate(ev.date))}${ev.allDay ? '' : ' · ' + esc(ev.time)} · ${esc(UI.eventCountdown(ev))}</div></div></div>`;

        /* כל צ׳קליסט בנפרד, עם שמו ופריטיו */
        const canOrderLists = lists.length > 1;
        lists.forEach((c, li) => {
          const key = 'cl:' + c.id;
          const st = Store.checklistStats(id, c.id);
          out += head(key, c.name, c.items.length, [
            ['addItem','+ פריט', c.id],
            st.checked ? ['resetcl','אפס', c.id] : null,
            c.items.length > 1 ? ['reorderOn','שנה סדר', c.id] : null,
            (canOrderLists && !ordAny()) ? ['listmenu','⋯', c.id] : ['listmenu','⋯', c.id],
          ]);
          if (ordOn('lists')) return;
          out += c.items.map((x,i) => ordOn(key)
            ? `<div class="clrow ordering" data-cl="${x.id}" data-clp="${id}">
                 <span class="ct"><span>${esc(x.title)}</span></span>
                 <span class="ord">
                   <button data-act="clup" ${i===0?'disabled':''} aria-label="הזז למעלה">↑</button>
                   <button data-act="cldown" ${i===c.items.length-1?'disabled':''} aria-label="הזז למטה">↓</button>
                 </span></div>`
            : `<div class="clrow${x.checked ? ' ck' : ''}" data-cl="${x.id}" data-clp="${id}">
                 <button class="cb${x.checked ? ' on' : ''}" data-act="ckl"
                         style="width:18px;height:18px;font-size:10px;flex:0 0 auto">✓</button>
                 <button class="ct" data-act="ckopen"><span>${esc(x.title)}</span>
                   ${x.note ? `<span class="cn">${esc(x.note)}</span>` : ''}</button>
               </div>`).join('');
          if (!c.items.length && !ordAny())
            out += `<div class="secempty">הצ׳קליסט ריק. אפשר להוסיף אליו פריטים.</div>`;
        });
        if (canOrderLists && !ordAny())
          out += `<button class="secact" data-d="orderLists" style="margin-top:8px">שנה סדר צ׳קליסטים</button>`;
        if (ordOn('lists')){
          out += `<div class="sechead"><span class="secname">סדר הצ׳קליסטים</span>
            <button class="secact" data-act="reorderOff">סיום</button></div>`;
          out += lists.map((c,i) => `<div class="krow ordering" data-list="${c.id}">
            <span class="kt">${esc(c.name)}</span>
            <span class="ord">
              <button data-act="lup" ${i===0?'disabled':''} aria-label="הזז למעלה">↑</button>
              <button data-act="ldown" ${i===lists.length-1?'disabled':''} aria-label="הזז למטה">↓</button>
            </span></div>`).join('');
        }

        if (subs.length){
          out += head('subs', 'תת-משימות', subs.length,
            [['addkid','+ תת-משימה'], subs.length > 1 ? ['reorderOn2','שנה סדר'] : null]);
          out += subs.map((c,i) => childLine(c, ordOn('subs'), i, subs.length, 'kid')).join('');
        }
        if (habs.length){
          /* תצוגה בלבד. פריט חוזר נוצר כתת-משימה שההתראה שלה "חוזרת". */
          out += head('habs', 'חוזרות', habs.length,
            [habs.length > 1 ? ['reorderOn3','שנה סדר'] : null]);
          out += habs.map((c,i) => childLine(c, ordOn('habs'), i, habs.length, 'hab')).join('');
        }
        return out;
      }

      function childLine(c, ord, i, n, kind){
        if (ord) return `<div class="krow ordering" data-kid="${c.id}">
          <span class="kt">${esc(c.title)}</span>
          <span class="ord">
            <button data-act="kidup" ${i===0?'disabled':''} aria-label="הזז למעלה">↑</button>
            <button data-act="kiddown" ${i===n-1?'disabled':''} aria-label="הזז למטה">↓</button>
          </span></div>`;
        const hab = Store.isHabit(c);
        const doneToday = hab && Store.habitFull(c, Plan.today());
        const m = UI.taskMeta(c, { noCat:true, noKids:true });
        return `<div class="krow" data-kid="${c.id}">
          <button class="cb${hab?' hab':''}${doneToday?' on':''}" data-act="kiddone"
                  style="width:18px;height:18px;font-size:10px">✓</button>
          <button class="kt" data-act="kidopen" style="text-align:start">${esc(c.title)}
            ${m ? `<div class="km">${esc(m)}</div>` : ''}</button>
          ${UI.noteBlock(c)}
        </div>`;
      }

      function paint(){
        const t = Store.task(id);
        if (!t){ Modal.shut(); return; }
        document.getElementById('mTitle').textContent = t.title;
        Modal.body.innerHTML = body();
      }
      const repaintOrder=()=>{if(document.getElementById('modal').classList.contains('on')&&Modal.body.querySelector('[data-kid]'))paint();};
      document.addEventListener('tasks-reordered',repaintOrder);

      Modal.open({ title:t0.title, body:body(),close:()=>document.removeEventListener('tasks-reordered',repaintOrder),
        buttons:[{label:'עוד', act:()=>taskMenu(id)},
                 {label:'ערוך משימה', kind:'p', act:()=>taskModal({ id })}]});

      Modal.body.addEventListener('click', e => {
        const t = Store.task(id); if(!t) return;
        const a = e.target.closest('[data-act]');
        const act = a ? a.dataset.act : null;
        const d = e.target.closest('[data-d]');
        const cmd = d ? d.dataset.d : null;

        if (cmd === 'addItem'){ addItemsTo(id, d.dataset.cl, paint); return; }
        if (cmd === 'resetcl'){ resetChecklist(id, d.dataset.cl); return; }
        if (cmd === 'reorderOn'){ UI.reorder = { taskId:id, sec:'cl:' + d.dataset.cl }; paint(); return; }
        if (cmd === 'reorderOn2'){ UI.reorder = { taskId:id, sec:'subs' }; paint(); return; }
        if (cmd === 'reorderOn3'){ UI.reorder = { taskId:id, sec:'habs' }; paint(); return; }
        if (cmd === 'orderLists'){ UI.reorder = { taskId:id, sec:'lists' }; paint(); return; }
        if (cmd === 'listmenu'){ checklistMenu(id, d.dataset.cl, paint); return; }
        if (cmd === 'addkid'){ taskModal({ parentId:id, mission:t.mission }); return; }
        if (cmd === 'addlist'){ newChecklistModal(id); return; }
        if (cmd === 'evopen'){ const ev = Store.event(t.eventId);
                               if (ev){ Modal.shut(); eventMenu(ev); } return; }

        if (act === 'notetog'){ const nid=a.dataset.nid; if(UI.noteShut.has(nid)) UI.noteShut.delete(nid); else UI.noteShut.add(nid); paint(); return; }
        if (act === 'reorderOff'){ UI.reorder = null; paint(); return; }
        if (act === 'zoom'){ return; }   /* מטופל גלובלית */

        const li = e.target.closest('[data-list]');
        if (li && (act === 'lup' || act === 'ldown')){
          Store.moveChecklist(id, li.dataset.list, act === 'lup' ? -1 : 1); paint(); return;
        }
        const cli = e.target.closest('[data-cl]');
        if (cli && cli.dataset.clp){
          if (act === 'clup' || act === 'cldown'){
            Store.moveChecklistItem(id, cli.dataset.cl, act === 'clup' ? -1 : 1); paint(); return;
          }
          if (act === 'ckl'){ Store.toggleChecklistItem(id, cli.dataset.cl); paint(); return; }
          if (UI.reorder) return;
          itemModal(id, cli.dataset.cl, paint); return;
        }
        const kid = e.target.closest('[data-kid]');
        if (kid){
          if (act === 'kidup' || act === 'kiddown'){
            Store.moveChild(kid.dataset.kid, act === 'kidup' ? -1 : 1); paint(); return;
          }
          if (act === 'kiddone'){ finish(kid.dataset.kid); paint(); return; }
          if (UI.reorder) return;
          openTask(kid.dataset.kid); return;
        }
      });
      Modal.closeGuard = () => { UI.reorder = null; return true; };
    }

    /** הוספת פריטים לצ׳קליסט מסוים — מקלידים ברצף ונשארים במקום */
    /* ====================================================================
       מסך הצ׳קליסט
       צ׳קליסט הוא אובייקט עבודה בפני עצמו, ולכן יש לו מסך משלו: שם,
       פריטים, סימון, והוספה — בלי טופס משימה מסביב. לכאן מגיעים
       מהכרטיס, מ"היום", ומכל מקום שבו הצ׳קליסט הוא הדבר שעושים.
       ==================================================================== */
    function checklistView(taskId, clId){
      const t = Store.task(taskId); if(!t) return;
      const c0 = Store.checklistOf(taskId, clId); if(!c0) return;

      const head = () => {
        const c = Store.checklistOf(taskId, clId) || c0;
        const done = c.items.filter(x => x.checked).length;
        const rep = c.repeat;
        const bits = [t.title];
        if (rep) bits.push('חוזר · ' + UI.repeatLabel({ days:rep.days }) + ' ' + Recur.times(rep)[0]);
        return `<div class="clhead">
          <div class="clsub">${esc(bits.join(' · '))}</div>
          ${c.items.length ? `<div class="clprog">
            <div class="clbar"><i style="width:${Math.round(done/c.items.length*100)}%"></i></div>
            <span>${done} מתוך ${c.items.length}</span></div>` : ''}
          ${rep && Store.checklistCycleDone(c)
            ? `<div class="ex">המחזור הזה הושלם. הסימונים יתאפסו שש שעות לפני המופע הבא.</div>` : ''}
        </div>`;
      };
      const rows = () => {
        const c = Store.checklistOf(taskId, clId) || c0;
        if (!c.items.length) return `<div class="secempty">הצ׳קליסט ריק. הוסף פריט ראשון למטה.</div>`;
        return c.items.map(x => `
          <div class="clrow${x.checked ? ' ck' : ''}" data-cvi="${x.id}">
            <button class="cb${x.checked ? ' on' : ''}" data-act="cvTick"
                    style="width:20px;height:20px;font-size:11px;flex:0 0 auto">✓</button>
            <button class="ct" data-act="cvOpen"><span>${esc(x.title)}</span>
              ${x.note ? `<span class="cn">${esc(x.note)}</span>` : ''}</button>
          </div>`).join('');
      };
      const paint = () => {
        if (!Store.checklistOf(taskId, clId)){ Modal.shut(); return; }
        document.getElementById('cvHead').innerHTML = head();
        document.getElementById('cvRows').innerHTML = rows();
        UI.render();
      };

      Modal.open({ title:c0.name, body:`
        <div id="cvHead">${head()}</div>
        <div id="cvRows">${rows()}</div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <input type="text" id="cvNew" placeholder="הוסף פריט…" autocomplete="off" style="flex:1">
          <button class="btn" id="cvAdd" style="flex:0 0 auto">הוסף</button></div>`,
        buttons:[{label:'עוד', act:()=>checklistMenu(taskId, clId, () => checklistView(taskId, clId))},
                 {label:'סיום', kind:'p', act:()=>Modal.shut()}]});

      const add = () => {
        const i = document.getElementById('cvNew'), v = i.value.trim();
        if (!v) return;
        Store.addChecklistItem(taskId, clId, v, '');
        i.value = ''; paint();
        setTimeout(() => { const n = document.getElementById('cvNew'); n && n.focus(); }, 0);
      };
      Modal.body.addEventListener('click', e => {
        if (e.target.closest('#cvAdd')){ add(); return; }
        const row = e.target.closest('[data-cvi]'); if(!row) return;
        const act = (e.target.closest('[data-act]') || {}).dataset?.act;
        if (act === 'cvTick'){ Store.toggleChecklistItem(taskId, row.dataset.cvi); paint(); return; }
        itemModal(taskId, row.dataset.cvi, paint);
      });
      Modal.body.addEventListener('keydown', e => {
        if (e.target.id === 'cvNew' && e.key === 'Enter'){ e.preventDefault(); add(); }
      });
      setTimeout(() => { const n = document.getElementById('cvNew'); n && n.focus(); }, 80);
    }

    function addItemsTo(taskId, clId, done){
      const c = Store.checklistOf(taskId, clId); if(!c) return;
      const rows = () => Store.checklist(taskId, clId).map(x =>
        `<div class="subrow"><div class="sb2"><div class="st2">${esc(x.title)}</div>
          ${x.note ? `<div class="sm2">${esc(x.note)}</div>` : ''}</div>
          <button class="x" data-rm="${x.id}" aria-label="הסר">×</button></div>`).join('')
        || `<div class="subempty">אין עדיין פריטים</div>`;
      Modal.open({ title: c.name, body:`
        <div id="aiRows">${rows()}</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <input type="text" id="aiT" placeholder="הוסף פריט…" autocomplete="off" style="flex:1">
          <button class="btn" id="aiAdd" style="flex:0 0 auto">הוסף</button></div>
        <div class="ex">פריט הוא שם וסימון בלבד. אנטר מוסיף עוד אחד.</div>`,
        buttons:[{label:'סיום', kind:'p', act:()=>{ Modal.shut(); done && done(); }}]});
      const add = () => {
        const i = document.getElementById('aiT'), v = i.value.trim();
        if (!v) return;
        Store.addChecklistItem(taskId, clId, v, '');
        i.value = ''; document.getElementById('aiRows').innerHTML = rows(); i.focus();
      };
      Modal.body.addEventListener('click', e => {
        if (e.target.closest('#aiAdd')){ add(); return; }
        const rm = e.target.closest('[data-rm]');
        if (rm){ Store.delChecklistItem(taskId, rm.dataset.rm);
                 document.getElementById('aiRows').innerHTML = rows(); }
      });
      Modal.body.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.id === 'aiT'){ e.preventDefault(); add(); }
      });
      setTimeout(() => document.getElementById('aiT')?.focus(), 60);
    }

    /** פעולות על צ׳קליסט שלם */
    /* ---------- מחזור חוזר לצ׳קליסט ----------
       אותו צ׳קליסט חוזר, לא עותק חדש בכל שבוע. המחזור הפתוח נשאר פתוח
       עד שמסמנים; לפני המופע הבא הסימונים מתאפסים, ומרווח האיפוס ניתן
       להגדרה כי לצ׳קליסטים שונים יש משמעות שונה. */
    function checklistCycleModal(taskId, clId, done){
      const c = Store.checklistOf(taskId, clId); if(!c) return;
      const cur = c.repeat || { days:[], time:'20:00', skipTypes:[], skipScope:'day', around:false };
      let days = (cur.days || []).slice();
      let skipTypes = (cur.skipTypes || []).slice();
      let skipScope = cur.skipScope === 'week' ? 'week' : 'day';
      let around = !!cur.around;
      const types = Store.eventTypes();
      Modal.open({ title:'מחזור חוזר · ' + c.name, body:`
        <label>באילו ימים</label>
        <div class="days" id="clDays">${DAYL.map((x,i) =>
          `<button data-d="${i}" aria-selected="${days.includes(i)}">${x}</button>`).join('')}</div>
        <label style="margin-top:12px">באיזו שעה</label>
        <input type="time" id="clTime" value="${esc(cur.time || '20:00')}">
        <div class="ex" style="margin-top:12px">הצ׳קליסט לא נוצר מחדש בכל מחזור —
          הוא אותו צ׳קליסט. סימון כל הפריטים סוגר את המחזור לבד, בלי כפתור סיום.
          מחזור שלא הספקת לסיים <b>נשאר פתוח</b> — גם אחרי השעה וגם אחרי חצות.
          הסימונים מתאפסים <b>שש שעות לפני המופע הבא</b>, כדי שיהיה זמן להיערך.
          למשל "ציוד שבועי" בשבת ב-23:00 — הסימונים מתנקים ב-17:00.</div>
        ${types.length ? `
        <div class="esechead" style="margin-top:14px"><span>חריגים</span></div>
        <div class="ex">דלג כשיש אירוע מסוג…</div>
        <div id="clSkip" style="margin-top:6px">${types.map(x => `
          <button class="pick" data-skt="${x.id}" aria-checked="${skipTypes.includes(x.id)}"
                  style="border-bottom:0;padding:8px 2px">
            <span class="bx">✓</span>
            <span class="edot" style="background:${x.color};width:10px;height:10px"></span>
            <span class="pn">${esc(x.name)}</span></button>`).join('')}</div>
        <div id="clScopeWrap" ${skipTypes.length ? '' : 'hidden'}>
          <label style="margin-top:10px">מתי לדלג</label>
          <div class="seg" id="clScope">
            <button data-sc="day"  aria-selected="${skipScope==='day'}">ביום האירוע</button>
            <button data-sc="week" aria-selected="${skipScope==='week'}">בשבוע של האירוע</button>
          </div></div>` : ''}
        <div class="esechead" style="margin-top:14px"><span>התאמה סביב אירועים</span></div>
        <button class="pick" id="clAround" aria-checked="${around}"
                style="border-bottom:0;padding:8px 2px">
          <span class="bx">✓</span>
          <span class="pn">אל תזכיר באמצע אירוע</span></button>
        <div class="ex">זה לא חריג — המחזור עדיין נדרש. אם התזכורת נופלת בתוך
          אירוע, תקבל תזכורת הכנה שש שעות לפני שהוא מתחיל, ותזכורת מעקב
          שעתיים אחרי שהוא נגמר.</div>`,
        buttons:[
          { label:'כבה', act:()=>{ Store.setChecklistRepeat(taskId, clId, null);
                                   Modal.shut(); done && done(); UI.toast('המחזור כבוי'); } },
          { label:'שמור', kind:'p', act:()=>{
              const time = (document.getElementById('clTime')||{}).value || '20:00';
              if (!days.length){ UI.toast('צריך לבחור לפחות יום אחד'); return; }
              Store.setChecklistRepeat(taskId, clId, { days, time, skipTypes, skipScope, around });
              Modal.shut(); done && done(); Native.sync(); UI.toast('נשמר');
          } }]});
      Modal.body.addEventListener('click', e => {
        const db = e.target.closest('#clDays button');
        if (db){ const i = +db.dataset.d;
                 days = days.includes(i) ? days.filter(x => x !== i) : days.concat(i);
                 db.setAttribute('aria-selected', days.includes(i)); return; }
        const sk = e.target.closest('[data-skt]');
        if (sk){ const id = sk.dataset.skt;
                 skipTypes = skipTypes.includes(id) ? skipTypes.filter(x => x !== id) : skipTypes.concat(id);
                 sk.setAttribute('aria-checked', skipTypes.includes(id));
                 const w = document.getElementById('clScopeWrap'); if (w) w.hidden = !skipTypes.length;
                 return; }
        const sc = e.target.closest('#clScope button');
        if (sc){ skipScope = sc.dataset.sc;
                 Modal.body.querySelectorAll('#clScope button').forEach(x =>
                   x.setAttribute('aria-selected', x === sc)); return; }
        if (e.target.closest('#clAround')){
          around = !around;
          document.getElementById('clAround').setAttribute('aria-checked', around); return; }
      });
    }

    function checklistMenu(taskId, clId, done){
      const c = Store.checklistOf(taskId, clId); if(!c) return;
      Modal.open({ title:c.name,
        body:`<button class="pick" data-m="rename"><span class="pn">שנה שם</span></button>
              <button class="pick" data-m="cycle"><span class="pn">מחזור חוזר</span>
                <span class="pm">${c.repeat && (c.repeat.days||[]).length
                  ? UI.repeatLabel({ days:c.repeat.days }) + ' ' + esc(c.repeat.time) : 'כבוי'}</span></button>
              <button class="pick" data-m="reset"><span class="pn">אפס סימונים</span>
                <span class="pm">${Store.checklistStats(taskId, clId).checked || 'הכול פתוח'}</span></button>
              <button class="pick" data-m="del"><span class="pn"
                style="color:var(--danger)">מחק את הצ׳קליסט</span></button>`,
        buttons:[{label:'סגור', act:()=>{ Modal.shut(); done && done(); }}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-m]'); if(!b) return;
        if (b.dataset.m === 'rename'){
          Modal.open({ title:'שם הצ׳קליסט', body:`
            <input type="text" id="clN" value="${esc(c.name)}" autocomplete="off">
            <div class="ex">למשל "ציוד לקחת" או "דברים לבדוק".</div>`,
            buttons:[{label:'ביטול',act:()=>{ Modal.shut(); done && done(); }},
                     {label:'שמור',kind:'p',act:()=>{
                        Store.renameChecklist(taskId, clId, document.getElementById('clN').value);
                        Modal.shut(); done && done(); }}]});
          return;
        }
        if (b.dataset.m === 'cycle'){ checklistCycleModal(taskId, clId, done); return; }
        if (b.dataset.m === 'reset'){
          Store.resetChecklist(taskId, clId); Modal.shut(); done && done();
          UI.toast('הסימונים אופסו'); return;
        }
        if (b.dataset.m === 'del'){
          const gone = Store.delChecklist(taskId, clId);
          Modal.shut(); done && done();
          if (gone) UI.undo('הצ׳קליסט נמחק',
            () => Store.insertChecklist(taskId, gone.list, gone.at));
        }
      });
    }

    /**
     * תפריט ה-⋯ מחזיק רק פעולות נדירות, מבניות או הרסניות.
     * כל מה שעושים כל יום — להוסיף פריט, תת-משימה, הרגל, לקשר לאירוע,
     * לשנות סדר, לתכנן — יושב במקום שאליו הוא שייך על המסך עצמו.
     */
    function taskMenu(id){
      const t = Store.task(id); if(!t) return;
      const kids = Store.descendants(id).length;
      const isLong = t.kind === 'long';
      Modal.open({ title:t.title,
        body:`${isLong
            ? `<button class="pick" data-m="close"><span class="pn">סגור וארכב</span>
                 <span class="pm">${kids ? kids + ' בפנים' : ''}</span></button>`
            : `<button class="pick" data-m="close"><span class="pn">העבר לארכיון</span></button>`}
          ${t.parentId
            ? `<button class="pick" data-m="indep">
                 <span class="pn">הפוך למשימה עצמאית</span>
                 <span class="pm">תצא מ"${esc((Store.task(t.parentId)||{}).title || '')}"</span></button>
               ${!kids ? `<button class="pick" data-m="toitem">
                 <span class="pn">הפוך לפריט בצ׳קליסט</span>
                 <span class="pm">רק שם לסמן</span></button>` : ''}`
            : `<button class="pick" data-m="cat"><span class="pn">העבר לקטגוריה…</span>
                 <span class="pm">${CAT[t.mission]}</span></button>`}
          ${clockTime(t) ? `<button class="pick" data-m="clock">
                 <span class="pn">הוסף גם לשעון הטלפון</span>
                 <span class="pm">${esc(clockTime(t))}</span></button>` : ''}
          <button class="pick" data-m="del"><span class="pn" style="color:var(--danger)">מחק לצמיתות</span></button>`,
        buttons:[{label:'סגור',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-m]'); if(!b) return;
        const k = b.dataset.m;
        if (k==='cat'){ moveCategoryModal(id); return; }
        if (k==='clock'){ openClock({ title:t.title, time:clockTime(t) }); Modal.shut(); return; }
        if (k==='indep'){ Store.toIndependent(id); Modal.shut(); UI.toast('עומדת בפני עצמה'); return; }
        if (k==='toitem'){
          const it = Store.toChecklistItem(id);
          Modal.shut();
          UI.toast(it ? 'הפך לפריט בצ׳קליסט' : 'לא הצלחתי להמיר');
          return;
        }
        if (k==='close'){ Store.closeProject(id); UI.toast('הועבר לארכיון'); }
        if (k==='del'){   confirmDelete(id); return; }
        Modal.shut();
      });
    }

    /** שינוי קטגוריה — פעולה משנית, לא שדה בטופס העריכה */
    function moveCategoryModal(id){
      const t = Store.task(id); if(!t) return;
      Modal.open({ title:'העבר לקטגוריה',
        body:['army','home','free'].map(k => `<button class="pick" data-c="${k}"
          aria-checked="${t.mission===k}"><span class="bx">✓</span>
          <span class="pn">${CAT[k]}</span></button>`).join('') +
          `<div class="ex">תת-המשימות עוברות עם המשימה.</div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-c]'); if(!b) return;
        Store.updateTask(id, { mission:b.dataset.c, rt:t.rt });
        Store.descendants(id).forEach(c => Store.updateTask(c.id, { mission:b.dataset.c, rt:c.rt }));
        Modal.shut(); UI.toast('הועברה ל' + CAT[b.dataset.c]);
      });
    }

    /* ================= פריט ברשימה =================
       נגיעה בשורה פותחת עריכה מיד. אין תפריט ביניים, ואין כאן
       תאריך, תזכורת, מיקום, קטגוריה או תת-פריטים — כי אלה לא שייכים לפריט. */
    function itemModal(taskId, itemId, done){
      const c = Store.ownerOf(taskId, itemId); if(!c) return;
      const l = c.items;
      const i = l.findIndex(x => x.id === itemId); if (i < 0) return;
      const it = l[i];
      const back = () => { Modal.shut(); done && done(); };
      Modal.open({ title:'פריט · ' + c.name, body:`
        <div style="margin-bottom:14px"><label>שם הפריט</label>
          <input type="text" id="ciT" value="${esc(it.title)}" autocomplete="off"></div>
        <div style="margin-bottom:14px"><label>הערה</label>
          <textarea id="ciN" rows="3" placeholder="כמה, איזה, איפה…"
            style="resize:vertical;min-height:74px;line-height:1.6">${esc(it.note||'')}</textarea></div>
        <button class="pick" data-ck style="border-bottom:0">
          <span class="pn">${it.checked ? 'החזר ללא מסומן' : 'סמן'}</span></button>
        <div class="ex">פריט הוא שם, הערה קצרה וסימון. אין לו תאריך, התראה או ארכיון —
          לזה יש תת-משימה.</div>`,
        buttons:[
          {label:'מחק', act:()=>{
            const gone = Store.delChecklistItem(taskId, itemId);
            back();
            if (gone) UI.undo('הפריט נמחק',
              () => Store.insertChecklistItem(taskId, gone.item, gone.at, gone.clId));
          }},
          {label:'שמור', kind:'p', act:()=>{
            const ttl = document.getElementById('ciT').value.trim();
            if (!ttl){ UI.toast('צריך שם'); return; }
            Store.updateChecklistItem(taskId, itemId,
              { title:ttl, note:document.getElementById('ciN').value.trim() });
            back();
          }}]});
      Modal.body.addEventListener('click', e => {
        if (e.target.closest('[data-ck]')){ Store.toggleChecklistItem(taskId, itemId); back(); }
      });
    }

    /* ================= מחיקה — כלל לכל סוג (סעיף 27) ================= */
    function confirmDelete(id){
      const t = Store.task(id); if(!t) return;
      const desc  = Store.descendants(id);
      const habs  = desc.filter(c => Store.isHabit(c)).length;
      const subs  = desc.length - habs;
      const items = Store.checklist(id).length;
      let body;
      if (Store.isHabit(t)){
        const days = Object.keys(t.log || {}).length;
        body = `למחוק את ההרגל "${esc(t.title)}"?<br>` +
          (days ? 'ההיסטוריה של ' + days + (days===1?' יום':' ימים') + ' והרצף יימחקו יחד איתו.'
                : 'עוד לא נרשמה לו היסטוריה.');
      } else {
        const parts = [];
        if (items) parts.push(items + (items===1 ? ' פריט ברשימה' : ' פריטים ברשימה'));
        if (subs)  parts.push(subs  + (subs===1  ? ' תת-משימה'    : ' תת-משימות'));
        if (habs)  parts.push(habs  + (habs===1  ? ' הרגל'        : ' הרגלים'));
        body = `למחוק את "${esc(t.title)}" לצמיתות?<br>` +
          (parts.length ? 'יימחקו איתה גם ' + parts.join(', ') + '.'
                        : 'סיום רגיל שומר בארכיון. מחיקה היא לצמיתות.');
      }
      Modal.open({ title:'מחיקה', body:`<div class="note">${body}</div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label:'מחק',kind:'p',act:()=>{
                    Store.delTask(id); Modal.shut(); UI.toast('נמחק'); }}]});
    }

    /** איפוס רשימה — פעולה רגילה וחוזרת, בלי אזהרה כבדה */
    function resetChecklist(id, clId, done){
      const t = Store.task(id); if(!t) return;
      const c = clId ? Store.checklistOf(id, clId) : null;
      const n = Store.resettableCount(id, clId);
      if (!n){ Modal.shut(); UI.toast('אין כאן סימונים לאפס'); done && done(); return; }
      Modal.open({ title: c ? c.name : t.title,
        body:`<div class="note">לאפס את הסימונים?<br>
                ${n} ${n===1?'פריט יחזור':'פריטים יחזרו'} להיות לא מסומנים.
                השמות, ההערות והסדר נשארים בדיוק כפי שהם.</div>`,
        buttons:[{label:'ביטול',act:()=>{ Modal.shut(); done && done(); }},
                 {label:'אפס',kind:'p',act:()=>{
                    const k = Store.resetChecklist(id, clId);
                    Modal.shut(); done && done();
                    UI.toast(k + (k===1?' פריט אופס':' פריטים אופסו'));
                 }}]});
    }

    /** בוחר אירוע ומחזיר את המזהה. עובד גם לפני שהמשימה נשמרה. */
    function pickEvent(cb){
      const from = Plan.today();
      const evs = Store.all.events.filter(e => (e.endDate || e.date) >= from)
        .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time)).slice(0,40);
      if (!evs.length){ UI.toast('אין אירועים עתידיים'); return; }
      Modal.open({ title:'קשר לאירוע',
        body:`<div class="ex" style="margin-bottom:8px">המשימה תופיע בתוך האירוע
                כדבר להכין. למשל "להכין מצגת" לאירוע "הצגת הפרויקט".</div>` +
          evs.map(e => `<button class="pick" data-e="${e.id}">
            <span class="pn">${esc(e.title)}</span>
            <span class="pm">${esc(Plan.label(e.date))}${e.allDay ? '' : ' · ' + esc(e.time)}</span>
          </button>`).join(''),
        buttons:[{label:'ביטול',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', ev2 => {
        const b = ev2.target.closest('[data-e]'); if(!b) return;
        Modal.shut(); cb(b.dataset.e);
      });
    }

    function pickEventFor(taskId){
      const from = Plan.today();
      const evs = Store.all.events.filter(e => (e.endDate || e.date) >= from)
        .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time)).slice(0,40);
      if (!evs.length){ UI.toast('אין אירועים עתידיים'); return; }
      Modal.open({ title:'קשר לאירוע',
        body: evs.map(e => `<button class="pick" data-e="${e.id}">
            <span class="edot" style="background:${Cal.type(e).color}"></span>
            <span class="pn">${esc(e.title)}</span>
            <span class="pm">${esc(Plan.label(e.date))} ${esc(e.time)}</span></button>`).join(''),
        buttons:[{label:'ביטול',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e2 => {
        const b = e2.target.closest('[data-e]'); if(!b) return;
        Store.linkTask(taskId, b.dataset.e); Modal.shut(); UI.toast('קושר');
      });
    }

    /* ================= עורך המשימה — אקורדיון (סעיפים 39–40) ================= */
    /* ================= שעון הטלפון — לפי בקשה בלבד =================
       פעם שמירת משימה עם שעה זרקה את המשתמש לאפליקציית השעון.
       זה כבר לא קורה: התזכורות הן של "משימה" עצמה, דרך AlarmManager
       וההתראות שלה. שעון הטלפון נשאר רק כפעולה יזומה מתפריט המשימה,
       למי שרוצה גם צלצול של שעון מעורר. */
    const alarmLabel = title => 'משימה — ' + title;

    /** השעה שאפשר להעביר לשעון המעורר, אם יש כזאת */
    function clockTime(t){
      if (!t || t.kind === 'long') return '';
      if (Store.isHabit(t)) return (t.repeat.times || [])[0] || '';
      return (t.reminder && t.reminder.type === 'time') ? t.reminder.at : '';
    }

    function openClock(item){
      if (!Native.on){ UI.toast('התראה בשעון עובדת רק באפליקציה המותקנת'); return false; }
      const ok = Native.openAlarm(item.time, alarmLabel(item.title));
      if (!ok) UI.toast('לא הצלחתי לפתוח את שעון הטלפון');
      return ok;
    }

    /* ================= עורך המשימה ================= */

    function taskModal(o){TaskEditor.open(o,{checklistSetupModal,pickEvent,eventMenu});}

    /* ================= אירועים ================= */
    function typeChips(sel){
      return Store.eventTypes().map(t => `
        <button class="pick" data-ty="${t.id}" aria-checked="${t.id===sel}" style="border-bottom:0;padding:9px 2px">
          <span class="bx"></span>
          <span class="edot" style="background:${t.color};width:10px;height:10px"></span>
          <span class="pn">${esc(t.name)}</span></button>`).join('') +
        `<button class="pick" data-ty="__new" style="border-bottom:0;padding:9px 2px">
           <span class="pn" style="color:var(--accent)">+ סוג חדש</span></button>`;
    }

    /** יצירת סוג אירוע בלי לצאת מהעורך (סעיף 18) */
    function newTypeModal(cb){
      let color = UI.PALETTE[0];
      Modal.open({ title:'סוג אירוע חדש',
        body:`<div style="margin-bottom:14px"><label>שם</label>
                <input type="text" id="etyName" placeholder="סרט / רופא / חופש" autocomplete="off"></div>
              <label>צבע</label>
              <div class="swatches" id="etyPal">${UI.PALETTE.map((c,i) =>
                `<button data-c="${c}" style="background:${c}" aria-selected="${i===0}"></button>`).join('')}</div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label:'צור',kind:'p',act:()=>{
            const n = document.getElementById('etyName').value.trim();
            if (!n){ UI.toast('צריך שם'); return; }
            const t = Store.addEventType(n, color);
            Modal.shut(); cb && cb(t);
        }}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-c]'); if(!b) return;
        color = b.dataset.c;
        Modal.body.querySelectorAll('#etyPal button').forEach(x => x.setAttribute('aria-selected', x===b));
      });
      setTimeout(() => document.getElementById('etyName')?.focus(), 80);
    }

    function eventModal(ev){
      const isNew = !ev;
      const e = ev || { title:'', date:UI.selDate, time:'09:00', end:'10:00', endDate:'',
                        typeId:(Store.eventTypes()[0]||{}).id, remindMin:15, note:'',
                        allDay:false, listId:null };
      let typeId = e.typeId;
      let allDay = !!e.allDay;

      Modal.open({ title: isNew ? 'אירוע חדש' : 'עריכת אירוע', body:`
        <div style="margin-bottom:14px"><label>מה קורה</label>
          <input type="text" id="evT" value="${esc(e.title)}" placeholder="שם האירוע" autocomplete="off"></div>
        <div class="set" style="padding:10px 0;margin-bottom:8px">
          <div class="sb"><div class="st">כל היום</div>
            <div class="sd">אירוע בלי שעה. אם תמלא גם "עד תאריך" הוא יימתח כפס ביומן.</div></div>
          <button class="sw" id="evAll" aria-checked="${allDay}"></button></div>
        <div class="fgrid" style="margin-bottom:14px" id="evTimes" ${allDay?'hidden':''}>
          <div><label>מ־</label><input type="time" id="evS" value="${esc(e.time)}"></div>
          <div><label>עד</label><input type="time" id="evE" value="${esc(e.end||'10:00')}"></div>
        </div>
        <div class="fgrid" style="margin-bottom:14px">
          <div><label>תאריך</label><input type="date" id="evD" value="${esc(e.date)}"></div>
          <div><label>עד תאריך</label><input type="date" id="evED" value="${esc(e.endDate||'')}"></div>
        </div>
        <div style="margin-bottom:14px"><label>סוג</label>
          <div id="evTy">${typeChips(typeId)}</div>
          <button class="secact" id="evTyManage" style="margin-top:4px">נהל סוגי אירוע</button></div>
        <div style="margin-bottom:14px"><label>תזכורת לפני</label>
          <select id="evR">${[[-1,'ללא'],[0,'בזמן'],[10,'10 דק׳'],[15,'15 דק׳'],[30,'30 דק׳'],[60,'שעה'],[1440,'יום']]
            .map(([v,l]) => `<option value="${v}" ${e.remindMin===v?'selected':''}>${l}</option>`).join('')}</select></div>
        <div><label>תיאור</label>
          <textarea id="evN" rows="5" placeholder="פרטים, מה להביא, מי מגיע…"
            style="resize:vertical;min-height:112px;line-height:1.6">${esc(e.note||'')}</textarea></div>`,
        buttons:[ ...(isNew ? [{label:'ביטול',act:()=>Modal.shut()}]
                            : [{label:'מחק',act:()=>{ Store.delEvent(e.id); Modal.shut(); UI.toast('נמחק'); }}]),
          {label: isNew ? 'הוסף' : 'שמור', kind:'p', act:()=>{
            const g = x => document.getElementById(x);
            const title = g('evT').value.trim();
            if (!title){ UI.toast('צריך שם'); g('evT').focus(); return; }
            const date = g('evD').value || e.date;
            let endDate = g('evED').value || '';
            if (endDate && endDate < date){ UI.toast('תאריך הסיום לפני ההתחלה'); return; }
            if (endDate === date) endDate = '';
            const patch = { title, date, endDate, typeId, allDay,
              time: allDay ? '00:00' : (g('evS').value||'09:00'),
              end:  allDay ? '23:59' : (g('evE').value||'10:00'),
              remindMin:+g('evR').value, note:g('evN').value.trim(),
              listId: e.listId || null };
            if (isNew) Store.addEvent(patch); else Store.updateEvent(e.id, patch);
            if(patch.remindMin>=0)Permissions.forTask({reminder:{type:'time'}});
            UI.selDate = date; Modal.shut(); UI.toast(isNew ? 'נוסף ליומן' : 'נשמר');
          }}]});

      Modal.body.addEventListener('click', ee => {
        if (ee.target.closest('#evAll')){
          allDay = !allDay;
          document.getElementById('evAll').setAttribute('aria-checked', allDay);
          document.getElementById('evTimes').hidden = allDay;
          return;
        }
        if (ee.target.closest('#evTyManage')){
          const snap = {
            title: document.getElementById('evT').value,
            date:  document.getElementById('evD').value,
            time:  document.getElementById('evS').value,
            end:   document.getElementById('evE').value,
            endDate: document.getElementById('evED').value,
            remindMin: +document.getElementById('evR').value,
            note: document.getElementById('evN').value,
          };
          eventTypesModal(() => {
            eventModal(isNew ? null : e);
            setTimeout(() => {
              const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
              set('evT', snap.title); set('evD', snap.date); set('evS', snap.time);
              set('evE', snap.end); set('evED', snap.endDate);
              set('evR', String(snap.remindMin)); set('evN', snap.note);
            }, 40);
          });
          return;
        }
        const b = ee.target.closest('[data-ty]'); if(!b) return;
        if (b.dataset.ty === '__new'){
          const draft = {
            title: document.getElementById('evT').value,
            date:  document.getElementById('evD').value,
            time:  document.getElementById('evS').value,
            end:   document.getElementById('evE').value,
            endDate: document.getElementById('evED').value,
            remindMin: +document.getElementById('evR').value,
            note: document.getElementById('evN').value,
          };
          newTypeModal(t => {
            eventModal(isNew ? null : e);
            /* משחזרים את מה שהמשתמש כבר הקליד */
            setTimeout(() => {
              const g = x => document.getElementById(x);
              if (!g('evT')) return;
              g('evT').value = draft.title; g('evD').value = draft.date;
              g('evS').value = draft.time;  g('evE').value = draft.end;
              g('evED').value = draft.endDate; g('evR').value = draft.remindMin;
              g('evN').value = draft.note;
              const pick = Modal.body.querySelector(`[data-ty="${t.id}"]`);
              if (pick){ Modal.body.querySelectorAll('[data-ty]').forEach(x =>
                           x.setAttribute('aria-checked', x===pick)); }
            }, 30);
          });
          return;
        }
        typeId = b.dataset.ty;
        Modal.body.querySelectorAll('[data-ty]').forEach(x => x.setAttribute('aria-checked', x===b));
      });
    }

    function eventMenu(ev){
      const allLinked = Store.tasksForEvent(ev.id),projects=allLinked.filter(t=>t.kind==='long'),linked=allLinked.filter(t=>t.kind!=='long');
      Modal.open({ title:ev.title,
        body:`<div class="small dim" style="padding:0 0 10px">
                ${ev.allDay ? 'כל היום' : esc(ev.time)+'–'+esc(ev.end||'')} · ${esc(Cal.type(ev).name)}${
                  Cal.dayCount(ev) > 1 ? ' · ' + Cal.dayCount(ev) + ' ימים' : ''}</div>
              ${ev.note ? `<div class="msum" style="margin-bottom:12px">${esc(ev.note)}</div>` : ''}
              ${projects.length?`<div class="esec"><div class="esechead"><span>הכנה לאירוע</span></div>${projects.map(p=>{const children=Store.childrenAll(p.id).filter(x=>!x.archived||x.done),done=children.filter(x=>x.done).length;return `<button class="settings-row" data-preparation="${p.id}"><span><b>${esc(p.title)}</b><small>${done} מתוך ${children.length} משימות הושלמו</small></span><span>‹</span></button>`;}).join('')}</div>`:''}
              <div class="esec">
                <div class="esechead"><span>דברים להכין</span>
                  <button class="secact" data-m="link">+ קשר משימה</button></div>
                ${linked.length ? linked.map(t => `
                  <div class="row" data-id="${t.id}" style="padding:9px 0">
                    <button class="cb" data-act="doneTask">✓</button>
                    <div class="bd"><div class="t" style="font-size:14px">${esc(t.title)}</div>
                      ${(t.reminder && t.reminder.type === 'time')
                        ? `<div class="m">שעה משלה · ${esc(t.reminder.at)}</div>` : ''}</div>
                  </div>`).join('')
                : `<div class="ex">מה שצריך להספיק לפני האירוע.
                     למשל "להכין מצגת" לפני "הצגת הפרויקט".</div>`}
              </div>
              ${(() => { const l = ev.listId ? Store.list(ev.listId) : null;
                 return l ? `<button class="pick" data-m="list"><span class="pn">פתח את הרשימה</span>
                   <span class="pm">${l.items.filter(i=>!i.done).length} פתוחים</span></button>` : ''; })()}
              <button class="pick" data-m="edit"><span class="pn">ערוך אירוע</span></button>
              <button class="pick" data-m="cal"><span class="pn">ליומן הטלפון</span>
                <span class="pm">יפתח את היומן של הטלפון לאישור</span></button>
              <button class="pick" data-m="del"><span class="pn" style="color:var(--danger)">מחק</span></button>`,
        buttons:[{label:'סגור',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e => {
        const prep=e.target.closest('[data-preparation]');if(prep){Modal.shut();openTask(prep.dataset.preparation);return;}
        const dt = e.target.closest('[data-act="doneTask"]');
        if (dt){ const row = dt.closest('[data-id]');
                 Store.finishTask(row.dataset.id); Modal.shut(); UI.toast('הושלם ונשמר בסיכום היום'); return; }
        const b = e.target.closest('[data-m]'); if(!b) return;
        const k = b.dataset.m;
        if (k==='edit'){ eventModal(ev); return; }
        if (k==='list'){ Modal.shut(); UI.section='library'; UI.screen='lists';
                         UI.openList = ev.listId; UI.render(); return; }
        if (k==='link'){ linkTaskModal(ev); return; }
        if (k==='cal'){
          if (Native.on){ if (Native.addEvent(ev)) UI.toast('נפתח ביומן — לחץ שמירה'); }
          else { UI.download('mesima-'+ev.id+'.ics', Cal.ics([ev]), 'text/calendar;charset=utf-8');
                 UI.toast('פתח את הקובץ — הטלפון יציע להוסיף ליומן'); }
          Modal.shut(); return;
        }
        if (k==='del'){ Store.delEvent(ev.id); Modal.shut(); UI.toast('נמחק'); }
      });
    }

    /* בחירת משימות לקישור — לפי היררכיה, כמו בעמוד המשימות, עם חיפוש */
    function linkTaskModal(ev){
      const already = new Set(Store.tasksForEvent(ev.id).map(t => t.id));
      const ok = t => !already.has(t.id) && !t.archived && !t.done;
      const avail = Store.active().filter(ok);
      if (!avail.length){ UI.toast('אין משימות פנויות לקשר'); return; }
      const chosen = new Set();
      let q = '';

      const line = (t, depth) => `<button class="pick" data-t="${t.id}"
          aria-checked="${chosen.has(t.id)}" style="padding-inline-start:${depth*16}px">
          <span class="bx">✓</span>
          <span class="pn">${depth ? '<span style="opacity:.45">↳ </span>' : ''}${esc(t.title)}</span>
          <span class="pm">${depth ? '' : CAT[t.mission]}</span></button>`;

      /* עץ: משימה ראשית ואחריה התת-משימות שלה. ענף נשאר אם הוא עצמו
         מתאים לחיפוש או אם אחד מצאצאיו מתאים. */
      function branch(t, depth){
        const kids = Store.subtasksOf(t.id).concat(Store.habitsOf(t.id));
        const sub  = kids.map(k => branch(k, depth + 1)).filter(Boolean);
        const hit  = ok(t) && (!q || t.title.toLowerCase().includes(q));
        if (!hit && !sub.length) return '';
        return (ok(t) ? line(t, depth) : `<div class="small dim"
                 style="padding:10px 2px 4px;padding-inline-start:${depth*16}px">${esc(t.title)}</div>`)
               + sub.join('');
      }

      function listHTML(){
        const cats = ['army','home','free'];
        let out = '';
        cats.forEach(c => {
          const roots = Store.children(null, c).filter(t => !t.archived);
          const body = roots.map(t => branch(t, 0)).filter(Boolean).join('');
          if (body) out += `<div class="sh" style="margin:14px 0 2px">${CAT[c]}</div>` + body;
        });
        return out || '<div class="small dim" style="padding:16px 2px">אין התאמה</div>';
      }

      Modal.open({ title:'קשר משימה ל"'+ev.title+'"',
        body:`<div class="note" style="padding-bottom:10px">פרויקט מקושר כהכנה לאירוע, ללא תאריך משלו. משימה קצרה ללא תאריך תיקבע ליום האירוע.</div>
              <input type="search" id="lkQ" placeholder="חיפוש משימה…" autocomplete="off">
              <div id="lkList">${listHTML()}</div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label:'קשר',kind:'p',act:()=>{
                    chosen.forEach(id => Store.linkTask(id, ev.id));
                    Modal.shut(); UI.toast(chosen.size ? chosen.size+' קושרו' : 'לא נבחר כלום');
                 }}]});

      Modal.body.addEventListener('input', e2 => {
        if (e2.target.id !== 'lkQ') return;
        q = e2.target.value.trim().toLowerCase();
        document.getElementById('lkList').innerHTML = listHTML();
      });
      Modal.body.addEventListener('click', e2 => {
        const b = e2.target.closest('[data-t]'); if(!b) return;
        const id = b.dataset.t;
        if (chosen.has(id)){ chosen.delete(id); b.setAttribute('aria-checked','false'); }
        else { chosen.add(id); b.setAttribute('aria-checked','true'); }
      });
    }

    /* ================= הערות ================= */
    const NB = () => $('#nBody');
    const FORE = ['#e7ebf0','#e0787a','#e0b57a','#e8d98a','#8bcaa8','#7fc8d8','#b48ead','#d68fb0'];
    const BACK = ['#3a1f1f','#3a2f1e','#3a3a20','#1c3129','#1b2c3a','#2b2238','#361f2c'];
    let saveT = null;

    function cleanHTML(html){
      const d = document.createElement('div');
      d.innerHTML = html || '';
      d.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button').forEach(x => x.remove());
      d.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(a => {
          const n = a.name.toLowerCase();
          if (n.startsWith('on')) el.removeAttribute(a.name);
          if ((n==='href'||n==='src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
          if (n==='srcdoc') el.removeAttribute(a.name);
        });
        if (el.tagName==='A') el.setAttribute('rel','noopener noreferrer');
      });
      return d.innerHTML;
    }
    function applyZoom(){
      const z = Store.all.prefs.noteZoom || 1;
      NB().style.setProperty('--nz', z);
      const lbl = document.getElementById('nZoomLbl');
      if (lbl) lbl.textContent = Math.round(z*100) + '%';
    }
    function setZoom(z){
      const v = Math.min(2.4, Math.max(0.7, Math.round(z*20)/20));
      Store.setPref('noteZoom', v); applyZoom();
    }
    /* המשפט הראשון בהערה — עד סוף שורה, נקודה או 60 תווים */
    function firstLine(html){
      const d = document.createElement('div');
      d.innerHTML = (html||'').replace(/<(br|\/p|\/div|\/li|\/h[1-6])>/gi,'\n');
      const txt = (d.textContent||'').replace(/\u00a0/g,' ').trim();
      if (!txt) return '';
      let line = txt.split('\n').map(x=>x.trim()).find(Boolean) || '';
      const stop = line.search(/[.!?]\s|[.!?]$/);
      if (stop > 2) line = line.slice(0, stop + 1);
      line = line.trim();
      return line.length > 60 ? line.slice(0,60).trim() + '…' : line;
    }
    function noteSave(now){
      const id = UI.openNote; if(!id) return;
      clearTimeout(saveT);
      const doIt = () => {
        if (!UI.openNote) return;
        const html = cleanHTML(NB().innerHTML);
        /* בלי כותרת מפורשת — המשפט הראשון בגוף ההערה משמש ככותרת */
        Store.updateNote(UI.openNote,
          { title: $('#nTitle').value.trim() || firstLine(html),
            html }, true);
        $('#nSaved').textContent = 'נשמר ' +
          new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
      };
      $('#nSaved').textContent = 'שומר…';
      if (now) doIt(); else saveT = setTimeout(doIt, 600);
    }
    function openNote(id){
      const n = Store.note(id); if(!n) return;
      UI.screen = 'notes'; UI.openNote = id;
      $('#nTitle').value = n.title || '';
      NB().innerHTML = n.html || '';
      NB().setAttribute('data-ph','תכתוב פה מה שבא לך…');
      applyZoom();
      $('#nSaved').textContent = 'נשמר';
      $('#nPalette').hidden = true;
      UI.render();
      $('#notesIndex').hidden = true; $('#noteEdit').hidden = false;
      setTimeout(() => NB().focus(), 60);
    }
    function closeNote(){
      if (UI.openNote) noteSave(true);
      const id = UI.openNote;
      UI.openNote = null;
      const n = id && Store.note(id);
      if (n && !n.title && !UI.noteText(n.html)) Store.delNote(id);
      $('#nPalette').hidden = true;
      UI.render();
    }
    $('#nSearch').addEventListener('input', e => { UI.noteQ = e.target.value; UI.renderNotes(); });
    document.addEventListener('click', e => {
      const im = e.target.closest('img[data-act="zoom"]');
      if (im){ e.stopPropagation();
        document.getElementById('imgzoomImg').src = im.src;
        document.getElementById('imgzoom').classList.add('on'); }
    }, true);
    $('#imgzoom').addEventListener('click', () => {
      $('#imgzoom').classList.remove('on'); $('#imgzoomImg').src = '';
    });
    $('#dpX').addEventListener('click', () => DatePick.shut());
    $('#dpick').addEventListener('click', e => { if (e.target.id === 'dpick') DatePick.shut(); });
    $('#nBack').addEventListener('click', closeNote);
    $('#nMenu').addEventListener('click', () => { if (UI.openNote){ noteSave(true); noteMenu(UI.openNote); } });
    $('#notesList').addEventListener('click', e => {
      if (e.target.closest('[data-act="add"]')){ openNote(Store.addNote({}).id); return; }
      const card = e.target.closest('[data-id]'); if(!card) return;
      const id = card.dataset.id;
      if (e.target.closest('[data-act="nMenu"]')){ noteMenu(id); return; }
      openNote(id);
    });

    function noteMenu(id){
      const n = Store.note(id); if(!n) return;
      Modal.open({ title:n.title || 'ללא כותרת',
        body:`<button class="pick" data-m="open"><span class="pn">פתח</span></button>
          <button class="pick" data-m="pin"><span class="pn">${n.pinned?'בטל נעיצה':'נעץ למעלה'}</span></button>
          <button class="pick" data-m="dup"><span class="pn">שכפל</span></button>
          <button class="pick" data-m="exp"><span class="pn">ייצוא כקובץ</span></button>
          <button class="pick" data-m="del"><span class="pn" style="color:var(--danger)">מחיקה</span></button>`,
        buttons:[{label:'סגור',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-m]'); if(!b) return;
        const k = b.dataset.m; Modal.shut();
        if (k==='open') openNote(id);
        if (k==='pin')  Store.pinNote(id);
        if (k==='dup')  Store.addNote({ title:(n.title||'ללא כותרת')+' — עותק', html:n.html });
        if (k==='exp'){
          const doc = '<!doctype html><meta charset="utf-8"><title>'+esc(n.title||'הערה')+'</title>'
            + '<body dir="rtl" style="max-width:760px;margin:24px auto;padding:0 18px;'
            + 'font:16px/1.75 system-ui,sans-serif"><h1>'+esc(n.title||'הערה')+'</h1>'+n.html+'</body>';
          UI.download('note-'+(n.title||n.id).slice(0,30)+'.html', doc, 'text/html;charset=utf-8');
        }
        if (k==='del'){ Store.delNote(id); UI.toast('נמחק'); }
      });
    }

    $('#nTitle').addEventListener('input', () => noteSave());
    NB().addEventListener('input', () => noteSave());
    NB().addEventListener('blur',  () => noteSave(true));
    NB().addEventListener('paste', e => {
      const dt = e.clipboardData; if(!dt) return;
      const html = dt.getData('text/html');
      if (!html) return;
      e.preventDefault();
      document.execCommand('insertHTML', false, cleanHTML(html));
      noteSave();
    });

    function block(tag){ document.execCommand('formatBlock', false, tag); NB().focus(); noteSave(); }
    function palette(kind){
      const box = $('#nPalette');
      if (!box.hidden && box.dataset.k === kind){ box.hidden = true; return; }
      box.dataset.k = kind; box.hidden = false;
      const cols = kind==='fore' ? FORE : BACK;
      box.innerHTML = cols.map(c => `<button data-col="${c}" style="background:${c}"></button>`).join('')
        + `<button class="clear" data-col="none">ללא</button>`;
    }
    $('#nPalette').addEventListener('click', e => {
      const b = e.target.closest('[data-col]'); if(!b) return;
      const kind = $('#nPalette').dataset.k, c = b.dataset.col;
      NB().focus();
      if (kind==='fore') document.execCommand('foreColor', false, c==='none' ? '#e7ebf0' : c);
      else document.execCommand('hiliteColor', false, c==='none' ? 'transparent' : c);
      const sw = document.getElementById(kind==='fore' ? 'nFore' : 'nBack2');
      if (c!=='none' && sw) sw.style.background = c;
      $('#nPalette').hidden = true;
      noteSave();
    });
    async function insertImage(){
      const inp = document.createElement('input');
      inp.type='file'; inp.accept='image/*';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if(!f) return;
        try {
          UI.toast('מכווץ תמונה…');
          const url = await shrink(f, 1100);
          NB().focus();
          document.execCommand('insertHTML', false, `<img src="${url}" alt="">`);
          noteSave(true); UI.toast('נוספה');
        } catch(e){ UI.toast('לא הצלחתי לקרוא את התמונה'); }
      };
      inp.click();
    }
    function insertLink(){
      const sel = document.getSelection();
      const txt = (sel && String(sel).trim()) || '';
      Modal.open({ title:'קישור',
        body:`<div style="margin-bottom:10px"><label>כתובת</label>
                <input type="url" id="lkUrl" placeholder="https://" autocomplete="off"></div>
              <div><label>טקסט להצגה</label>
                <input type="text" id="lkTxt" value="${esc(txt)}" autocomplete="off"></div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label:'הוסף',kind:'p',act:()=>{
            let u = document.getElementById('lkUrl').value.trim();
            const t = document.getElementById('lkTxt').value.trim();
            if (!u){ UI.toast('צריך כתובת'); return; }
            if (/^\s*javascript:/i.test(u)){ UI.toast('כתובת לא חוקית'); return; }
            if (!/^[a-z]+:/i.test(u)) u = 'https://' + u;
            Modal.shut(); NB().focus();
            document.execCommand('insertHTML', false,
              `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t||u)}</a>&nbsp;`);
            noteSave(true);
         }}]});
      setTimeout(() => document.getElementById('lkUrl')?.focus(), 80);
    }
    function flipDir(){
      NB().focus();
      const sel = document.getSelection();
      let el = sel && sel.anchorNode;
      while (el && el !== NB() && el.nodeType !== 1) el = el.parentNode;
      while (el && el !== NB() && el.parentNode !== NB()) el = el.parentNode;
      if (!el || el === NB()) el = NB();
      const cur = el.getAttribute && el.getAttribute('dir');
      if (el.setAttribute) el.setAttribute('dir', cur === 'ltr' ? 'rtl' : 'ltr');
      noteSave();
    }
    /* חשיפה הדרגתית: סרגל קצר קבוע, וכל השאר בשני גיליונות מקובצים.
       שום יכולת לא הוסרה — היא רק לא תופסת מקום כשלא משתמשים בה. */
    const SHEETS = {
      style: { title:'סגנון טקסט', groups:[
        { label:'פסקה', items:[['b:p','טקסט רגיל'],['b:h1','כותרת'],['b:h2','כותרת משנה'],
                               ['b:blockquote','ציטוט']] },
        { label:'עיצוב', items:[['c:bold','מודגש'],['c:italic','נטוי'],
                                ['c:underline','קו תחתון'],['c:strikeThrough','קו חוצה']] },
        { label:'רשימות', items:[['c:insertUnorderedList','רשימה'],
                                 ['c:insertOrderedList','רשימה ממוספרת']] },
      ]},
      more: { title:'עוד כלים', groups:[
        { label:'הוספה', items:[['c:link','קישור'],['c:image','תמונה'],['c:hr','קו מפריד']] },
        { label:'צבע', items:[['pal:fore','צבע טקסט'],['pal:back','הדגשה']] },
        { label:'פסקה', items:[['c:dir','הפוך כיוון פסקה']] },
        { label:'תצוגה', items:[['c:zoomOut','הקטן טקסט'],['c:zoomReset','גודל רגיל'],
                                ['c:zoomIn','הגדל טקסט']] },
        { label:'היסטוריה', items:[['c:undo','בטל'],['c:redo','חזור']] },
      ]},
    };
    /* הבחירה נשמרת לפני פתיחת הגיליון, כי פתיחת מודאל מאבדת אותה */
    let savedRange = null;
    const saveSel = () => {
      const s = document.getSelection();
      savedRange = (s && s.rangeCount && NB().contains(s.anchorNode)) ? s.getRangeAt(0).cloneRange() : null;
    };
    const restoreSel = () => {
      NB().focus();
      if (!savedRange) return;
      const s = document.getSelection();
      s.removeAllRanges(); s.addRange(savedRange);
    };
    function openSheet(which){
      const sh = SHEETS[which]; if(!sh) return;
      saveSel();
      Modal.open({ title:sh.title,
        body: sh.groups.map(g => `
          <label style="margin-top:12px">${g.label}</label>
          <div class="sheetgrid">${g.items.map(([k,lbl]) =>
            `<button class="sbtn" data-do="${k}">${lbl}</button>`).join('')}</div>`).join('') +
          `<div class="note" style="margin-top:14px">גודל טקסט נוכחי:
             <span id="nZoomLbl" dir="ltr">${Math.round((Store.all.prefs.noteZoom||1)*100)}%</span></div>`,
        buttons:[{label:'סגור',act:()=>Modal.shut()}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-do]'); if(!b) return;
        const [kind, val] = b.dataset.do.split(':');
        if (kind === 'pal'){ Modal.shut(); restoreSel(); palette(val); return; }
        restoreSel();
        if (kind === 'b'){ block(val === 'p' ? 'P' : val.toUpperCase()); Modal.shut(); return; }
        runCmd(val);
        if (!['zoomIn','zoomOut','zoomReset'].includes(val)) Modal.shut();
      });
    }

    function runCmd(c){
      if (c==='link')  return insertLink();
      if (c==='image') return insertImage();
      if (c==='hr'){ NB().focus(); document.execCommand('insertHorizontalRule'); return noteSave(); }
      if (c==='dir')   return flipDir();
      if (c==='zoomIn')  return setZoom((Store.all.prefs.noteZoom||1) + 0.1);
      if (c==='zoomOut') return setZoom((Store.all.prefs.noteZoom||1) - 0.1);
      if (c==='zoomReset') return setZoom(1);
      NB().focus(); document.execCommand(c); noteSave();
    }

    $('#nTools').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    $('#nTools').addEventListener('click', e => {
      const b = e.target.closest('button'); if(!b) return;
      if (b.dataset.sheet){ openSheet(b.dataset.sheet); return; }
      if (b.dataset.b){ block(b.dataset.b === 'p' ? 'P' : b.dataset.b.toUpperCase()); return; }
      if (b.dataset.pal){ palette(b.dataset.pal); return; }
      const c = b.dataset.c; if (!c) return;
      runCmd(c);
    });
    let pinch = 0, zoom0 = 1;
    NB().addEventListener('touchstart', e => {
      if (e.touches.length === 2){
        pinch = Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                           e.touches[0].clientY-e.touches[1].clientY);
        zoom0 = Store.all.prefs.noteZoom || 1;
      }
    }, {passive:true});
    NB().addEventListener('touchmove', e => {
      if (e.touches.length === 2 && pinch){
        const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                             e.touches[0].clientY-e.touches[1].clientY);
        setZoom(zoom0 * (d/pinch));
      }
    }, {passive:true});
    NB().addEventListener('touchend', () => { pinch = 0; }, {passive:true});
    document.addEventListener('selectionchange', () => {
      if (UI.screen !== 'notes' || !UI.openNote) return;
      ['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList']
        .forEach(c => { const b = $('#nTools button[data-c="'+c+'"]');
                        if (b) try { b.setAttribute('aria-pressed', String(document.queryCommandState(c))); } catch(e){} });
      /* גם בתוך הגיליון, כשהוא פתוח */
      ['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList']
        .forEach(c => { const b = document.querySelector('#mBody [data-do="c:'+c+'"]');
                        if (b) try { b.setAttribute('aria-pressed', String(document.queryCommandState(c))); } catch(e){} });
    });

    /* ================= קניות ================= */
    function newList(){
      let kind = UI.listKind;
      Modal.open({ title:'רשימה חדשה',
        body:`<div style="margin-bottom:14px"><label>שם</label>
                <input type="text" id="lName" placeholder="קניות לשבת" autocomplete="off"></div>
              <div style="margin-bottom:10px"><label>סוג</label>
                <div class="seg" id="lSeg">
                  ${Object.entries(UI.KIND).map(([k,v]) =>
                    `<button data-k="${k}" aria-selected="${k===kind}">${v.label}</button>`).join('')}
                </div>
                <div class="note" style="margin-top:7px" id="lNote">${UI.KIND[kind].note}</div></div>
              <div id="lErrand" ${kind==='errand'?'':'hidden'}>
                <div class="fgrid">
                  <div><label>בשביל מי</label><input type="text" id="lWho" placeholder="אמא"></div>
                  <div><label>טלפון</label><input type="text" id="lPhone" inputmode="tel" placeholder="050…"></div>
                </div></div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label:'צור',kind:'p',act:()=>{
            const name = document.getElementById('lName').value.trim();
            if (!name){ UI.toast('צריך שם'); return; }
            const l = Store.addList({ name, kind,
              forWho:(document.getElementById('lWho')||{}).value || '',
              phone:(document.getElementById('lPhone')||{}).value || '' });
            UI.listKind = kind; UI.openList = l.id; UI.screen = 'lists';
            Modal.shut(); UI.render();
         }}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('#lSeg button'); if(!b) return;
        kind = b.dataset.k;
        Modal.body.querySelectorAll('#lSeg button').forEach(x => x.setAttribute('aria-selected', x===b));
        document.getElementById('lNote').textContent = UI.KIND[kind].note;
        document.getElementById('lErrand').hidden = kind !== 'errand';
      });
      setTimeout(() => document.getElementById('lName')?.focus(), 80);
    }

    let pendingImg = '';
    $('#listsBody').addEventListener('click', async e => {
      if (e.target.closest('[data-act="add"]')){ newList(); return; }
      const openBtn = e.target.closest('[data-list]');
      if (openBtn){ UI.openList = openBtn.dataset.list; UI.render(); return; }

      const l = Store.list(UI.openList); if(!l) return;
      if (e.target.closest('#lBack')){ UI.openList = null; pendingImg=''; UI.render(); return; }
      if (e.target.closest('#iMore')){
        UI.itemMore = !UI.itemMore;
        $('#iExtra').hidden = !UI.itemMore;
        $('#iMore').setAttribute('aria-expanded', UI.itemMore);
        $('#iMore').textContent = (UI.itemMore ? '⌄ ' : '‹ ') + 'קישור או תמונה';
        return;
      }
      if (e.target.closest('#iPic')){ $('#iFile').click(); return; }
      if (e.target.closest('#iAdd')){ addItem(); return; }
      if (e.target.closest('#lDelete')){
        Modal.open({ title:'למחוק את "'+l.name+'"?',
          body:`<div class="note">${l.items.length} פריטים יימחקו איתה.</div>`,
          buttons:[{label:'ביטול',act:()=>Modal.shut()},
                   {label:'מחק',kind:'p',act:()=>{ Store.delList(l.id); UI.openList=null;
                     Modal.shut(); UI.toast('נמחק'); UI.render(); }}]});
        return;
      }
      if (e.target.closest('#lSettle')){ settle(l); return; }
      if (e.target.closest('#lPlan')){ planListModal(l); return; }
      if (e.target.closest('#lUnplan')){
        const ev = Store.listEvent(l.id);
        if (ev){ Store.delEvent(ev.id); UI.toast('הוסר מהיומן'); }
        return;
      }

      const row = e.target.closest('[data-id]'); if(!row) return;
      const id = row.dataset.id, act = (e.target.closest('[data-act]')||{}).dataset?.act;
      if (act==='tItem')    { Store.toggleItem(l.id, id); return; }
      if (act==='editItem') { editItem(l, id); return; }
      if (act==='check')    { await checkRelease(l, id); return; }
    });

    /**
     * שיבוץ רשימה ליומן. הרשימה נשארת רשימה — נוצר אירוע שמצביע אליה,
     * ולכן התזכורת שלו עוברת דרך אותו מסלול של כל אירוע אחר, כולל
     * ההתראה ברקע. אין כאן מנגנון תזכורות שני.
     */
    function planListModal(l, keep){
      const openItems = l.items.filter(i => !i.done);
      /* ברירת מחדל: כל מה שפתוח. בחירה חלקית נשמרת בין מעברים למסך
         הבחירה וחזרה, כדי שהתאריך והשעה לא יילכו לאיבוד. */
      let picked = Array.isArray(keep && keep.picked)
        ? keep.picked.filter(id => openItems.some(i => i.id === id))
        : null;
      const chosen = () => picked ? openItems.filter(i => picked.includes(i.id)) : openItems;
      const summary = () => picked
        ? picked.length + ' מתוך ' + openItems.length + ' פריטים'
        : 'כל הרשימה · ' + openItems.length + ' פריטים';

      Modal.open({ title:'שיבוץ "' + l.name + '" ליומן', body:`
        <div style="margin-bottom:14px"><label>מה לשבץ?</label>
          <div class="seg" id="plWhat">
            <button data-w="all"  aria-selected="${!picked}">כל הרשימה</button>
            <button data-w="some" aria-selected="${!!picked}">בחירת פריטים</button>
          </div>
          <div class="ex" id="plWhatEx">${esc(summary())}</div></div>
        <div class="fgrid" style="margin-bottom:14px">
          <div><label>תאריך</label>
            <input type="date" id="plD" value="${esc((keep && keep.date) || Plan.today())}"></div>
          <div><label>שעה</label>
            <input type="time" id="plT" value="${esc((keep && keep.time) || '17:00')}"></div>
        </div>
        <div style="margin-bottom:14px"><label>תזכורת לפני</label>
          <select id="plR">${[[-1,'ללא'],[0,'בזמן'],[15,'15 דק׳'],[30,'30 דק׳'],[60,'שעה'],[120,'שעתיים'],[1440,'יום']]
            .map(([v,lb]) => `<option value="${v}" ${v===((keep&&keep.remind)!=null?keep.remind:30)?'selected':''}>${lb}</option>`).join('')}</select></div>
        <div style="margin-bottom:14px"><label>סוג</label>
          <div id="plTy">${typeChips((keep && keep.typeId) || (Store.eventTypes()[0]||{}).id)}</div></div>
        <div class="note">האירוע ביומן יקשר לרשימה, ולחיצה עליו תפתח את הרשימה עצמה.
          פריטים שלא נבחרו נשארים ברשימה — הם פשוט לא נכנסים לאירוע.</div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label:'שבץ',kind:'p',act:()=>{
          const g = x => document.getElementById(x);
          const date = g('plD').value || Plan.today();
          const time = g('plT').value || '17:00';
          const [h,m] = time.split(':').map(Number);
          const endH = String((h+1) % 24).padStart(2,'0');
          const list = chosen();
          if (!list.length){ UI.toast('לא נבחר אף פריט'); return; }
          const old = Store.listEvent(l.id);
          if (old) Store.delEvent(old.id);
          Store.addEvent({ title:l.name, date, time, end:endH + ':' + String(m).padStart(2,'0'),
                           typeId:planType, remindMin:+g('plR').value, listId:l.id,
                           note:list.map(i => '· ' + i.title).join('\n') });
          Modal.shut(); UI.toast('שובץ ל' + Plan.label(date));
        }}]});
      let planType = (keep && keep.typeId) || (Store.eventTypes()[0]||{}).id;
      const snap = () => ({ date:(document.getElementById('plD')||{}).value,
                            time:(document.getElementById('plT')||{}).value,
                            remind:+((document.getElementById('plR')||{}).value),
                            typeId:planType, picked });
      Modal.body.addEventListener('click', ee => {
        const w = ee.target.closest('#plWhat button');
        if (w){
          if (w.dataset.w === 'all'){
            picked = null;
            Modal.body.querySelectorAll('#plWhat button').forEach(x =>
              x.setAttribute('aria-selected', x === w));
            document.getElementById('plWhatEx').textContent = summary();
          } else {
            pickListItems(l, picked, sel => planListModal(l, { ...snap(), picked:sel }),
                          () => planListModal(l, snap()));
          }
          return;
        }
        const b = ee.target.closest('[data-ty]'); if(!b) return;
        if (b.dataset.ty === '__new') return;         /* יצירת סוג חדש נעשית מעורך האירוע */
        planType = b.dataset.ty;
        Modal.body.querySelectorAll('[data-ty]').forEach(x =>
          x.setAttribute('aria-checked', x === b));
      });
    }

    /**
     * בחירת פריטים לשיבוץ. נראה כמו רשימת הקניות עצמה ולא כמו בורר טכני,
     * כי זו אותה פעולה מוכרת — לסמן פריטים ברשימה.
     */
    function pickListItems(l, current, onDone, onBack){
      const openItems = l.items.filter(i => !i.done);
      let sel = new Set(current || openItems.map(i => i.id));
      const rows = () => openItems.map(i => `
        <div class="clrow${sel.has(i.id) ? ' ck' : ''}" data-pi="${i.id}">
          <button class="cb${sel.has(i.id) ? ' on' : ''}" data-act="pick"
                  style="width:18px;height:18px;font-size:10px;flex:0 0 auto">✓</button>
          <button class="ct" data-act="pick"><span>${esc(i.title)}</span>
            ${i.where ? `<span class="cn">${esc(i.where)}</span>` : ''}</button>
        </div>`).join('');
      Modal.open({ title:'מה לשבץ מ"' + l.name + '"', body:`
        <div id="plItems">${rows() || '<div class="ex">אין פריטים פתוחים ברשימה.</div>'}</div>
        <div class="ex" id="plCount" style="margin-top:10px">${sel.size} נבחרו</div>`,
        buttons:[{label:'חזרה',act:()=>{ Modal.shut(); onBack && onBack(); }},
                 {label:'אישור',kind:'p',act:()=>{
                    Modal.shut(); onDone([...sel]); }}]});
      Modal.body.addEventListener('click', e => {
        const row = e.target.closest('[data-pi]'); if(!row) return;
        const id = row.dataset.pi;
        if (sel.has(id)) sel.delete(id); else sel.add(id);
        document.getElementById('plItems').innerHTML = rows();
        document.getElementById('plCount').textContent = sel.size + ' נבחרו';
      });
    }

    function addItem(){
      const l = Store.list(UI.openList); if(!l) return;
      const i = $('#iTitle'), title = i.value.trim();
      if (!title){ i.focus(); return; }
      Store.addItem(l.id, { title,
        where: $('#iWhere') ? $('#iWhere').value.trim() : '',
        link:  $('#iLink')  ? $('#iLink').value.trim()  : '',
        releaseDate: $('#iRel') ? $('#iRel').value : '',
        img: pendingImg });
      i.value = '';
      if ($('#iLink')) $('#iLink').value = '';
      if ($('#iPrev')) $('#iPrev').innerHTML = '';
      pendingImg=''; i.focus(); UI.toast('נוסף');
    }
    $('#listsBody').addEventListener('keydown', e => {
      if (e.key==='Enter' && ['iTitle','iLink','iWhere'].includes(e.target.id)) addItem();
    });
    $('#listsBody').addEventListener('change', async e => {
      if (e.target.id !== 'iFile') return;
      const f = e.target.files[0]; if(!f) return;
      try {
        pendingImg = await shrink(f, 320);
        $('#iPrev').innerHTML = `<img src="${pendingImg}" style="width:62px;height:62px;border-radius:9px;margin-top:9px">`;
      } catch(x){ UI.toast('לא הצלחתי לקרוא את התמונה'); }
      e.target.value='';
    });
    const shrink = (file, max) => UI.shrinkImage(file, max);

    function editItem(l, id){
      const it = l.items.find(x => x.id === id); if(!it) return;
      Modal.open({ title:it.title, body:`
        <div style="margin-bottom:10px"><label>שם</label><input type="text" id="edT" value="${esc(it.title)}"></div>
        <div style="margin-bottom:10px"><label>${l.kind==='wish'?'תאריך יציאה':'איפה'}</label>
          ${l.kind==='wish' ? `<input type="date" id="edX" value="${esc(it.releaseDate||'')}">`
                            : `<input type="text" id="edX" value="${esc(it.where||'')}">`}</div>
        <div style="margin-bottom:10px"><label>קישור</label>
          <input type="text" id="edL" value="${esc(it.link||'')}" inputmode="url"></div>
        <div style="margin-bottom:10px"><label>מחיר (₪)</label>
          <input type="number" id="edP" value="${it.price==null?'':it.price}" inputmode="decimal" step="0.01"></div>
        <div><label>הערה</label><input type="text" id="edN" value="${esc(it.note||'')}"></div>`,
        buttons:[
          {label:'מחק', act:()=>{ Store.delItem(l.id,id); Modal.shut(); }},
          {label:'שמור', kind:'p', act:()=>{
            const px = parseFloat(document.getElementById('edP').value);
            Store.updateItem(l.id, id, {
              title: document.getElementById('edT').value.trim() || it.title,
              [l.kind==='wish'?'releaseDate':'where']: document.getElementById('edX').value.trim(),
              link:  document.getElementById('edL').value.trim(),
              price: isFinite(px) ? px : null,
              note:  document.getElementById('edN').value.trim(),
            });
            Modal.shut(); UI.toast('נשמר');
          }}]});
    }

    async function checkRelease(l, id){
      const it = l.items.find(x => x.id === id); if(!it) return;
      Modal.open({ title:it.title, body:`<div class="note">בודק…</div>`,
                   buttons:[{label:'סגור',act:()=>Modal.shut()}] });
      let html;
      try {
        const r = await Track.books(it.title);
        html = `<div class="msum">נמצא: ${esc(r.title)}${r.by?'\nמאת '+esc(r.by):''}
${r.date?'תאריך פרסום: '+esc(r.date):'אין תאריך פרסום במאגר'}</div>
          ${r.date ? `<button class="btn wide" id="useDate">קבע תאריך יציאה ${esc(r.date.slice(0,10))}</button>` : ''}
          <a class="btn wide" href="${Track.searchUrl(it.title,'book')}" target="_blank" rel="noopener">חפש בגוגל</a>`;
      } catch(err){
        html = `<div class="note">לא מצאתי מידע אוטומטי (${esc(String(err.message).slice(0,50))}).<br>
          הבדיקה האוטומטית עובדת לספרים. למשחקים אין מאגר חינמי שהדפדפן יכול לפנות אליו,
          ולכן שם הבדיקה ידנית.</div>
          <a class="btn wide" href="${Track.searchUrl(it.title,'book')}" target="_blank" rel="noopener">חפש ספר בגוגל</a>
          <a class="btn wide" href="${Track.searchUrl(it.title,'game')}" target="_blank" rel="noopener">חפש משחק בגוגל</a>`;
      }
      Modal.body.innerHTML = html;
      const ud = document.getElementById('useDate');
      if (ud) ud.addEventListener('click', () => {
        Track.books(it.title).then(r => {
          let d = (r.date||'').slice(0,10);
          if (d.length===4) d = d+'-01-01'; else if (d.length===7) d = d+'-01';
          Store.updateItem(l.id, id, { releaseDate:d, notified:false });
          Modal.shut(); UI.toast('נקבע: '+d);
        }).catch(() => UI.toast('לא הצלחתי'));
      });
    }

    function settle(l){
      const bought = l.items.filter(i => i.done);
      const rows = (bought.length ? bought : l.items);
      Modal.open({ title:'סגירת חשבון',
        body:`<div class="note" style="padding-bottom:12px">שילמת מהכסף שלך?</div>
          <div class="seg" id="stSeg" style="margin-bottom:14px">
            <button data-p="yes" aria-selected="true">כן, שילמתי</button>
            <button data-p="no">לא</button></div>
          <div id="stPrices">
            <div class="note" style="padding-bottom:8px">מחיר לכל פריט (אפשר להשאיר ריק)</div>
            ${rows.map(i => `<div class="item"><div class="rb">${esc(i.title)}</div>
              <input type="number" class="stp" data-id="${i.id}" value="${i.price==null?'':i.price}"
                placeholder="0.00" inputmode="decimal" step="0.01" style="width:96px"></div>`).join('')}
            <div style="margin-top:12px"><label>סה״כ (₪)</label>
              <input type="number" id="stTotal" inputmode="decimal" step="0.01" placeholder="0.00"></div>
          </div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label:'המשך',kind:'p',act:()=>settleStep2(l, rows)}]});
      const recalc = () => {
        let sum = 0;
        document.querySelectorAll('.stp').forEach(el => { const v = parseFloat(el.value); if (isFinite(v)) sum += v; });
        if (sum > 0) document.getElementById('stTotal').value = sum.toFixed(2);
      };
      Modal.body.addEventListener('input', e => { if (e.target.classList.contains('stp')) recalc(); });
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-p]'); if(!b) return;
        Modal.body.querySelectorAll('[data-p]').forEach(x => x.setAttribute('aria-selected', x===b));
        document.getElementById('stPrices').hidden = (b.dataset.p === 'no');
      });
      recalc();
    }

    function settleStep2(l, rows){
      const paid = Modal.body.querySelector('[data-p="yes"]')?.getAttribute('aria-selected') === 'true';
      const prices = {};
      Modal.body.querySelectorAll('.stp').forEach(el => {
        const v = parseFloat(el.value); if (isFinite(v)) prices[el.dataset.id] = v; });
      const total = parseFloat((Modal.body.querySelector('#stTotal')||{}).value) || 0;
      rows.forEach(i => { if (prices[i.id] != null) Store.updateItem(l.id, i.id, { price:prices[i.id] }); });

      const who = l.forWho || '';
      const lines = rows.map(i => '• ' + i.title + (prices[i.id]!=null ? ' — ' + prices[i.id].toFixed(2) + ' ₪' : ''));
      const msg = (who ? 'היי ' + who + ',\n' : '') + 'סיימתי את "' + l.name + '".\n\n' +
        lines.join('\n') + '\n\n' +
        (paid && total>0 ? 'סה״כ: ' + total.toFixed(2) + ' ₪\nשילמתי מהכסף שלי.'
                         : paid ? 'שילמתי מהכסף שלי.' : 'לא שילמתי מהכסף שלי.');
      const wa = 'https://wa.me/' + normPhone(l.phone) + '?text=' + encodeURIComponent(msg);
      Modal.open({ title:'ההודעה מוכנה',
        body:`<div class="msum">${esc(msg)}</div>`,
        buttons:[
          {label:'העתק', act:async()=>{
            try { await navigator.clipboard.writeText(msg); UI.toast('הועתק'); }
            catch(e){ UI.toast('לא הצלחתי להעתיק'); } }},
          {label:'שלח בוואטסאפ', kind:'p', act:()=>{
            window.open(wa,'_blank','noopener');
            Modal.open({ title:'למחוק את הרשימה?',
              body:`<div class="note">סיימת עם "${esc(l.name)}".</div>`,
              buttons:[{label:'להשאיר',act:()=>Modal.shut()},
                       {label:'מחק',kind:'p',act:()=>{ Store.delList(l.id); UI.openList=null;
                         Modal.shut(); UI.render(); }}]});
          }}]});
    }
    function normPhone(p){
      let d = String(p||'').replace(/\D/g,'');
      if (!d) return '';
      if (d.startsWith('972')) return d;
      if (d.startsWith('0')) return '972' + d.slice(1);
      return d;
    }

    /* ================= מקומות ================= */
    let lastResults = [];
    $('#placesBody').addEventListener('click', async e => {
      const seg = e.target.closest('#pSeg button');
      if (seg){ UI.addKind = seg.dataset.k; UI.render(); return; }

      if (e.target.closest('#qGo')){ await doSearch(); return; }

      const res = e.target.closest('#qResults [data-i]');
      if (res){
        const r = lastResults[+res.dataset.i]; if(!r) return;
        Store.addPlace(r.name, r.lat, r.lng, 250, null);
        UI.toast('נשמר: ' + r.name); lastResults = []; UI.render(); return;
      }
      if (e.target.closest('#pAdd')){
        const name = $('#pName').value.trim();
        if (!name){ UI.toast('צריך שם'); return; }
        if (!Geo.last){ UI.toast('אין עדיין מיקום — הפעל GPS בהגדרות'); return; }
        Store.addPlace(name, Geo.last.lat, Geo.last.lng,
                       Math.max(80, +$('#pRad').value || 250), $('#pParent').value || null);
        UI.toast('נשמר'); UI.render(); return;
      }
      if (e.target.closest('#mAdd')){
        const raw = $('#mName').value.trim();
        const lat = parseFloat($('#mLat').value), lng = parseFloat($('#mLng').value);
        if (!isFinite(lat) || !isFinite(lng)){ UI.toast('צריך נ״צ תקין'); return; }
        Store.addPlace(raw.replace(/-?\d{1,3}\.\d+\s*,?\s*-?\d{1,3}\.\d+/,'').trim() || 'מקום',
                       lat, lng, Math.max(80, +$('#mRad').value || 250), null);
        UI.toast('נשמר'); UI.render(); return;
      }
      const del = e.target.closest('[data-act="delPlace"]');
      if (del){
        const row = del.closest('[data-id]');
        Store.delPlace(row.dataset.id); UI.toast('נמחק'); return;
      }
    });
    $('#placesBody').addEventListener('input', e => {
      if (e.target.id !== 'mName') return;
      const c = Search.parseCoords(e.target.value);
      if (c){ $('#mLat').value = c.lat; $('#mLng').value = c.lng; }
    });
    $('#placesBody').addEventListener('keydown', e => {
      if (e.key === 'Enter' && ['qName','qArea'].includes(e.target.id)) doSearch();
    });
    async function doSearch(){
      const q = $('#qName').value.trim(), area = $('#qArea').value.trim();
      if (q.length < 2){ $('#qName').focus(); return; }
      const box = $('#qResults'), btn = $('#qGo');
      btn.textContent = '…'; box.innerHTML = `<div class="note" style="margin-top:10px">מחפש…</div>`;
      try {
        const { results, provider } = await Search.run(q, area);
        lastResults = results;
        box.innerHTML = `<div class="rule"></div>` + results.map((r,i) => `
          <button class="prow" data-i="${i}" style="width:100%;text-align:start">
            <div class="pb"><div class="pn2">${esc(r.name)}${r.city?' · '+esc(r.city):''}</div>
              <div class="pm2">${r.dist!=null ? UI.fmtM(r.dist)+' מכאן · ' : ''}${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}</div>
            </div></button>`).join('') +
          `<div class="note" style="margin-top:10px">${esc(provider)} · בחר תוצאה כדי לשמור אותה</div>`;
      } catch(err){
        lastResults = [];
        box.innerHTML = `<div class="notice" style="margin-top:12px">לא נמצא כלום.<br>
          החיפוש עובד מול מאגר מפות פתוח, ולכן <b>בסיסים ומתקנים צבאיים בדרך כלל לא מופיעים בו</b>.
          נסה למלא את שדה העיר בנפרד, או השתמש ב"כאן עכשיו" / נ״צ ידני.
          <br><br><span class="dim" style="font-size:11px">${esc(String(err.message).slice(0,110))}</span></div>`;
      }
      btn.textContent = 'חפש';
    }

    /* ================= הגדרות ================= */
    const srcNow = () => {
      const el = document.getElementById('srcUrl');
      const v = el ? UI.cleanSrc(el.value.trim()) : '';
      return v || UI.cleanSrc((Native.status()||{}).sourceUrl || '');
    };


    /* ייבוא גיבוי. בורר הקבצים של ה-WebView לא תמיד נפתח — במעטפות
       ישנות הוא לא מיושם בכלל, ואז לחיצה על הכפתור לא עושה כלום ובלי
       שום שגיאה. לכן: מנסים לפתוח אותו, ואם תוך שנייה וחצי לא קרה כלום
       מציעים את המסלולים החלופיים במקום להשאיר את המשתמש מול כפתור מת. */
    function importFlow(){
      const inp = document.getElementById('fileIn');
      if (!inp){ pasteImport(); return; }
      let opened = false;
      const mark = () => { opened = true; };
      window.addEventListener('blur', mark, { once:true });
      inp.addEventListener('change', mark, { once:true });
      try { inp.click(); } catch(e){ pasteImport(); return; }
      setTimeout(() => {
        window.removeEventListener('blur', mark);
        if (opened) return;
        Modal.open({ title:'בורר הקבצים לא נפתח',
          body:`<div class="note">המעטפת המותקנת לא יודעת לפתוח בורר קבצים.
                  יש שתי דרכים אחרות לשחזר גיבוי:</div>
                <div class="ex" style="margin-top:10px">1 · פתח את קובץ הגיבוי
                  מתוך ההורדות של הטלפון ובחר "פתח באמצעות משימה".</div>
                <div class="ex">2 · פתח את הקובץ בדפדפן, העתק את כל הטקסט,
                  וחזור לכאן להדביק אותו.</div>`,
          buttons:[{label:'סגור',act:()=>Modal.shut()},
                   {label:'הדבקת טקסט',kind:'p',act:()=>{ Modal.shut(); pasteImport(); }}]});
      }, 1500);
    }

    /** שחזור בלי קבצים בכלל — הדבקה ישירה של תוכן הגיבוי */
    function pasteImport(){
      Modal.open({ title:'הדבקת גיבוי',
        body:`<div class="note">הדבק כאן את כל תוכן קובץ הגיבוי.</div>
              <textarea id="pasteBox" rows="8" style="width:100%;margin-top:10px"
                placeholder='{"tasks":[…]}' dir="ltr"></textarea>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label:'שחזר',kind:'p',act:()=>{
                    const v = (document.getElementById('pasteBox')||{}).value || '';
                    if (!v.trim()){ UI.toast('לא הודבק כלום'); return; }
                    Modal.shut();
                    if (!window.__import(v.trim())) UI.toast('הטקסט לא תקין');
                 }}]});
      setTimeout(() => { const b = document.getElementById('pasteBox'); b && b.focus(); }, 120);
    }

    async function peekServer(){
      const base = srcNow();
      if (!/^https:\/\//.test(base)){ UI.toast('קודם שמור כתובת https'); return; }
      UI.toast('מוריד מהשרת…');
      try {
        const r = await fetch(UI.bustSrc(base), { cache:'no-store' });
        const txt = await r.text();
        const m = /const BUILD\s*=\s*'([^']+)'/.exec(txt);
        const there = m ? m[1] : null;
        const kb = Math.round(txt.length/1024);
        const looksApp = /MesimaNative|id="nav"/.test(txt);
        let verdict;
        if (!r.ok) verdict = 'השרת החזיר ' + r.status + '. הכתובת כנראה לא נכונה, או ש-Pages לא פעיל.';
        else if (!looksApp) verdict = 'מה שירד לא נראה כמו האפליקציה — כנראה דף שגיאה של GitHub.';
        else if (!there) verdict = 'בשרת יושבת גרסה ישנה בלי חותמת. העדכון האחרון לא הגיע לשרת.';
        else if (there === BUILD) verdict = 'בשרת יושבת בדיוק אותה גרסה שרצה אצלך. ' +
          'אם ציפית לחדשה — הקובץ לא נכנס ל-GitHub. בדוק ששם הקובץ הוא index.html בדיוק.';
        else verdict = 'בשרת יש גרסה שונה. לחץ "בדוק עדכון עכשיו" ואז "טען את הגרסה החדשה".';
        Modal.open({ title:'מה יש בשרת',
          body:`<div class="set"><div class="sb"><div class="st">אצלך רץ</div>
                  <div class="sd" dir="ltr" style="unicode-bidi:isolate">${esc(BUILD)}</div></div></div>
                <div class="set"><div class="sb"><div class="st">בשרת</div>
                  <div class="sd" dir="ltr" style="unicode-bidi:isolate">${esc(there||'— אין חותמת —')}</div></div></div>
                <div class="set"><div class="sb"><div class="st">תשובת השרת</div>
                  <div class="sd" dir="ltr" style="unicode-bidi:isolate">HTTP ${r.status} · ${kb} KB</div></div></div>
                <div class="notice" style="margin-top:12px">${esc(verdict)}</div>`,
          buttons:[{label:'סגור',act:()=>Modal.shut()}]});
      } catch(e){
        Modal.open({ title:'מה יש בשרת',
          body:`<div class="notice warn">לא הצלחתי להוריד את הקובץ.<br>
            <span dir="ltr" style="unicode-bidi:isolate">${esc(String(e.message).slice(0,140))}</span><br><br>
            אם הכתובת נכונה, כנראה ש-GitHub Pages לא מופעל, או שהקובץ לא בנתיב הזה.</div>`,
          buttons:[{label:'סגור',act:()=>Modal.shut()}]});
      }
    }

    /* ניהול סוגי אירוע — שייך לעולם האירועים, לא להגדרות האפליקציה.
       סוג אירוע הוא תוכן שהמשתמש בונה, כמו מקום או רשימה. */
    function eventTypesModal(back){
      const rows = () => Store.eventTypes().map(t => `
        <button class="pick" data-ety="${t.id}" style="border-bottom:0;padding:10px 2px">
          <span class="edot" style="background:${t.color};width:10px;height:10px"></span>
          <span class="pn">${esc(t.name)}</span>
          <span class="pm">ערוך</span></button>`).join('');
      Modal.open({ title:'סוגי אירוע',
        body:`<div id="etyList">${rows()}</div>
              <div class="ex" style="margin-top:10px">סוג אירוע קובע את הצבע ביומן,
                והוא גם מה שפריט חוזר יכול לדלג עליו כחריג — למשל "חג" או "חופשה".</div>`,
        buttons:[{label: back ? 'חזרה' : 'סגור', act:()=>{ Modal.shut(); back && back(); }},
                 {label:'+ סוג חדש', kind:'p', act:()=>eventTypeModal(null, () => eventTypesModal(back))}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-ety]'); if(!b) return;
        eventTypeModal(Store.eventType(b.dataset.ety), () => eventTypesModal(back));
      });
    }

    function eventTypeModal(t, back){
      let color = t ? t.color : UI.PALETTE[0];
      Modal.open({ title: t ? 'עריכת סוג' : 'סוג אירוע חדש',
        body:`<div style="margin-bottom:14px"><label>שם</label>
                <input type="text" id="etyName" value="${t?esc(t.name):''}" autocomplete="off"></div>
              <label>צבע</label>
              <div class="swatches" id="etyPal">${UI.PALETTE.map(c =>
                `<button data-c="${c}" style="background:${c}" aria-selected="${c===color}"></button>`).join('')}</div>`,
        buttons:[
          ...(t ? [{label:'מחק',act:()=>{
                    if (Store.delEventType(t.id)){ Modal.shut(); UI.toast('נמחק'); back && back(); }
                    else UI.toast('צריך להישאר לפחות סוג אחד'); }}]
                : [{label:'ביטול',act:()=>{ Modal.shut(); back && back(); }}]),
          {label:t?'שמור':'צור',kind:'p',act:()=>{
            const n = document.getElementById('etyName').value.trim();
            if (!n){ UI.toast('צריך שם'); return; }
            if (t) Store.updateEventType(t.id, { name:n, color });
            else Store.addEventType(n, color);
            Modal.shut(); UI.toast('נשמר'); back && back();
          }}]});
      Modal.body.addEventListener('click', e => {
        const b = e.target.closest('[data-c]'); if(!b) return;
        color = b.dataset.c;
        Modal.body.querySelectorAll('#etyPal button').forEach(x => x.setAttribute('aria-selected', x===b));
      });
    }

    $('#settingsBody').addEventListener('click', async e => {
      if(e.target.closest('#syncEnabled')){CloudSync.enable(Store.all.prefs.syncEnabled===false);UI.render();return;}
      if (e.target.closest('#swGeo')){
        if (Geo.on){ Geo.stop(); Store.setPref('geo', false); UI.render(); return; }
        if (!UI.originState().canGeo && !Native.on){ UI.toast('המיקום חסום מהכתובת הזאת'); return; }
        if(Native.on) Native.askLocation(); Store.setPref('geo', true); Geo.start(); UI.render(); return;
      }
      if (e.target.closest('#swVib')){ Store.setPref('vib', !Store.all.prefs.vib); return; }
      if (e.target.closest('#swSnd')){ Store.setPref('snd', !Store.all.prefs.snd); return; }
      if (e.target.closest('#swNotif')){
        if (Store.all.prefs.notif){ Store.setPref('notif', false); UI.render(); return; }
        /* מתג שלא יכול להידלק חייב להגיד למה, ולא להישאר כבוי בשקט */
        if (!Alerts.supported){
          UI.toast('הדפדפן הזה לא תומך בהתראות מערכת');
          return;
        }
        const ok = await Alerts.ask();
        Store.setPref('notif', ok);
        UI.toast(ok ? 'התראות מאושרות' : 'לא אושר');
        UI.render();
        return;
      }
      if (e.target.closest('#btnExport')){
        UI.download('mesima-backup.json', Store.export(), 'application/json');
        UI.toast('הגיבוי הורד'); return;
      }
      if (e.target.closest('#btnImport')){ importFlow(); return; }
      if (e.target.closest('#btnPaste')){ pasteImport(); return; }
      if (e.target.closest('#btnWipe')){
        Modal.open({ title:'למחוק הכול?',
          body:`<div class="note">כל המשימות, האירועים, ההערות, המקומות והרשימות יימחקו.
                זה בלתי הפיך.</div>`,
          buttons:[{label:'ביטול',act:()=>Modal.shut()},
                   {label:'מחק הכול',kind:'p',act:()=>{ Store.wipe(); Modal.shut(); UI.toast('נמחק'); }}]});
        return;
      }
      const page = e.target.closest('[data-settings-page]');
      if(page){ Settings.open(page.dataset.settingsPage); return; }
      const tog = e.target.closest('[data-settoggle]');
      if (tog){
        const k = tog.dataset.settoggle;
        UI.setOpen[k] = !UI.setOpen[k];
        const a = tog.closest('.acc');
        if (a) a.setAttribute('aria-expanded', UI.setOpen[k]);
        return;
      }
      const nat = e.target.closest('[data-nat]');
      if (!nat) return;
      ({ loc:()=>Native.askLocation(), notif:()=>Native.askNotifications(),
         batt:()=>Native.battery(), samsung:()=>Native.samsung(),
         alarms:()=>Native.showAlarms(),
         exact:()=>Native.askExact(),
         fullscreen:()=>Native.askFullScreen(),
         chan:()=>Native.openChannel(),
         resync:()=>{ const n2 = Native.syncNow();
                      UI.toast(n2 < 0 ? 'הגשר לא הגיב' : n2 + ' תזכורות נרשמו');
                      UI.render(); },
         testnow:()=>{
           const r = Native.testNotify();
           UI.toast(r === 'sent' ? 'נשלחה התראה — תסתכל למעלה' : ('שגיאה: ' + r));
         },
         test60:()=>{
           const at = Native.testAlarm(60);
           UI.toast(at ? 'תזכורת מבחן ב-' + new Date(at).toTimeString().slice(0,5)
                       : 'המערכת לא קיבלה את התזכורת');
         },
         check:()=>{
           const base = srcNow();
           if (!/^https:\/\//.test(base)){ UI.toast('קודם שמור כתובת https'); return; }
           Native.setSource(UI.bustSrc(base));
           UI.toast('בודק…'); Native.checkUpdate();
         },
         apply:()=>Native.applyUpdate(),
         peek:peekServer,
         saveSrc:()=>{ const v = UI.cleanSrc(document.getElementById('srcUrl').value.trim());
                       if (!/^https:\/\//.test(v)){ UI.toast('צריך כתובת https'); return; }
                       Native.setSource(v); UI.toast('נשמר'); }
       })[nat.dataset.nat]?.();
    });
    $('#settingsBody').addEventListener('change', e => {
      if (e.target.id !== 'fileIn') return;
      const f = e.target.files[0]; if(!f) return;
      const r = new FileReader();
      r.onload = () => { try { Store.import(r.result); UI.toast('יובא בהצלחה'); }
                         catch(x){ UI.toast('קובץ לא תקין'); } };
      r.readAsText(f); e.target.value = '';
    });
    window.addEventListener('native-perms', () => { Native.sync(); UI.render(); });

    /* ================= התראות (סעיפים 51–58) ================= */
    /** "הבנתי" = ראיתי. לא מסמן בוצע, לא מארכב, לא סוגר הרגל. */
    /* פתיחה מתוך התראה = פרטי המשימה, לא העורך */
    $('#alOpen').addEventListener('click', () => {
      const a = UI.alertItem;
      const id = a && a.item && a.item.id;
      UI.closeAlert();
      if (id && Store.task(id)) openTask(id);
    });
    $('#alComplete').addEventListener('click',()=>{const a=UI.alertItem;if(a?.item&&Store.task(a.item.id))Store.finishTask(a.item.id);UI.closeAlert();});
    $('#alOk').addEventListener('click', () => {
      const a = UI.alertItem;
      if (a && a.item && a.item.rt){ a.item.rt.ackAt = Date.now(); Store.commit(); }
      UI.closeAlert(); UI.render();
    });
    $('#alLater').addEventListener('click', () => {
      const a = UI.alertItem;
      if (a && a.item){
        a.item.rt = a.item.rt || {};
        a.item.rt.snoozeTo = Date.now() + 15*60000;
        const pending={id:a.item.id,title:a.item.title,body:[a.item.note,a.why||'תזכורת שנדחתה'].filter(Boolean).join('\n\n'),at:Date.now()+900000};
        if(window.MesimaNative?.snoozeNotification)window.MesimaNative.snoozeNotification(pending.id,pending.title,pending.body);
        else if(window.MesimaDesktop)window.MesimaDesktop.snooze(pending);
        else {const rows=JSON.parse(localStorage.getItem('mesima.snoozes')||'[]').filter(x=>x.id!==pending.id);rows.push({...pending,meta:ReminderLink.resolve(pending.id)});localStorage.setItem('mesima.snoozes',JSON.stringify(rows));}
        Store.commit();
      }
      UI.closeAlert(); UI.toast('נדחה ב־15 דקות'); UI.render();
    });
    /* לחיצה על גוף ההתראה פותחת את הפריט (סעיף 55) */
    $('#alert').addEventListener('click', e => {
      if (e.target.closest('.btns')) return;
      const a = UI.alertItem;
      if (!a) { UI.closeAlert(); return; }
      const item = a.item;
      UI.closeAlert();
      if (a.kind === 'event'){ const ev = Store.event(item.id); if (ev) return eventMenu(ev); }
      else if (a.kind === 'place'){ UI.screen = null; UI.section = 'today'; UI.tview = 'day';
                                    UI.selDate = Plan.today(); UI.render(); return; }
      else { const t = Store.task(item.id); if (t) return openTask(t.id); }
      UI.render();
    });

    /* ================= כללי ================= */
    $('#mClose').addEventListener('click', () => Modal.tryShut());
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') Modal.tryShut(); });
    document.addEventListener('focusout', () => {
      setTimeout(() => { if (UI.deferred && !UI.typing()) UI.render(); }, 60);
    });

    /* כל שדה תאריך פותח את הלוח הפנימי במקום את בורר הדפדפן */
    document.addEventListener('mousedown', e => {
      const inp = e.target.closest('input[type=date]');
      if (!inp) return;
      e.preventDefault(); inp.blur();
      DatePick.open(inp.value || Plan.today(), v => {
        inp.value = v;
        inp.dispatchEvent(new Event('change', { bubbles:true }));
        inp.dispatchEvent(new Event('input',  { bubbles:true }));
      }, { clear: !inp.required });
    }, true);
    document.addEventListener('focus', e => {
      if (e.target.matches && e.target.matches('input[type=date]')) e.target.blur();
    }, true);

    /* ---------------------------------------------------------------
       כפתור החזרה של אנדרואיד. מקלף שכבה אחת בכל לחיצה, בסדר קבוע,
       ורק כשאין יותר מה לקלף (עמוד "היום", תצוגת יום, היום עצמו)
       הוא מחזיר false והמערכת סוגרת את האפליקציה.
       --------------------------------------------------------------- */
    /* האם יש עוד שכבה לסגור. אותה שאלה בדיוק שגם goBack שואל. */
    function hasBack(){
      return !!(DatePick.isOpen() || $('#modal').classList.contains('on')
             || $('#imgzoom').classList.contains('on')
             || $('#alert').classList.contains('on')
             || UI.reorder
             || UI.openNote || UI.openList || UI.screen
             || UI.section !== 'today' || UI.trail.length
             || UI.tview !== 'day' || UI.selDate !== Plan.today());
    }
    /* אחרי כל רינדור אנדרואיד מקבל תמונת מצב עדכנית */
    UI.afterRender = () => Native.canBack(hasBack());

    function goBack(){
      /* מקלפים שכבה אחת בכל פעם, מהעליונה לתחתונה */
      if ($('#imgzoom').classList.contains('on')){
        $('#imgzoom').classList.remove('on'); return true; }
      if (DatePick.isOpen()){ DatePick.shut(); return true; }
      if ($('#modal').classList.contains('on')){ Modal.tryShut(); return true; }
      if ($('#alert').classList.contains('on')){ UI.closeAlert(); return true; }
      if (UI.reorder){ UI.reorder = null; UI.render(); return true; }
      if (UI.openNote){ closeNote(); return true; }
      if (UI.openList){ UI.openList = null; UI.render(); return true; }
      if (UI.screen==='settings' && Settings.back()) return true;
      if (UI.screen){ UI.screen = null; UI.render(); return true; }
      if (UI.section !== 'today'){ UI.section = 'today'; UI.render(); return true; }

      /* בתוך "היום": חוזרים לאחור לפי המסלול שהמשתמש עשה */
      if (UI.trail.length){
        const st = UI.trail.pop();
        UI.tview = st.tview; UI.selDate = st.selDate; UI.rangeFrom = st.rangeFrom;
        if (st.calY != null){ UI.calY = st.calY; UI.calM = st.calM; }
        UI.render(); return true;
      }
      if (UI.tview !== 'day'){ UI.tview = 'day'; UI.render(); return true; }
      if (UI.selDate !== Plan.today()){ UI.selDate = Plan.today(); UI.render(); return true; }
      return false;   /* אין יותר לאן — כאן מותר לצאת */
    }
    window.__back = goBack;

    /* גיבוי שנפתח מבחוץ ("פתח באמצעות משימה" מההורדות, או שיתוף).
       מסלול שחזור עצמאי, שלא עובר דרך <input type="file"> של ה-WebView.
       תמיד שואל לפני שהוא דורס — ייבוא מחליף את כל הנתונים. */
    window.__import = function(text){
      if (!text) return false;
      let p = null;
      try { p = JSON.parse(text); } catch(e){ p = null; }
      if (!p || typeof p !== 'object' || !Array.isArray(p.tasks)){
        UI.toast('זה לא נראה כמו קובץ גיבוי של משימה');
        return false;
      }
      const n = p.tasks.length;
      const ev = Array.isArray(p.events) ? p.events.length : 0;
      Modal.open({ title:'לשחזר מהגיבוי?',
        body:`<div class="note">הקובץ מכיל <b>${n}</b> משימות ו-<b>${ev}</b> אירועים.
              שחזור <b>מחליף</b> את כל מה שקיים עכשיו באפליקציה.</div>`,
        buttons:[{label:'ביטול',act:()=>Modal.shut()},
                 {label:'שחזר',kind:'p',act:()=>{
                    try { Store.import(text); Modal.shut(); UI.toast('שוחזר · ' + n + ' משימות');
                          UI.render(); }
                    catch(x){ Modal.shut(); UI.toast(x.message || 'הקובץ פגום'); }
                 }}]});
      return true;
    };

    /* ההתראה של אנדרואיד מוסרת את המזהה, והאפליקציה פותחת את החלון
       המלא עם התיאור, התמונה ותת-המשימות — לא רק שורה בשורת הסטטוס. */
    window.__alarm = function(id){
      if (!id) return false;
      const target=ReminderLink.resolve(id);
      if(target?.kind==='checklist'){checklistView(target.taskId,target.checklistId);return true;}
      if(target?.kind==='event')id=target.eventId;
      else if(target?.taskId)id=target.taskId;
      const t = Store.task(id);
      if (t){
        const r = t.reminder;
        const why = Store.isHabit(t) ? 'תזכורת יומית'
                  : (r && r.type === 'time') ? 'הגיע הזמן — ' + r.at : 'תזכורת';
        UI.showAlert(t, why, 'task');
        return true;
      }
      const ev = Store.event(id);
      if (ev){
        UI.showAlert(ev, ev.allDay ? 'היום' : 'מתחיל ב-' + ev.time, 'event');
        return true;
      }
      return false;
    };

    /* גם בדפדפן רגיל: כפתור האחורה מתנהג אותו דבר */
    history.replaceState({ m:0 }, '');
    window.addEventListener('popstate', () => {
      goBack();
      history.pushState({ m:1 }, '');
    });
    history.pushState({ m:1 }, '');

    window.__openTask=openTask; window.__newTask=()=>taskModal({}); window.__newEvent=()=>{UI.selDate=Plan.today();eventModal(null);}; window.__openEvent=id=>{const e=Store.event(id);if(e)eventMenu(e);};
    NativeState.init();
    Store.onChange(() => { Native.sync();
      if(UI.alertItem&&Store.reminderBlocked(ReminderLink.resolve(UI.alertItem.item.id)))UI.closeAlert();
      UI.render(); });
    Native.sync();
    if (Store.all.prefs.geo && UI.originState().canGeo) Geo.start();
    Geo.onFix(() => { Engine.check(); UI.render(); });
    UI.render();
    /* מודיעים לאנדרואיד שהדף חי — אם נכנסנו מלחיצה על התראה,
       החלון המלא של התזכורת נפתח עכשיו. */
    Native.canBack(false);
    Native.ready();
  }

  return { init };
})();

/* ------------------------------- Engine --------------------------------- */

document.addEventListener('click',e=>{
 const rel=e.target.closest('[data-related-task]'),undo=e.target.closest('[data-reopen-task]');
 if(rel){e.stopPropagation();Modal.shut();window.__openTask?.(rel.dataset.relatedTask);}
 if(undo){e.stopPropagation();Store.undoCompletion(undo.dataset.reopenTask);Modal.shut();UI.toast('ההשלמה בוטלה');}
},true);
