// Task editor owns drafts; Wire supplies navigation callbacks.
const TaskEditor = (() => {
  const esc=UI.esc;
  const DAYL=['א','ב','ג','ד','ה','ו','ש'];
  const CAT={army:'צבא',home:'בית',free:'אישי'};
  let hooks;
  const checklistSetupModal=(...args)=>hooks.checklistSetupModal(...args);
  const pickEvent=(...args)=>hooks.pickEvent(...args);
  const eventMenu=(...args)=>hooks.eventMenu(...args);
    function taskModal(o){
      o = o || {};
      const t = o.id ? Store.task(o.id) : null;
      if (o.id && !t) return;
      const isNew = !t;
      const d  = o.draft || null;                 /* מצב שחזור אחרי יצירת תת-משימה */
      const parent = o.parentId ? Store.task(o.parentId)
                   : (t && t.parentId ? Store.task(t.parentId) : null);
      const isChild = !!(o.parentId || o.pendingUnder || (t && t.parentId));

      let kind = d ? d.kind
               : (t ? t.kind
                 : (o.kind === 'long' ? 'long' : o.kind === 'check' ? 'check' : 'short'));
      let cat  = d ? d.cat  : (t ? t.mission
                   : (o.mission || (parent && parent.mission) || UI.filter !== 'all' && UI.filter || 'army'));
      const r  = (t && t.reminder) || {};
      const initialRepeat = t && (t.kind === 'check' ? (t.checklists||[])[0]?.repeat : t.repeat);
      let rep  = d ? d.rep
               : (initialRepeat ? { days:initialRepeat.days.slice(), times:Recur.times(initialRepeat).slice() }
                                        : (o.habit ? { days:[0,1,2,3,4], times:['20:00'] } : null));
      /* חריגים והתאמה סביב אירועים נשמרים בתוך repeat, לא במודל נפרד */
      let skipTypes = d ? (d.skipTypes || []).slice()
                    : ((initialRepeat && initialRepeat.skipTypes) || []).slice();
      let skipScope = d ? (d.skipScope || 'day')
                    : ((initialRepeat && initialRepeat.skipScope) || 'day');
      let around    = d ? !!d.around : !!(initialRepeat && initialRepeat.around);
      /* מצב הצ׳קליסט: חד-פעמי או רב-פעמי. הרב-פעמי נשען על אותו repeat
         של הרגל, ולכן הוא מקבל את כל האפשרויות שלו בלי מנוע שני. */
      const ownCl = (t && t.kind === 'check') ? (t.checklists||[])[0] : null;
      let checkMode = d ? (d.checkMode || 'once')
                    : (ownCl && ownCl.repeat && Recur.times(ownCl.repeat).length) ? 'rep' : 'once';
      let planned = d ? d.date : (t ? t.planned : (o.planned || null));
      /* מה שטרם נשמר — קיים רק בזיכרון עד שההורה נשמר.
         pending = תת-משימות והרגלים · pendLists = צ׳קליסטים */
      let pending   = d ? d.pending.slice()   : [];
      /* צ׳קליסטים ממתינים ליצירה — קיימים בזיכרון עד שההורה נשמר */
      const clone = value => JSON.parse(JSON.stringify(value));
      let pendLists = clone(d ? d.pendLists : t ? (t.checklists || [])
                             : (o.preset && o.preset.checklists) || []);
      const originalLists = clone(d && d.originalLists ? d.originalLists : (t && t.checklists) || []);
      let beforeCheck = clone(d ? d.beforeCheck || null : null);
      let flushItemEdit = null;
      /* האירוע המקושר. אפשר לבחור אותו כבר ביצירה, לפני השמירה. */
      let evId = d ? d.evId : (t ? (t.eventId || '') : (o.eventId || ''));

      let relatedIds=d?.relatedIds?.slice() || (t?Store.relatedTasks(t.id).map(x=>x.id):[]);
      const tops = Store.topPlaces();
      const placeOpts = tops.map(top =>
        `<option value="${top.id}">${esc(top.name)}</option>` +
        Store.subPlaces(top.id).map(k => `<option value="${k.id}">&nbsp;&nbsp;${esc(k.name)}</option>`).join('')
      ).join('') || `<option value="">— אין מקומות —</option>`;

      const underName = o.pendingUnder || (parent && parent.title) || '';
      const heading = isNew
        ? (underName ? 'תת-משימה תחת "' + esc(underName) + '"' : 'משימה חדשה')
        : (isChild ? 'עריכת תת-משימה' : 'עריכת משימה');

      const streakBlock = () => {
        if (!t || !Store.isHabit(t)) return '';
        const today = Plan.today(), cells = [];
        for (let i = 13; i >= 0; i--){
          const k = Plan.shift(today, -i);
          cells.push(`<i class="${!Store.habitDay(t,k) ? 'off' : (Store.habitFull(t,k) ? 'full' : '')}${
            k===today?' td':''}" title="${k}">${DAYL[new Date(k+'T00:00:00').getDay()]}</i>`);
        }
        const n = Store.streak(t.id);
        return `<div style="margin-bottom:16px"><label>רצף</label>
          <div class="strip">${cells.join('')}</div>
          <div class="note" style="margin-top:7px">${n
            ? n + (n===1?' יום':' ימים') + ' ברצף' : 'עוד לא התחלת רצף'}</div></div>`;
      };

      /* תמונה אחת לכל משימה, מהגלריה בלבד — בלי מצלמה בתוך האפליקציה */
      let img = d ? d.img : (t ? (t.img || '') : '');
      function imgBox(){
        return img
          ? `<div class="imgrow"><img src="${img}" alt="">
               <button class="txtbtn" id="etImgDel">הסר תמונה</button></div>`
          : `<button class="txtbtn" id="etImgAdd">+ תמונה מהגלריה</button>`;
      }
      function paintImg(){
        ['etImgBox','etImgBox2'].forEach(id => {
          const b = document.getElementById(id);
          if (b && (id === 'etImgBox' || !g('etImgSolo').hidden)) b.innerHTML = imgBox();
        });
      }
      function repaintEvent(){ const h = document.getElementById('etEventHost');
                               if (h) h.innerHTML = eventBlock(); }
      /* התאריך נבחר מהשורה, לא משדה ריק בלי תיאור */
      function setDate(v){
        planned = v || null;
        if (g('etDate')) g('etDate').value = v || '';
        const show = g('etDateShow');
        if (show) show.textContent = v ? Plan.longDate(v) : '';
        const which = !v ? 'none' : v === Plan.today() ? 'today'
                    : v === Plan.shift(Plan.today(),1) ? 'tom' : 'pick';
        B.querySelectorAll('#etWhen button').forEach(x =>
          x.setAttribute('aria-selected', x.dataset.d === which));
        refreshSummaries();
      }

      const acc = (id, name, body) => `
        <div class="acc" data-acc="${id}" aria-expanded="false">
          <button class="ah"><span class="an">${name}</span>
            <span class="as" data-sum="${id}">—</span><span class="ar">‹</span></button>
          <div class="ab">${body}</div></div>`;

      /* ---- רשימת הפריטים: ממתינים (חדש) או שמורים (עריכה) ---- */
      function listsNow(){ return pendLists; }
      function itemsOf(c){ return c.items; }
      function itemRows(c){
        const l = c.items;
        if (!l.length) return `<div class="subempty">אין עדיין פריטים</div>`;
        return l.map((x,i) => `<div class="subrow">
          <button class="cb${x.checked?' on':''}" data-ick="${x.id}" data-clid="${c.id}"
                  style="width:18px;height:18px;font-size:10px;flex:0 0 auto">✓</button>
          <button class="sb2" data-iedit="${x.id}" data-clid="${c.id}">
            <div class="st2">${esc(x.title)}</div>
            ${x.note ? `<div class="sm2">${esc(x.note)}</div>` : ''}</button>
          <span class="ord">
            <button data-imv="${x.id}|-1" data-clid="${c.id}" ${i===0?'disabled':''} aria-label="הזז למעלה">↑</button>
            <button data-imv="${x.id}|1" data-clid="${c.id}" ${i===l.length-1?'disabled':''} aria-label="הזז למטה">↓</button></span>
          <button class="x" data-irm="${x.id}" data-clid="${c.id}" aria-label="הסר">×</button></div>`).join('');
      }
      function repaintLists(){
        const box = document.getElementById('etContent');
        if (!box) return;
        listsNow().forEach(c => {
          const el = box.querySelector(`[data-clbox="${c.id}"]`);
          if (el) el.innerHTML = itemRows(c);
        });
      }

      /* ---- תת-משימות והרגלים: שני מקטעים נפרדים, לעולם לא עץ מעורבב ---- */
      /** מקטע אחד בכל קריאה — תת-משימות והרגלים לעולם לא מעורבבים */
      function childRows(which){
        const mk = (c, key, hab) => ({ key:String(key), title:c.title, hab,
          meta: isNew ? pendingMeta(c) : UI.taskMeta(c, { noCat:true, noKids:true }) });
        let l;
        if (isNew){
          l = pending.map((c,i) => mk(c, i, !!c.repeat))
                     .filter(x => which === 'habs' ? x.hab : !x.hab);
        } else {
          l = which === 'habs' ? Store.habitsOf(t.id).map(c => mk(c, c.id, true))
                               : Store.subtasksOf(t.id).map(c => mk(c, c.id, false));
        }
        if (!l.length) return `<div class="subempty">${
          which === 'habs' ? 'אין עדיין הרגלים' : 'אין עדיין תת-משימות'}</div>`;
        return l.map((x,i) => `<div class="subrow">
            <button class="sb2" data-open="${x.key}">
              <div class="st2">${esc(x.title)}</div>
              ${x.meta ? `<div class="sm2">${esc(x.meta)}</div>` : ''}</button>
            ${isNew ? '' : `<span class="ord">
              <button data-cmv="${x.key}|-1" ${i===0?'disabled':''} aria-label="הזז למעלה">↑</button>
              <button data-cmv="${x.key}|1" ${i===l.length-1?'disabled':''} aria-label="הזז למטה">↓</button></span>`}
            <button class="x" data-rm="${x.key}" aria-label="הסר">×</button></div>`).join('');
      }
      function repaintKids(){
        if (g('etKids')) g('etKids').innerHTML = childRows('subs');
        if (g('etHabs')) g('etHabs').innerHTML = childRows('habs');
      }
      function pendingMeta(c){
        const out = [];
        if (c.checklists && c.checklists.length) out.push(c.checklists.length + ' צ׳קליסטים');
        if (c.kind === 'long') out.push('ארוך טווח');
        if (c.reminder && c.reminder.type === 'time') out.push('עד ' + c.reminder.at);
        if (c.reminder && c.reminder.type === 'place') out.push(UI.whereLabel(c.reminder));
        if (c.reminder && c.reminder.type === 'trip')  out.push('אחרי ' + c.reminder.km + ' ק״מ');
        if (c.repeat) out.push('חוזר · ' + UI.repeatLabel(c.repeat) + ' · ' + c.repeat.times.join(' '));
        if (c.planned) out.push(Plan.label(c.planned));
        return out.join(' · ');
      }

      /* ---------------------------------------------------------------
         מבנה העורך: קודם מה שחייבים לדעת, אחר כך מה ששייך למשימה הזאת,
         ורק בסוף — "אפשרויות נוספות". משימה פשוטה נוצרת בלי לגלול
         דרך כל היכולות של האפליקציה.
         --------------------------------------------------------------- */

      /* מצב ההתראה. זהו שדה אחד, בדיוק כמו במודל הנתונים: למשימה יש
         תזכורת אחת. חד-פעמית וחוזרת לא מוצגות יחד לעולם. */
      let mode = d ? d.mode
               : rep ? 'repeat'
               : (r.type === 'place') ? 'place'
               : (r.type === 'trip')  ? 'trip'
               : (r.type === 'time' || (t && t.planned)) ? 'once'
               : (o.habit ? 'repeat' : (o.planned ? 'once' : 'none'));
      if (o.habit) mode = 'repeat';

      /* עורך הרגל ממוקד = יצירת הרגל, או עריכת הרגל שיושב בתוך משימה.
         משימת שורש שחוזרת נשארת משימה — ולכן שומרת את בורר הסוג. */
      const isHabitEditor = !!o.habit || !!(t && Store.isHabit(t) && t.parentId);
      /* מה מוצג ומה נקבע לבד (סעיף 7 באפיון):
         - סוג: נבחר ביצירה (גם לתת-משימה), מוסתר בעריכה
         - קטגוריה: רק ביצירת משימה ראשית מתוך "הכול"; אחרת יורשת
           מה-TAB או מההורה. שינוי קטגוריה קיים דרך "העבר לקטגוריה…" */
      /* ילד של מיכל הוא תמיד קצר-טווח — ולכן השאלה לא נשאלת בכלל.
         זה נכון בכל עומק, לא רק לילד ישיר. */
      const underLong = !Store.canBeLong(o.id || null,
                          o.parentId || (t && t.parentId) || null);
      if (underLong) kind = 'short';
      const showKind = isNew && !isHabitEditor && !underLong;
      const showCat  = isNew && !isChild && !isHabitEditor && UI.filter === 'all';
      if (isNew && !isChild && UI.filter !== 'all') cat = UI.filter;

      const alertSeg = () => `
        <div class="seg" id="etMode">
          ${isHabitEditor ? '' : `
            <button data-a="none"   aria-selected="${mode==='none'}">ללא</button>
            <button data-a="once"   aria-selected="${mode==='once'}">חד-פעמית</button>`}
          <button data-a="repeat" aria-selected="${mode==='repeat'}">חוזרת</button>
        </div>`;

      const onceBlock = () => `
        <div id="etOnce">
          <div class="whenrow">
            <label id="etWhenLbl">מתי?</label>
            <div class="seg" id="etWhen">
              <button data-d="none" aria-selected="${!planned}">ללא תאריך</button>
              <button data-d="today" aria-selected="${planned===Plan.today()}">היום</button>
              <button data-d="tom" aria-selected="${planned===Plan.shift(Plan.today(),1)}">מחר</button>
              <button data-d="pick" aria-selected="${!!(planned && planned!==Plan.today()
                && planned!==Plan.shift(Plan.today(),1))}">תאריך אחר</button>
            </div>
            <div class="whenpick" id="etDateShow">${planned ? esc(Plan.longDate(planned)) : ''}</div>
            <input type="date" id="etDate" value="${esc(planned||'')}" hidden>
          </div>
          <div class="hourrow" id="etTimeWrap">
            <label>שעה — אופציונלי</label>
            <input type="time" id="etTime" value="${esc(d ? d.time : (r.type==='time'?r.at:''))}">
          </div>
          <div class="ex" id="etOnceEx">קורה פעם אחת. למשל "להתקשר למפקד מחר ב-18:00".</div>
        </div>`;

      const repeatBlock = () => `
        <div id="etRepeat">
          <label>באילו ימים</label>
          <div class="days" id="etDays">${DAYL.map((x,i) =>
            `<button data-d="${i}" aria-selected="${rep ? rep.days.includes(i) : false}">${x}</button>`).join('')}</div>
          <label style="margin-top:12px">באילו שעות</label>
          <div class="times" id="etTimes">
            ${(rep ? rep.times : ['20:00']).map(x => `<input type="time" class="ht" value="${esc(x)}">`).join('')}
            <button class="btn" id="etAddTime" style="padding:8px 11px">+ שעה</button></div>
          <div class="ex">${kind === 'check'
            ? 'הצ׳קליסט חוזר בימים קבועים. סימון כל הפריטים סוגר את המחזור, ' +
              'והסימונים מתאפסים שש שעות לפני המופע הבא.'
            : 'חוזר בימים קבועים. למשל "ללמוד Fusion בכל ראשון ושלישי ב-20:00". ' +
              'סימון אחד ביום סוגר את היום' + (Native.on ? ', ומשתיק את השעות שנשארו' : '') +
              '. פריט חוזר הוא פעולה אחת בפני עצמה — הוא לא מחזיק תת-משימות או צ׳קליסטים.'}</div>
          ${exceptBlock()}
        </div>`;

      /* ---- חריגים והתאמה סביב אירועים ----
         שני דברים שונים בכוונה, ולכן הם מוסברים זה ליד זה:
         חריג = לא צריך בכלל, והרצף נשמר.
         התאמה = כן צריך, רק לא באמצע האירוע. */
      const exceptBlock = () => {
        const types = Store.eventTypes();
        if (!types.length) return '';
        return `
        <div class="esec" id="etExcept" style="margin-top:14px">
          <div class="esechead"><span>חריגים</span></div>
          <div class="ex">דלג כשיש אירוע מסוג…</div>
          <div id="etSkipTypes" style="margin-top:6px">${types.map(x => `
            <button class="pick" data-skt="${x.id}" aria-checked="${skipTypes.includes(x.id)}"
                    style="border-bottom:0;padding:8px 2px">
              <span class="bx">✓</span>
              <span class="edot" style="background:${x.color};width:10px;height:10px"></span>
              <span class="pn">${esc(x.name)}</span></button>`).join('')}</div>
          <div id="etSkipScopeWrap" ${skipTypes.length ? '' : 'hidden'}>
            <label style="margin-top:10px">מתי לדלג</label>
            <div class="seg" id="etSkipScope">
              <button data-sc="day"  aria-selected="${skipScope==='day'}">ביום האירוע</button>
              <button data-sc="week" aria-selected="${skipScope==='week'}">בשבוע של האירוע</button>
            </div>
            <div class="ex">ביום — למשל "להניח תפילין", שמדלגים עליו רק ביום חג.
              בשבוע — למשל צ׳קליסט שבועי, שמדלגים עליו אם יש חופשה באותו שבוע.
              יום שדילגת עליו לא שובר את הרצף.</div>
          </div>
          <div class="esechead" style="margin-top:14px"><span>התאמה סביב אירועים</span></div>
          <button class="pick" id="etAround" aria-checked="${around}"
                  style="border-bottom:0;padding:8px 2px">
            <span class="bx">✓</span>
            <span class="pn">אל תזכיר באמצע אירוע</span></button>
          <div class="ex">זה לא חריג — הפעולה עדיין נדרשת. אם התזכורת נופלת בתוך
            אירוע, היא לא תצלצל באמצע: תקבל תזכורת הכנה שש שעות לפני שהאירוע
            מתחיל, ותזכורת מעקב שעתיים אחרי שהוא נגמר.</div>
        </div>`;
      };

      const placeBlock = () => `
        <div id="etPlaceB">
          <div class="fgrid">
            <div style="flex:2"><label>מקום</label><select id="etPlace">${placeOpts}</select></div>
            <div><label>+ דקות</label>
              <input type="number" id="etDelay" value="${d ? d.delay : (r.delayMin||0)}"
                     min="0" max="600" inputmode="numeric"></div>
          </div>
          <div class="ex">קבל התראה כשאתה מגיע למקום.
            למשל "להזכיר לי לקחת ציוד כשאני מגיע לבסיס".
            ${Native.on ? 'עובד גם כשהאפליקציה סגורה, אבל לא בשנייה המדויקת — אנדרואיד בודק כל כמה דקות.'
                        : 'בדפדפן זה עובד רק כשהאפליקציה פתוחה.'}</div>
        </div>`;

      const tripBlock = () => `
        <div id="etTripB">
          <label>ק״מ רצוף</label>
          <input type="number" id="etKm" value="${esc(d ? d.km : (r.type==='trip'?r.km:''))}"
                 min="1" max="500" inputmode="decimal" placeholder="למשל 100">
          <div class="ex">קבל התראה אחרי שנסעת מרחק מסוים ברצף.
            למשל "להזכיר לי לעצור אחרי 100 ק״מ". עובד רק כשהאפליקציה פתוחה.</div>
        </div>`;

      /* התוכן בעורך. מציג רק מה שקיים: צ׳קליסט שנוצר, תת-משימות שיש,
         הרגלים שיש. יצירה של חדשים עוברת דרך זרימת ההוספה. */
      const contentBlock = () => {
        /* משימת צ׳קליסט: רשימה אחת ואין מה להוסיף מלבד פריטים */
        if (kind === 'check'){
          const lists = pendLists;
          if (!lists.length)
            pendLists.push({ id:'p'+Date.now().toString(36), name:'פריטים', items:[] });
          const c = lists[0];
          if (!c) return `<div id="etContent"></div>`;
          return `<div id="etContent"><div class="esec" data-clsec="${c.id}">
            <div class="esechead"><span>פריטים</span>
              <button class="secact" data-etcl="${c.id}">+ פריט</button></div>
            <div class="clbox" data-clbox="${c.id}">${itemRows(c)}</div></div></div>`;
        }
        const lists = pendLists;
        const subs  = childRows('subs');
        const habs  = childRows('habs');
        const hasSubs = isNew ? pending.some(c => !c.repeat) : Store.subtasksOf(t.id).length;
        const hasHabs = isNew ? pending.some(c => !!c.repeat) : Store.habitsOf(t.id).length;
        let inner = '';
        lists.forEach(c => {
          const rep = c.repeat && (c.repeat.days||[]).length;
          const sub = rep ? 'חוזר · ' + UI.repeatLabel({ days:c.repeat.days }) + ' ' + c.repeat.time
                    : (c.once && c.once.time) ? 'תזכורת · ' + Plan.label(c.once.date) + ' ' + c.once.time
                    : '';
          inner += `<div class="esec" data-clsec="${c.id}">
            <div class="esechead"><span>${esc(c.name)}</span>
              <button class="secact" data-clcfg="${c.id}">הגדרות</button>
              <button class="secact" data-clremove="${c.id}">הסר צ׳קליסט</button>
              <button class="secact" data-etcl="${c.id}">+ פריט</button></div>
            ${sub ? `<div class="ex" style="margin:-2px 0 6px">${esc(sub)}</div>` : ''}
            <div class="clbox" data-clbox="${c.id}">${itemRows(c)}</div></div>`;
        });
        if (hasSubs) inner += `<div class="esec">
            <div class="esechead"><span>תת-משימות</span>
              <button class="secact" id="etAddKid">+ תת-משימה</button></div>
            <div id="etKids">${subs}</div></div>`;
        /* המקטע נשאר כתצוגה של תת-משימות חוזרות. אין בו כפתור יצירה:
           הרגל נוצר כתת-משימה שההתראה שלה "חוזרת". */
        if (hasHabs) inner += `<div class="esec">
            <div class="esechead"><span>חוזרות</span></div>
            <div id="etHabs">${habs}</div></div>`;
        /* הוספת תוכן היא פעולה אחת שקטה, לא שלושה מקטעים ריקים.
           היכולת נשמרת גם ביצירה, לפני השמירה הראשונה.
           "+ הרגל" ירד: תת-משימה שחוזרת היא ההרגל. */
        /* במיכל, הוספת תוכן היא הפעולה המרכזית — ולכן היא גדולה. */
        inner += `<div class="esec addrow${kind === 'long' ? ' hero' : ''}">
          <button class="secact" id="etAddKid">+ תת-משימה</button>
          <button class="secact" id="etAddList">+ צ׳קליסט</button>
        </div>`;
        if (kind === 'long') inner += `<div class="ex">רוצה הרגל? הוסף
          <b>תת-משימה</b> ובחר לה התראה <b>חוזרת</b> — זה ההרגל.</div>`;
        return `<div id="etContent">${inner}</div>`;
      };

      /* מוצג רק כשבאמת נבחר אירוע — בדיוק כמו מיקום ונסיעה, שמופיעים
         מתחת לכפתור שלהם ולא כקופסה גדולה שתמיד תופסת מקום. */
      const eventBlock = () => {
        if (isChild) return '';
        const ev = evId ? Store.event(evId) : null;
        /* בלי אירוע — כלום, בדיוק כמו מיקום ונסיעה. ההסבר מופיע אחרי
           הבחירה, ולא כקופסה שתמיד תופסת מקום. */
        if (!ev) return '';
        return `<div id="etEvent">
          <div class="evcur">
            <div class="el">${esc(ev.title)}</div>
            <div class="em">${esc(Plan.longDate(ev.date))}${ev.allDay ? '' : ' · ' + esc(ev.time)} · ${esc(UI.eventCountdown(ev))}</div>
          </div>
          <div style="display:flex;gap:14px;margin-top:6px">
            <button class="secact" id="etEvOpen">פתח אירוע</button>
            <button class="secact" id="etEvOff">נתק</button></div>
        </div>`;
      };

      Modal.open({ title:heading, body:`
        <div style="margin-bottom:14px"><label>${isHabitEditor ? 'איזה הרגל?' : 'מה צריך לעשות?'}</label>
          <input type="text" id="etTitle" value="${esc(d ? d.title : (t ? t.title : (o.title||'')))}"
                 autocomplete="off" placeholder="${isHabitEditor ? 'למשל: לארוז תיק' : 'למשל: לקנות מטען'}"></div>

        ${isChild ? `<div class="belongs">שייך ל־${esc(underName)}</div>
          <div class="ex" style="margin:-6px 0 12px">גם לתת-משימה יש התראה משלה.
            "חד-פעמית" נותנת לה תאריך ושעה; "חוזרת" הופכת אותה להרגל שחוזר
            בימים קבועים.</div>` : ''}

        <div style="margin-bottom:14px"><label>תיאור</label>
          <textarea id="etNote" rows="4" placeholder="פרטים, מה להביא, לינק…"
            style="resize:vertical;min-height:120px;line-height:1.6">${
              esc(d ? d.note : (t ? (t.note||'') : ''))}</textarea></div>

        ${showKind ? `
        <div style="margin-bottom:14px" id="etKindWrap"><label>איזה סוג משימה?</label>
          <div class="kindpick" id="etKind">
            <button data-k="short" aria-selected="${kind==='short'}">
              <span class="kn">קצרת טווח</span>
              <span class="kd">משהו שצריך לעשות ולסיים. למשל "לקנות מטען".</span></button>
            <button data-k="long" aria-selected="${kind==='long'}">
              <span class="kn">ארוכת טווח</span>
              <span class="kd">משהו שנמשך לאורך זמן ויכול להכיל דברים בתוכו. למשל "ציוד לצבא".</span></button>
          </div>
          <div class="ex" id="etKindNote"></div></div>` : ''}

        <!-- צ׳קליסט אינו סוג שלישי לבחור בו מראש: הוא מה שמשימה קצרה
             הופכת להיות. ככה הבחירה נשארת בין שני דברים, וההמרה היא
             פעולה מפורשת עם שם שאומר בדיוק מה היא עושה. -->
        <button class="btn wide" id="etToCheck" hidden style="margin-bottom:14px">
          הפוך משימה קצרה זאת לצ׳קליסט</button>
        <button class="txtbtn" id="etUnCheck" hidden style="margin-bottom:14px">
          חזור למשימה רגילה</button>

        <div id="etCheck" hidden>
          <label>איזה צ׳קליסט</label>
          <div class="seg" id="etCheckMode">
            <button data-cm="once" aria-selected="${checkMode==='once'}">חד-פעמי</button>
            <button data-cm="rep"  aria-selected="${checkMode==='rep'}">רב-פעמי</button>
          </div>
          <div class="ex" id="etCheckEx"></div>
        </div>

        ${showCat ? `
        <div style="margin-bottom:14px"><label>קטגוריה</label>
          <div class="seg cat" id="etCat">
            ${['army','home','free'].map(k =>
              `<button data-k="${k}" aria-selected="${cat===k}">${CAT[k]}</button>`).join('')}
          </div></div>` : ''}

        <div style="margin-bottom:14px" id="etAlert">
          <label id="etAlertLbl">התראה</label>
          <div id="etAlertBody">
            ${alertSeg()}
            <div id="etModeBody" style="margin-top:12px">
              ${onceBlock()}${repeatBlock()}
            </div>
          </div>
        </div>
        <div class="ex" id="etLongNote" hidden>ארוכת טווח היא מיכל: היא לא נושאת
          תאריך, שעה או תזכורת משלה. אפשר לקשר אותה לאירוע שהיא מכינה אליו.</div>

        ${streakBlock()}

        <div id="etMain"></div><div id="etProjectEvent"></div><div id="etRelatedMain"></div>

        <div class="acc" id="etAdvAcc" aria-expanded="false">
          <button class="ah" id="etAdvHead"><span class="an">אפשרויות נוספות</span>
            <span class="as" data-sum="adv">—</span><span class="ar">‹</span></button>
          <div class="ab" id="etAdv">
            ${isChild ? '' : `
            <div class="esec" data-adv="place">
              <div class="esechead"><span>מיקום</span>
                <button class="secact" data-advpick="place">בחר מקום</button></div>
              <div id="etPlaceHost"></div>
            </div>
            <div class="esec" data-adv="trip">
              <div class="esechead"><span>נסיעה</span>
                <button class="secact" data-advpick="trip">לפי מרחק</button></div>
              <div id="etTripHost"></div>
            </div>
            <div class="esec" data-adv="event">
              <div class="esechead"><span>קשור לאירוע</span>
                <button class="secact" id="etEvPick">קשר לאירוע</button></div>
              <div id="etEventHost"></div>
            </div>`}
            <div class="esec" data-adv="img">
              <div class="esechead"><span>תמונה</span></div>
              <div class="ex">תמונה אחת מהגלריה. למשל צילום של רשימת הציוד.</div>
              <div id="etImgBox" style="margin-top:8px">${imgBox()}</div>
              <input type="file" id="etImgFile" accept="image/*" hidden>
            </div>
            <div id="etRelatedMore" class="esec"></div><div id="etAdvContent"></div>
          </div>
        </div>
        <!-- מיכל לא מחזיק אפשרויות מתקדמות, ולכן התמונה שלו יושבת ישר
             במסלול הראשי במקום מאחורי מגירה שאין בה שום דבר אחר. -->
        <div class="esec" id="etImgSolo" hidden>
          <div class="esechead"><span>תמונה</span></div>
          <div id="etImgBox2"></div>
        </div>

        ${(!isNew && t.kind==='short') ? `<details class="esec"><summary>שייכת ל${Store.parentsOf(t).length?' · '+Store.parentsOf(t).map(p=>esc(p.title)).join(' · '):''}</summary>
          <div class="note">אותה משימה יכולה להופיע בכמה פרויקטים. סימון ועריכה מתעדכנים בכולם.</div>
          ${Store.allRoots().filter(p=>p.kind==='long'&&p.id!==t.id).map(p=>`<label class="membership"><input type="checkbox" data-parent="${p.id}" ${Store.belongs(t,p.id)?'checked':''}>${esc(p.title)}</label>`).join('')}
        </details>` : ''}
        ${(!isNew && t.parentId) ? `<button class="txtbtn" id="etIndep"
            style="margin-top:14px">הפוך למשימה עצמאית</button>` : ''}`,
        buttons:[
          ...(isNew ? [{label:'ביטול',act:()=>closeEditor()}]
                    : [{label:'מחק',act:()=>{ Store.delTask(t.id); Modal.shut(); UI.toast('נמחק'); }}]),
          {label: isNew ? 'הוסף' : 'שמור', kind:'p', act:save}]});

      const B = Modal.body;
      const g = x => document.getElementById(x);
      function paintRelated(){
        const rows=relatedIds.map(id=>Store.task(id)).filter(Boolean);
        g('etRelatedMain').innerHTML=rows.length?`<div class="esec"><div class="esechead"><span>מקושרת ל</span><button class="secact" data-rel-manage>נהל קשרים</button></div>${rows.map(x=>`<button class="settings-row" data-rel-open="${x.id}"><span>${esc(x.title)}</span><span>‹</span></button>`).join('')}</div>`:'';
        g('etRelatedMore').innerHTML=rows.length?'':'<button class="txtbtn" data-rel-manage>קשר למשימה אחרת</button>';
        g('etRelatedMore').hidden=rows.length>0;
      }
      B.addEventListener('click',e=>{
        const link=e.target.closest('[data-rel-open]');
        if(link){const draft=snapshot();Modal.shut();taskModal({id:link.dataset.relOpen,back:{id:o.id,draft}});return;}
        if(!e.target.closest('[data-rel-manage]'))return;
        const draft=snapshot(),selected=new Set(relatedIds),available=Store.all.tasks.filter(x=>x.id!==o.id&&x.kind==='short'&&!x.archived&&!x.done);
        Modal.shut();Modal.open({title:'קישור בין משימות',body:'<input id="relationQuery" type="search" placeholder="חיפוש משימה"><div id="relationRows"></div>',buttons:[{label:'ביטול',act:()=>{Modal.shut();taskModal({...o,draft});}},{label:'בחר',kind:'p',act:()=>{draft.relatedIds=[...selected];Modal.shut();taskModal({...o,draft});}}]});
        const box=Modal.body,paint=()=>{const q=box.querySelector('#relationQuery').value.trim();box.querySelector('#relationRows').innerHTML=available.filter(x=>!q||x.title.includes(q)).map(x=>`<label class="membership"><input type="checkbox" data-rel-choice="${x.id}" ${selected.has(x.id)?'checked':''}>${esc(x.title)}</label>`).join('')||'<p class="note">אין משימות מתאימות</p>';};
        box.querySelector('#relationQuery').oninput=paint;box.onchange=e=>{const id=e.target.dataset.relChoice;if(id)e.target.checked?selected.add(id):selected.delete(id);};paint();
      });
      paintRelated();

      /* קישור ליומן הוא חלק מהותי ממשימה קצרת-טווח, לא אפשרות נסתרת —
         ולכן הוא יושב במסלול הראשי ולא תחת "אפשרויות נוספות". */
      if (g('etEventHost')) g('etEventHost').innerHTML = eventBlock();

      function kindNote(){
        if (!g('etKindNote')) return;
        g('etKindNote').textContent = kind === 'long'
          ? 'נשאר על המסך עד שתסגור אותו. הצ׳קליסטים, התת-משימות וההרגלים חיים בתוכו.'
          : kind === 'check'
            ? 'רשימת פריטים לסימון. אפשר לעשות אותה חד-פעמית או שתחזור על עצמה.'
            : '';
      }

      /**
       * אילו אפשרויות מתקדמות רלוונטיות בכלל.
       * מיכל — אף אחת. פריט חוזר (הרגל) — לא מיקום ולא נסיעה, כי תזכורת
       * חוזרת ותזכורת מקום הן שתי תזכורות שונות ולמשימה יש אחת.
       * צ׳קליסט — גם לא, כי הוא רשימת פריטים ולא אירוע במרחב.
       */
      function applyAdv(){
        const isLong  = kind === 'long';
        const isCheck = kind === 'check';
        const noPlace = isLong || isCheck || mode === 'repeat';
        ['place','trip'].forEach(k => {
          const el = B.querySelector(`[data-adv="${k}"]`);
          if (el) el.hidden = noPlace;
        });
        const evs = B.querySelector('[data-adv="event"]');
        if (evs){evs.hidden=false;g(isLong||evId?'etProjectEvent':'etAdv').appendChild(evs);}
        /* למיכל אין אפשרויות מתקדמות בכלל — התמונה עוברת למסלול הראשי,
           והמגירה נעלמת. מגירה שאין בה כלום היא הבטחה שלא מתקיימת. */
        const imgSec = B.querySelector('[data-adv="img"]');
        if (imgSec) imgSec.hidden = isLong;
        const solo = g('etImgSolo');
        if (solo){
          solo.hidden = !isLong;
          const host = g('etImgBox2');
          if (host && isLong && host.innerHTML.trim() === '') host.innerHTML = imgBox();
        }
        /* אם המשתמש כבר בחר מיקום/נסיעה ואז עבר לחוזרת — הבחירה יורדת,
           ולא נשארת שמורה בשקט מאחורי מקטע מוסתר. */
        if (noPlace && (mode === 'place' || mode === 'trip')){
          mode = 'none';
          const ph = g('etPlaceHost'); if (ph) ph.innerHTML = '';
          const th = g('etTripHost');  if (th) th.innerHTML = '';
          B.querySelectorAll('[data-advpick]').forEach(x =>
            x.textContent = x.dataset.advpick === 'place' ? 'בחר מקום' : 'לפי מרחק');
        }
      }

      /**
       * האם כבר נוצר משהו שתלוי בסוג המשימה. אחרי זה אין טעם — ואין
       * דרך נקייה — להציע להחליף סוג: מיכל שיש בו תת-משימה לא יכול
       * להפוך לצ׳קליסט, ולמשימה עם תזכורת נסיעה אין משמעות כמיכל.
       */
      function committed(){
        if (!isNew) return true;               /* בעריכה הבורר מוסתר ממילא */
        if (pending.length) return true;       /* תת-משימות שממתינות */
        if (listsNow().some(c => c.items.length)) return true;
        if (mode === 'place' || mode === 'trip') return true;
        return false;
      }

      /**
       * בורר הסוג נעלם ברגע שההכרעה כבר נפלה: או שהמשימה הפכה לצ׳קליסט,
       * או שכבר נבנה בה משהו שתלוי בסוג. בורר שמציע לשנות דבר שכבר קרה
       * הוא הבטחה שאי אפשר לקיים.
       */
      function syncKindPicker(){
        const done = committed(), isCheck = kind === 'check';
        const toChk = g('etToCheck'), unChk = g('etUnCheck');
        if (toChk) toChk.hidden = !(kind === 'short' && !isChild && !done);
        if (unChk) unChk.hidden = !isCheck;
        /* מסתירים את כל הבלוק, כולל התווית — שאלה בלי תשובות אפשריות
           מבלבלת יותר מכלום. */
        const wrap = g('etKindWrap');
        if (wrap) wrap.hidden = isCheck || done;
      }

      /** מגירה שאין בה כלום היא הבטחה שלא מתקיימת — אז היא לא מוצגת */
      function syncAdvAcc(){
        const acc = g('etAdvAcc'); if (!acc) return;
        const host = g('etAdvContent');
        const any = [...B.querySelectorAll('#etAdv > .esec')].some(x => !x.hidden) ||
                    !!(host && host.children.length);
        acc.hidden = !any;
        if (!any) acc.setAttribute('aria-expanded','false');
      }

      /* ---- מצב ההתראה: מציגים בדיוק אחד, אף פעם לא שניים ---- */
      function applyMode(){
        const show = (id, on) => { const el = g(id); if (el) el.hidden = !on; };
        show('etOnce',   mode === 'once');
        show('etRepeat', mode === 'repeat');
        const host = g('etModeBody'); if (!host) return;
        /* מיקום ונסיעה הן תזכורות בפני עצמן — הן תופסות את אותו שדה */
        let extra = host.querySelector('#etModeExtra');
        if (mode === 'place' || mode === 'trip'){
          if (!extra){ extra = document.createElement('div'); extra.id = 'etModeExtra';
                       host.appendChild(extra); }
          extra.innerHTML = mode === 'place'
            ? `<div class="ex">ההתראה הזאת היא לפי מקום. היא מוגדרת ב"אפשרויות נוספות".</div>`
            : `<div class="ex">ההתראה הזאת היא לפי נסיעה. היא מוגדרת ב"אפשרויות נוספות".</div>`;
        } else if (extra){ extra.remove(); }
        B.querySelectorAll('#etMode button').forEach(x =>
          x.setAttribute('aria-selected', x.dataset.a === mode));
        const box = g('etContent');
        if (box) box.hidden = (mode === 'repeat' && kind !== 'long' && kind !== 'check');
        const wl = g('etWhenLbl');
        if (wl) wl.textContent = 'מתי?';
      }

      /* ---- הצבת המקטעים: ארוכת-טווח מציגה אותם, קצרת-טווח מסתירה ---- */
      function placeContent(){
        const main = g('etMain'), adv = g('etAdvContent');
        if (!main || !adv) return;
        let box = g('etContent');
        if (!box){
          const tmp = document.createElement('div');
          tmp.innerHTML = contentBlock();
          box = tmp.firstElementChild;
        }
        const populated = listsNow().length || pending.length ||
                          (!isNew && (Store.subtasksOf(t.id).length || Store.habitsOf(t.id).length));
        const inline = (kind === 'long') || kind === 'check' || !!populated || isChild;
        (inline ? main : adv).appendChild(box);
        /* פריט חוזר הוא פעולה אטומית: אין בו תוכן מקונן, ולכן גם אין
           מקטע תוכן. היכולת לא נמחקה — היא פשוט לא שייכת כאן. */
        /* הכלל "פריט חוזר הוא אטומי" נכון להרגל — לא לצ׳קליסט חוזר,
           שכל מהותו היא הפריטים שבתוכו. */
        box.hidden = (mode === 'repeat' && kind !== 'long' && kind !== 'check');
        return box;
      }

      function applyKind(){
        /* ארוכת-טווח היא מיכל, נקודה: בלי תאריך, בלי שעה, בלי תזכורת
           ובלי קישור ליומן. כל אלה שייכים למה שיושב בתוכה. שום יכולת
           לא נמחקת מהאפליקציה — היא פשוט לא קיימת ברמת המיכל. */
        const isLong = kind === 'long';
        const isCheck = kind === 'check';
        if (isLong){ mode = 'none'; setDate(''); if (g('etTime')) g('etTime').value = ''; }
        /* משימת צ׳קליסט: הזמן שלה נקבע במצב הצ׳קליסט, לא בבורר ההתראה */
        if (isCheck && mode === 'repeat') mode = 'none';
        const chk = g('etCheck');
        if (chk) chk.hidden = !isCheck;
        const chkEx = g('etCheckEx');
        if (chkEx) chkEx.textContent = checkMode === 'rep'
          ? 'חוזר על עצמו, בדיוק כמו הרגל: ימים קבועים, שעה, דילוג לפי סוג אירוע, ואי-הפרעה באמצע אירוע.'
          : 'רשימה אחת. ברגע שתסמן את כל הפריטים היא עוברת לארכיון.';
        syncKindPicker();
        /* בצ׳קליסט אין שני בוררים שחופפים: "חד-פעמי / רב-פעמי" *הוא*
           בורר ההתראה. חד-פעמי מראה את התזכורת החד-פעמית, רב-פעמי מראה
           את ממשק החזרה. בורר ההתראה עצמו נעלם. */
        const seg = g('etMode');
        if (seg) seg.hidden = isCheck;
        if (isCheck) mode = checkMode === 'rep' ? 'repeat' : 'once';
        const alert = g('etAlert');
        if (alert) alert.hidden = isLong;
        const note = g('etLongNote');
        if (note) note.hidden = !isLong;
        if (g('etOnceEx')) g('etOnceEx').textContent =
          'קורה פעם אחת. למשל "להתקשר למפקד מחר ב-18:00".';
        applyAdv();
        /* בורר הסוג משנה את מבנה התוכן עצמו, ולכן הוא נבנה מחדש */
        const oldBox = g('etContent');
        if (oldBox) oldBox.remove();
        applyMode(); placeContent(); kindNote(); refreshSummaries();
        syncAdvAcc();
      }

      const sum = (id, txt) => { const el = B.querySelector(`[data-sum="${id}"]`);
                                 if (el) el.textContent = txt || '—'; };
      function refreshSummaries(){
        const bits = [];
        const pid = g('etPlace') ? g('etPlace').value : '';
        if (mode === 'place' && pid) bits.push(UI.whereLabel({ placeId:pid, delayMin:+((g('etDelay')||{}).value)||0 }));
        if (mode === 'trip' && g('etKm') && g('etKm').value) bits.push(g('etKm').value + ' ק״מ');
        if (img) bits.push('תמונה');
        if (evId && Store.event(evId)) bits.push('אירוע');
        sum('adv', bits.join(' · '));
      }
      function syncRep(){
        const days = [...B.querySelectorAll('#etDays [aria-selected="true"]')].map(b => +b.dataset.d);
        const times = [...B.querySelectorAll('#etTimes .ht')].map(i => i.value).filter(Boolean).sort();
        rep = (days.length && times.length)
          ? { days, times:[...new Set(times)],
              skipTypes: skipTypes.slice(), skipScope, around }
          : null;
      }
      /* צילום מצב הטופס — כדי לחזור אליו אחרי שיוצרים תת-משימה */
      function snapshot(){
        flushInputs();
        syncRep();
        return { title:g('etTitle').value, note:g('etNote').value, kind, cat, mode, checkMode,
                 rep: rep ? { days:rep.days.slice(), times:rep.times.slice(),
                              skipTypes:skipTypes.slice(), skipScope, around } : null,
                 skipTypes:skipTypes.slice(), skipScope, around,
                 date:(g('etDate')||{}).value || '', time:(g('etTime')||{}).value || '',
                 placeId:g('etPlace') ? g('etPlace').value : '',
                 delay:g('etDelay') ? g('etDelay').value : 0,
                 km:g('etKm') ? g('etKm').value : '',
                 img, evId, relatedIds:relatedIds.slice(),
                 pendLists: clone(pendLists), originalLists:clone(originalLists), beforeCheck:clone(beforeCheck),
                 pending:pending.slice() };
      }
      function openChild(asHabit, existingId){
        const draft = snapshot();
        const back = { id:o.id, draft };
        Modal.shut();
        taskModal({
          id: existingId || null,
          parentId: isNew ? null : t.id,
          pendingUnder: isNew ? (draft.title.trim() || 'המשימה החדשה') : null,
          mission: cat, habit: asHabit, back,
        });
      }

      /* "חד-פעמית" חייבת להיות פעם אחת, ולכן היא חייבת תאריך. במקום
         לדרוש מהמשתמש להבין את זה — כשהוא מקליד שעה בלי תאריך, האפליקציה
         בוחרת בעצמה: היום אם השעה עוד לפנינו, מחר אם היא כבר עברה. */
      B.addEventListener('input', e => {
        if (e.target.id !== 'etTime') return;
        const v = e.target.value;
        if (!v || planned || kind === 'long' || mode !== 'once') return;
        const nowHM = new Date().toTimeString().slice(0,5);
        setDate(v > nowHM ? Plan.today() : Plan.shift(Plan.today(), 1));
        const ex = g('etOnceEx');
        if (ex) ex.textContent = v > nowHM
          ? 'קורה פעם אחת. בחרנו "היום" כי השעה עוד לפנינו — אפשר לשנות.'
          : 'קורה פעם אחת. השעה כבר עברה היום, אז בחרנו "מחר" — אפשר לשנות.';
      });

      B.addEventListener('click', e => {
        const ah = e.target.closest('.ah');
        if (ah){ const a = ah.closest('.acc');
                 a.setAttribute('aria-expanded', a.getAttribute('aria-expanded') !== 'true'); return; }
        const kb = e.target.closest('#etKind button');
        if (kb){ kind = kb.dataset.k;
                 B.querySelectorAll('#etKind button').forEach(x => x.setAttribute('aria-selected', x===kb));
                 applyKind(); return; }
        if (e.target.closest('#etToCheck')){
          beforeCheck = {lists:clone(pendLists), mode, date:planned, rep:clone(rep)};
          kind = 'check';
          checkMode = 'once'; mode = 'once';
          applyKind(); applyMode(); applyAdv(); refreshSummaries();
          const c = listsNow()[0];
          if (c) setTimeout(() => addItemInline(c.id), 30);
          return;
        }
        if (e.target.closest('#etUnCheck')){
          kind = 'short'; mode = beforeCheck ? beforeCheck.mode : 'none';
          pendLists = beforeCheck ? clone(beforeCheck.lists) : [];
          rep = beforeCheck ? clone(beforeCheck.rep) : null;
          setDate(beforeCheck ? beforeCheck.date : planned); beforeCheck = null;
          applyKind(); applyMode(); applyAdv(); refreshSummaries();
          return;
        }
        const cm = e.target.closest('#etCheckMode button');
        if (cm){ checkMode = cm.dataset.cm;
                 B.querySelectorAll('#etCheckMode button').forEach(x =>
                   x.setAttribute('aria-selected', x===cm));
                 mode = checkMode === 'rep' ? 'repeat' : 'once';
                 applyKind(); applyMode(); applyAdv(); refreshSummaries(); return; }
        const cb = e.target.closest('#etCat button');
        if (cb){ cat = cb.dataset.k;
                 B.querySelectorAll('#etCat button').forEach(x => x.setAttribute('aria-selected', x===cb)); return; }
        const mb = e.target.closest('#etMode button');
        if (mb){ mode = mb.dataset.a;
                 if (mode !== 'repeat'){ rep = null;
                   B.querySelectorAll('#etDays button').forEach(x => x.setAttribute('aria-selected','false')); }
                 if (mode !== 'once' && g('etTime')) g('etTime').value = '';
                 applyAdv(); applyMode(); syncAdvAcc(); refreshSummaries(); return; }
        const adv = e.target.closest('[data-advpick]');
        if (adv){
          const which = adv.dataset.advpick;
          if (mode === which){                     /* לחיצה שנייה מכבה */
            mode = 'none';
            const host = g(which === 'place' ? 'etPlaceHost' : 'etTripHost');
            if (host) host.innerHTML = '';
          } else {
            mode = which;
            const host = g(which === 'place' ? 'etPlaceHost' : 'etTripHost');
            if (host) host.innerHTML = which === 'place' ? placeBlock() : tripBlock();
            /* בחירת מקום היא בחירה מפורשת. קודם ה-select היה נראה מלא
               אבל התזכורת לא נשמרה — כלום לא הודיע על זה. */
            if (which === 'place' && g('etPlace') && !g('etPlace').value && tops.length)
              g('etPlace').value = tops[0].id;
          }
          adv.textContent = mode === which ? 'בטל' : (which === 'place' ? 'בחר מקום' : 'לפי מרחק');
          applyMode(); syncKindPicker(); refreshSummaries(); return;
        }
        if (e.target.closest('#etEvLink') || e.target.closest('#etEvPick')){
          /* אפשר לבחור אירוע כבר ביצירה: שומרים טיוטה, בוחרים,
             וחוזרים לעורך עם הבחירה בפנים. */
          const draft = snapshot();
          Modal.shut();
          pickEvent(id => {
            draft.evId = id;
            taskModal({ ...o, draft });
          });
          return;
        }
        if (e.target.closest('#etEvOff')){ evId = ''; repaintEvent(); refreshSummaries(); return; }
        if (e.target.closest('#etEvOpen')){
          const ev = Store.event(evId); if (ev){ Modal.shut(); eventMenu(ev); } return;
        }
        const wb = e.target.closest('#etWhen button');
        if (wb){
          const k = wb.dataset.d;
          if (k === 'pick'){
            DatePick.open(g('etDate').value || Plan.today(), v => { setDate(v); }, { clear:true });
            return;
          }
          setDate(k === 'today' ? Plan.today()
                : k === 'tom' ? Plan.shift(Plan.today(),1) : '');
          return;
        }
        const db = e.target.closest('#etDays button');
        if (db){ db.setAttribute('aria-selected', db.getAttribute('aria-selected') !== 'true');
                 syncRep(); refreshSummaries(); return; }
        const skb = e.target.closest('[data-skt]');
        if (skb){
          const id = skb.dataset.skt;
          skipTypes = skipTypes.includes(id) ? skipTypes.filter(x => x !== id) : skipTypes.concat(id);
          skb.setAttribute('aria-checked', skipTypes.includes(id));
          const wrap = g('etSkipScopeWrap'); if (wrap) wrap.hidden = !skipTypes.length;
          syncRep(); refreshSummaries(); return;
        }
        const scb = e.target.closest('#etSkipScope button');
        if (scb){
          skipScope = scb.dataset.sc;
          B.querySelectorAll('#etSkipScope button').forEach(x =>
            x.setAttribute('aria-selected', x === scb));
          syncRep(); refreshSummaries(); return;
        }
        if (e.target.closest('#etAround')){
          around = !around;
          g('etAround').setAttribute('aria-checked', around);
          syncRep(); refreshSummaries(); return;
        }
        if (e.target.closest('#etAddTime')){
          const inp = document.createElement('input');
          inp.type='time'; inp.className='ht'; inp.value='20:00';
          g('etTimes').insertBefore(inp, g('etAddTime')); syncRep(); refreshSummaries(); return;
        }
        if (e.target.closest('#etImgAdd')){ g('etImgFile').click(); return; }
        if (e.target.closest('#etImgDel')){ img = ''; paintImg(); return; }
        if (e.target.closest('#etAddList')){
          /* במשימה קצרת-טווח, "צ׳קליסט" אינו עוד מקטע בתוכה — הוא הופך
             את המשימה עצמה לצ׳קליסט. ככה אין שתי דרכים לאותו דבר. */
          if (kind === 'short' && !isChild){
            beforeCheck = {lists:clone(pendLists), mode, date:planned, rep:clone(rep)};
            kind = 'check'; checkMode = 'once'; mode = 'once';
            applyKind(); applyMode(); applyAdv(); refreshSummaries();
            const c = listsNow()[0];
            if (c) setTimeout(() => addItemInline(c.id), 30);
            return;
          }
          /* צ׳קליסט בתוך מיכל נשאל אותה שאלה כמו כל צ׳קליסט אחר:
             חד-פעמי או רב-פעמי. קודם הוא נוצר בשקט כחד-פעמי, ואת
             החזרתיות היה צריך לגלות אחר כך בתפריט. */
          const draft = snapshot();
          Modal.shut();
          checklistSetupModal(cfg => {
            /* הפוקוס על שדה הפריט נמסר למודאל החדש דרך o, ולא נעשה
               מכאן — הסגירה הזאת כבר לא שייכת ל-DOM שעל המסך. */
            const nid = 'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
            draft.pendLists.push({id:nid, name:cfg.name, items:[], repeat:cfg.repeat,
              once:cfg.onceTime ? {date:cfg.onceDate || Plan.today(), time:cfg.onceTime} : null});
            taskModal({...o, draft, focusList:nid});
          }, () => taskModal({ ...o, draft }));
          return;
        }
        if (e.target.closest('#etAddKid')){   openChild(false); return; }
        if (e.target.closest('#etAddHabit')){ openChild(true);  return; }
        if (e.target.closest('#etIndep')){
          Store.toIndependent(t.id); Modal.shut(); UI.toast('עומדת בפני עצמה'); return;
        }

        /* ---- פריטי הצ׳קליסטים ---- */
        const findList = cid => listsNow().find(c => c.id === cid);
        const ick = e.target.closest('[data-ick]');
        if (ick){
          const c = findList(ick.dataset.clid); if(!c) return;
          { const x = c.items.find(y => y.id === ick.dataset.ick);
                      if (x) x.checked = !x.checked; }

          repaintLists(); return;
        }
        const imv = e.target.closest('[data-imv]');
        if (imv){
          const [iid, dirS] = imv.dataset.imv.split('|');
          const dir = +dirS, c = findList(imv.dataset.clid); if(!c) return;
          {
            const i = c.items.findIndex(y => y.id === iid), j = i + dir;
            if (j >= 0 && j < c.items.length) c.items.splice(j, 0, c.items.splice(i,1)[0]);
          }
          repaintLists(); return;
        }
        const irm = e.target.closest('[data-irm]');
        if (irm){
          const c = findList(irm.dataset.clid); if(!c) return;
          { const i = c.items.findIndex(y => y.id === irm.dataset.irm);
                      if (i >= 0) c.items.splice(i, 1); }

          repaintLists(); return;
        }
        const ied = e.target.closest('[data-iedit]');
        if (ied){ editItemInline(ied.dataset.clid, ied.dataset.iedit); return; }
        const etcl = e.target.closest('[data-etcl]');
        if (etcl){ addItemInline(etcl.dataset.etcl); return; }
        const removeCl = e.target.closest('[data-clremove]');
        if (removeCl){
          pendLists = pendLists.filter(c => c.id !== removeCl.dataset.clremove);
          applyKind(); return;
        }
        const cfgBtn = e.target.closest('[data-clcfg]');
        if (cfgBtn){
          /* אחרי היצירה אפשר לחזור ולשנות הכול — שם, מצב, שעה וחריגים.
             קודם ההגדרה הייתה חד-פעמית ולא הייתה שום דרך לתקן אותה. */
          const id = cfgBtn.dataset.clcfg;
          const c  = listsNow().find(x => x.id === id); if(!c) return;
          const draft = snapshot();
          Modal.shut();
          checklistSetupModal(cfg => {
            const pc = draft.pendLists.find(x => x.id === id);
            if (pc){
              const nextOnce = cfg.onceTime ? {date:cfg.onceDate || Plan.today(), time:cfg.onceTime} : null;
              if (JSON.stringify(pc.repeat) !== JSON.stringify(cfg.repeat) ||
                  JSON.stringify(pc.once || null) !== JSON.stringify(nextOnce)) pc.rt = {};
              pc.name=cfg.name; pc.repeat=cfg.repeat; pc.once=nextOnce;
            }
            taskModal({ ...o, draft });
          }, () => taskModal({ ...o, draft }),
             { name:c.name, repeat:c.repeat,
               onceDate:(c.once||{}).date || '', onceTime:(c.once||{}).time || '' });
          return;
        }

        const rm = e.target.closest('[data-rm]');
        if (rm){
          const key = rm.dataset.rm;
          if (isNew){ pending.splice(+key, 1); }
          else { Store.delTask(key); }
          repaintKids();
          return;
        }
        const cmv = e.target.closest('[data-cmv]');
        if (cmv){
          const bar = cmv.dataset.cmv, i = bar.lastIndexOf('|');
          if (Store.moveChild(bar.slice(0,i), +bar.slice(i+1))) repaintKids();
          return;
        }
        const op = e.target.closest('[data-open]');
        if (op){
          const key = op.dataset.open;
          if (isNew){
            /* עריכת ילד ממתין: מסירים אותו ופותחים מחדש עם הערכים שלו */
            const c = pending[+key];
            const draft = snapshot();
            draft.pending.splice(+key, 1);
            Modal.shut();
            taskModal({ pendingUnder: draft.title.trim() || 'המשימה החדשה',
                        mission: cat, back:{ id:o.id, draft }, preset:c });
          } else openChild(false, key);
          return;
        }
      });
      /* הוספת פריט לצ׳קליסט מסוים, במקום, בלי לצאת מהעורך.
         שדה הקלט נשאר על המסך ומקבל פריט אחרי פריט. */
      function addItemInline(clId){
        const c = listsNow().find(x => x.id === clId); if(!c) return;
        const box = B.querySelector(`[data-clbox="${clId}"]`); if(!box) return;
        let inp = box.querySelector('.newit');
        if (inp){ inp.focus(); return; }
        const row = document.createElement('div');
        row.className = 'subrow newrow';
        /* כפתור משלו. בלי זה המשתמש לוחץ על "הוסף" הראשי של הטופס,
           והאפליקציה מבינה "הוסף משימה" במקום "הוסף פריט". */
        row.innerHTML = `<input type="text" class="newit" placeholder="שם הפריט…"
          autocomplete="off" style="flex:1">
          <button class="btn additem" type="button">הוסף פריט</button>`;
        box.appendChild(row);
        inp = row.querySelector('.newit');

        const rowsBefore = () => {
          const html = itemRows(c);
          [...box.querySelectorAll(':scope > *')].forEach(el => {
            if (el !== row) el.remove();
          });
          row.insertAdjacentHTML('beforebegin', html);
        };
        const commit = () => {
          const v = inp.value.trim();
          if (!v) return false;
          c.items.push({ id:'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),
                                    title:v, note:'', checked:false });

          inp.value = '';
          rowsBefore();
          syncKindPicker();
          return true;
        };
        const addBtn = row.querySelector('.additem');
        addBtn.addEventListener('mousedown', e => e.preventDefault());
        addBtn.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          commit(); inp.focus();
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter'){ e.preventDefault(); commit(); inp.focus(); }
          if (e.key === 'Escape'){ e.preventDefault(); row.remove(); repaintLists(); }
        });
        inp.addEventListener('blur', () => setTimeout(() => {
          if (document.activeElement === inp) return;
          const added = commit();
          row.remove();
          if (!added) repaintLists();
        }, 120));
        rowsBefore();
        inp.focus();
      }
      /* עריכה מהירה של פריט — שם והערה בלבד, בתוך אותו מסך */
      function editItemInline(clId, itemId){
        flushItemEdit?.();
        const c = listsNow().find(x => x.id === clId); if(!c) return;
        const it = c.items.find(x => x.id === itemId); if (!it) return;
        const row = B.querySelector(`[data-iedit="${itemId}"]`); if (!row) return;
        row.outerHTML = `<div class="sb2" style="flex:1">
          <input type="text" class="ie" data-fld="title" value="${esc(it.title)}"
                 autocomplete="off" style="margin-bottom:6px">
          <input type="text" class="ie" data-fld="note" value="${esc(it.note||'')}"
                 placeholder="הערה" autocomplete="off"></div>`;
        const box = B.querySelector('.ie'); if (box) box.focus();
        const commit = () => {
          const f = [...B.querySelectorAll('.ie')];
          if (!f.length) return;
          const ttl = f[0].value.trim(), note = (f[1] ? f[1].value.trim() : '');
          if (ttl){
            it.title = ttl; it.note = note;
          }
          flushItemEdit = null;
          repaintLists();
        };
        flushItemEdit = commit;
        B.querySelectorAll('.ie').forEach(f => {
          f.addEventListener('keydown', e => {
            if (e.key === 'Enter'){ e.preventDefault(); commit(); }
            if (e.key === 'Escape'){ e.preventDefault(); flushItemEdit=null; repaintLists(); }
          });
          f.addEventListener('blur', () => setTimeout(() => {
            if (!B.contains(document.activeElement) ||
                !document.activeElement.classList.contains('ie')) commit();
          }, 60));
        });
      }
      B.addEventListener('keydown', e => {
      });
      B.addEventListener('change', async e => {
        if (e.target.id === 'etImgFile'){
          const f = e.target.files[0]; e.target.value = '';
          if (!f) return;
          try { img = await UI.shrinkImage(f, 900); paintImg(); }
          catch(x){ UI.toast('לא הצלחתי לקרוא את התמונה'); }
          return;
        }
        syncRep(); refreshSummaries();
      });
      B.addEventListener('input',  refreshSummaries);

      /* ערכי התחלה שלא נכנסים דרך ה-HTML */
      const pre = o.preset || null;
      if (pre){
        g('etTitle').value = pre.title || '';
        g('etNote').value  = pre.note || '';
        kind = pre.kind || 'short';
        B.querySelectorAll('#etKind button').forEach(x =>
          x.setAttribute('aria-selected', x.dataset.k === kind));
        if (pre.planned && g('etDate')) g('etDate').value = pre.planned;
        if (pre.reminder && pre.reminder.type === 'time'){
          mode = 'once'; if (g('etTime')) g('etTime').value = pre.reminder.at; }
        if (pre.reminder && pre.reminder.type === 'trip')  mode = 'trip';
        if (pre.reminder && pre.reminder.type === 'place') mode = 'place';
        if (pre.repeat){
          mode = 'repeat';
          rep = { days:pre.repeat.days.slice(), times:pre.repeat.times.slice() };
        }
        if (pre.img){ img = pre.img; paintImg(); }
      }
      /* המקום/הנסיעה חיים ב"אפשרויות נוספות"; מציירים אותם רק אם הם באמת פעילים */
      const restore = d || (t && !pre ? { placeId:(r.placeId||''), delay:(r.delayMin||0),
                                          km:(r.type==='trip'?r.km:'') } : null);
      if (mode === 'place' || mode === 'trip'){
        const host = g(mode === 'place' ? 'etPlaceHost' : 'etTripHost');
        if (host){
          host.innerHTML = mode === 'place' ? placeBlock() : tripBlock();
          const btn = B.querySelector(`[data-advpick="${mode}"]`);
          if (btn) btn.textContent = 'בטל';
          const acc = g('etAdvAcc'); if (acc) acc.setAttribute('aria-expanded','true');
          if (mode === 'place' && restore && restore.placeId && g('etPlace') &&
              g('etPlace').querySelector(`option[value="${restore.placeId}"]`)){
            g('etPlace').value = restore.placeId;
            if (g('etDelay')) g('etDelay').value = restore.delay || 0;
          }
          if (mode === 'trip' && restore && restore.km && g('etKm')) g('etKm').value = restore.km;
        }
      }
      if (rep){
        B.querySelectorAll('#etDays button').forEach(x =>
          x.setAttribute('aria-selected', rep.days.includes(+x.dataset.d)));
        const wrap = g('etTimes');
        if (wrap){
          wrap.querySelectorAll('.ht').forEach(x => x.remove());
          rep.times.forEach(v => { const i = document.createElement('input');
            i.type='time'; i.className='ht'; i.value=v; wrap.insertBefore(i, g('etAddTime')); });
        }
      }
      applyKind(); syncRep(); refreshSummaries();
      if (isNew && !d) setTimeout(() => g('etTitle')?.focus(), 80);
      /* צ׳קליסט שנוצר עכשיו — פותחים לו מיד את שדה הפריט הראשון */
      if (o.focusList) setTimeout(() => addItemInline(o.focusList), 60);

      /* יצירה יכולה להחזיק פריטים ותת-משימות שקיימים רק בזיכרון.
         סגירה לא תזרוק אותם בשקט — אבל טופס ריק לא מקפיץ שום שאלה. */
      function dirty(){
        if (!isNew) return JSON.stringify(pendLists) !== JSON.stringify(originalLists);
        return !!(g('etTitle').value.trim() || g('etNote').value.trim() ||
                  pendLists.length || pending.length || img);
      }
      function closeEditor(){
        if (!dirty()){ Modal.shut(); if(o.back) taskModal({id:o.back.id,draft:o.back.draft}); return false; }
        const draft = snapshot();
        Modal.shut();
        Modal.open({ title:'לזרוק את הטיוטה?',
          body:`<div class="note">כתבת כאן דברים שעוד לא נשמרו${
            pendLists.length || pending.length
              ? ' — כולל ' + [pendLists.length ? pendLists.length + ' צ׳קליסטים' : '',
                              pending.length ? pending.length + ' תת-משימות' : '']
                             .filter(Boolean).join(' ו-') : ''}.</div>`,
          buttons:[{label:'חזור לעריכה',act:()=>{ Modal.shut(); taskModal({ ...o, draft }); }},
                   {label:'זרוק',kind:'p',act:()=>{ Modal.shut(); if(o.back) taskModal({id:o.back.id,draft:o.back.draft}); }}]});
        return false;
      }
      Modal.closeGuard = () => closeEditor();

      /* ---- בונה אובייקט משימה מהטופס ---- */
      function collect(){
        const title = g('etTitle').value.trim();
        if (!title) return null;
        syncRep();
        const out = { title, note:g('etNote').value.trim(), img: img || null,
                      kind, mission:cat, reminder:null, repeat:null, planned:null };
        out.planned = (g('etDate') || {}).value || null;
        if(!isNew && kind==='short'){
          const ids=[...B.querySelectorAll('[data-parent]:checked')].map(el=>el.dataset.parent);
          const legacy=Store.parentsOf(t).filter(p=>p.kind!=='long').map(p=>p.id);
          out.parentIds=[...new Set([...legacy,...ids])];
          out.parentId=out.parentIds.includes(t.parentId)?t.parentId:out.parentIds[0]||null;
        }

        /* למשימה יש תזכורת אחת. המצב שנבחר הוא זה שנשמר — בלי הכרעה
           נסתרת בין שעה למקום, שקודם השליכה בשקט תזכורת מיקום שנבחרה. */
        if (kind === 'long'){                        /* מיכל: כלום מתוזמן */
          out.planned = null; out.reminder = null; out.repeat = null;
          return out;
        }
        /* משימת צ׳קליסט: החזרתיות יושבת על הצ׳קליסט עצמו, לא על המשימה */
        if (kind === 'check'){
          out.repeat = null;
          out.checkRepeat = (checkMode === 'rep' && rep) ? rep : null;
          if (mode === 'once'){
            const tm = (g('etTime') || {}).value;
            if (tm){
              out.reminder = { type:'time', at:tm };
              if (!out.planned){
                const nowHM = new Date().toTimeString().slice(0,5);
                out.planned = tm > nowHM ? Plan.today() : Plan.shift(Plan.today(), 1);
              }
            }
          } else { out.reminder = null; }
          return out;
        }
        if (mode === 'once'){
          const tm = (g('etTime') || {}).value;
          if (tm){
            out.reminder = { type:'time', at:tm };
            /* רשת ביטחון: שעה בלי תאריך תמיד מקבלת מופע אחד ומדויק,
               גם אם המשתמש הגיע לכאן במסלול שלא עבר דרך שדה השעה. */
            if (!out.planned){
              const nowHM = new Date().toTimeString().slice(0,5);
              out.planned = tm > nowHM ? Plan.today() : Plan.shift(Plan.today(), 1);
            }
          }
        } else if (mode === 'repeat'){
          out.repeat = rep;
        } else if (mode === 'place'){
          const pid = g('etPlace') ? g('etPlace').value : '';
          if (pid) out.reminder = { type:'place', placeId:pid,
                                    delayMin:Math.max(0, +((g('etDelay')||{}).value) || 0) };
        } else if (mode === 'trip'){
          const km = g('etKm') ? parseFloat(g('etKm').value) : NaN;
          if (isFinite(km) && km > 0) out.reminder = { type:'trip', km };
        }
        return out;
      }
      /* שעה שכבר עברה היום לא אמורה לצלצל ברגע השמירה */
      function initialRt(x){
        const rt = {}, day = Plan.today();
        /* גם משימה בלי תאריך יורה היום — לכן הבדיקה חלה גם על planned ריק */
        if (x.reminder && x.reminder.type === 'time' && (!x.planned || x.planned === day)){
          const [hh,mm] = x.reminder.at.split(':').map(Number);
          const target = new Date(); target.setHours(hh,mm,0,0);
          if (Date.now() >= target.getTime()) rt.firedKey = new Date().toDateString() + x.reminder.at;
        }
        if (x.repeat){
          const hm = new Date().toTimeString().slice(0,5);
          const due = x.repeat.days.includes(new Date().getDay()) ? x.repeat.times.filter(y => y <= hm) : [];
          if (due.length) rt.firedKey = day + '@' + due[due.length-1];
        }
        return rt;
      }
      function flushInputs(){
        flushItemEdit?.();
        B.querySelectorAll('.newit').forEach(inp => {
          if (inp.value.trim()) inp.closest('.subrow')?.querySelector('.additem')?.click();
        });
      }
      function save(){
        flushInputs();
        const data = collect();
        if (!data){ UI.toast('צריך שם'); g('etTitle').focus(); return; }
        if(kind==='check' && !pendLists.some(c=>c.items.length)){UI.toast('הוסף לפחות פריט אחד לצ׳קליסט');return;}
        pendLists=pendLists.filter(c=>c.items.length || originalLists.some(old=>old.id===c.id));

        /* ---------- המרה להרגל ----------
           הרגל הוא פעולה חוזרת אחת ואין בו תוכן. אם המשימה שמומרת
           מחזיקה תת-משימות או צ׳קליסטים, האפליקציה מציעה לנקות — אומרת
           בדיוק מה יקרה לכל סוג תוכן, ולא נוגעת בכלום בלי אישור.
           סירוב = שום שינוי, גם לא בשדות האחרים. */
        if (!isNew && t && data.repeat && !Store.isHabit(t)){
          const kids = Store.children(t.id);
          const lists = Store.checklists(t.id);
          if (kids.length || lists.length){
            convertToHabitModal(t, kids, lists, () => commit(data));
            return;
          }
        }
        commit(data);
      }

      /** אישור מפורש לפני שנוגעים בתוכן קיים */
      function convertToHabitModal(t, kids, lists, go){
        const bits = [];
        if (kids.length)  bits.push(`<li>${kids.length} תת-משימות — יעברו לארכיון,
          ואפשר יהיה לשחזר אותן משם.</li>`);
        if (lists.length) bits.push(`<li>${lists.length} צ׳קליסטים — יימחקו מהמשימה.
          מיד אחרי המחיקה תופיע אפשרות ביטול.</li>`);
        Modal.open({ title:'להפוך ל"חוזרת"?', body:`
          <div class="note">פריט חוזר הוא פעולה אחת בפני עצמה, ולכן הוא לא
            יכול להחזיק תוכן בתוכו. כדי להמיר את "${esc(t.title)}" צריך לפנות
            את מה שיושב בה:</div>
          <ul class="ex" style="padding-inline-start:18px;line-height:1.9">${bits.join('')}</ul>
          <div class="ex">אם תבטל — שום דבר לא ישתנה, גם לא שאר השינויים בטופס.</div>`,
          buttons:[{label:'ביטול',act:()=>Modal.shut()},
                   {label:'נקה והמר',kind:'p',act:()=>{
                      /* תת-משימות עוברות לארכיון ולא נמחקות */
                      kids.forEach(k => Store.closeProject(k.id));
                      const gone = [];
                      lists.slice().forEach(c => {
                        const g2 = Store.delChecklist(t.id, c.id);
                        if (g2) gone.push(g2);
                      });
                      go();
                      if (gone.length) UI.undo(gone.length + ' צ׳קליסטים הוסרו',
                        () => gone.forEach(g2 => Store.insertChecklist(t.id, g2.list, g2.at)));
                   }}]});
      }

      function commit(data){ return Store.transaction(() => commitTask(data)); }
      function commitTask(data){

        /* ילד ממתין: לא נכתב ל-Store, רק חוזר להורה */
        if (o.back && !o.parentId && !o.id){
          const draft = o.back.draft;
          data.checklists = pendLists.map(c => ({ ...c, items:c.items.slice() }));
          draft.pending.push(data);
          Modal.shut();
          taskModal({ id:o.back.id, draft });
          return;
        }

        /* משימת צ׳קליסט מחזיקה צ׳קליסט אחד משלה, ועליו יושבת החזרתיות */
        const applyCheck = (id, name) => {
          const c = Store.ownChecklist(id);
          if (!c) return;
          if (c.name !== name && (!c.name || c.name === 'צ׳קליסט')) Store.renameChecklist(id, c.id, name);
          const nextRepeat = data.checkRepeat
            ? { days:data.checkRepeat.days, time:data.checkRepeat.times[0], times:data.checkRepeat.times.slice(),
                skipTypes:data.checkRepeat.skipTypes, skipScope:data.checkRepeat.skipScope,
                around:data.checkRepeat.around }
            : null;
          if(JSON.stringify(Recur.norm(c.repeat)) !== JSON.stringify(Recur.norm(nextRepeat)))
            Store.setChecklistRepeat(id, c.id, nextRepeat);
        };

        if (isNew){
          const created = Store.addTask({ ...data, rt:initialRt(data), parentId:o.parentId||null });
          if (data.kind === 'check'){
            applyCheck(created.id, data.title);
            /* הפריטים שכבר הוקלדו בטופס נכנסים לצ׳קליסט של המשימה */
            const own = Store.ownChecklist(created.id);
            pendLists.forEach(pc => pc.items.forEach(it =>
              Store.addChecklistItem(created.id, own.id, it.title, it.note)));
            pendLists.length = 0;
          }
          /* הצ׳קליסטים הממתינים נשמרים עם שמותיהם ובסדר שנקבע */
          pendLists.forEach(c => {
            const nc = Store.addChecklist(created.id, c.name);
            if (!nc) return;
            c.items.forEach(it => Store.addChecklistItem(created.id, nc.id, it.title, it.note));
            Store.checklistOf(created.id, nc.id).items.forEach((x,i) => {
              x.checked = !!(c.items[i] && c.items[i].checked); });
            /* חזרתיות או תזכורת שנבחרו עוד לפני ששמרנו את המשימה */
            if (c.repeat) Store.setChecklistRepeat(created.id, nc.id, c.repeat);
            else if (c.once) Store.setChecklistOnce(created.id, nc.id, c.once);
          });
          /* ילדים שהמתינו נשמרים עכשיו, בסדר שבו נוצרו */
          pending.forEach((c, i) => {
            const kid = Store.addTask({ ...c, mission:created.mission, rt:initialRt(c),
                                        parentId:created.id, sortIndex:i });
            (c.checklists || []).forEach(cl => {
              const nc = Store.addChecklist(kid.id, cl.name);
              cl.items.forEach(it => Store.addChecklistItem(kid.id, nc.id, it.title, it.note));
              if(cl.repeat) Store.setChecklistRepeat(kid.id,nc.id,cl.repeat);
              else if(cl.once) Store.setChecklistOnce(kid.id,nc.id,cl.once);
            });
          });
          Store.setRelatedTasks(created.id,relatedIds);
          if (evId && Store.event(evId)) Store.linkTask(created.id, evId);
          if (o.parentId){ const p = Store.task(o.parentId); if (p && p.collapsed) Store.toggleCollapse(p.id); }
        } else {
          Store.updateTask(t.id, { ...data, checklists: data.repeat ? [] : clone(pendLists), rt:initialRt(data),
                                   log: data.kind === 'long' ? {} : (t.log||{}) });
          if (data.kind === 'check') applyCheck(t.id, data.title);
          Store.setPlanned(t.id, data.planned);
          Store.setRelatedTasks(t.id,relatedIds);
          if ((t.eventId || '') !== (evId || '')) Store.linkTask(t.id, evId || null);
        }

        /* ההורה חוזר אלינו — אם היינו ילד של עורך פתוח */
        if (o.back){
          Modal.shut();
          taskModal({ id:o.back.id, draft:o.back.draft });
          return;
        }
        Modal.shut();
        Permissions.forTask(data);
        const extra = [];
        const nItems = pendLists.reduce((a,c) => a + c.items.length, 0);
        if (isNew && nItems) extra.push(nItems + ' פריטים');
        if (isNew && pending.length)   extra.push(pending.length + ' תת-משימות');
        UI.toast(isNew ? (extra.length ? 'נוסף עם ' + extra.join(' ו-') : 'נוסף') : 'נשמר');
      }
    }

  return {open(o,dependencies){hooks=dependencies;taskModal(o);}};
})();
