const UI = (() => {
  const $  = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const CAT   = { army:'צבא', home:'בית', free:'אישי' };
  const DAYL  = ['א','ב','ג','ד','ה','ו','ש'];
  /* לוח צבעים לסוגי אירוע — נבחר לעבוד יחד על רקע כהה */
  const PALETTE = ['#7aa2f7','#8bcaa8','#e0b57a','#e0787a','#b48ead','#7fc8d8',
                   '#c3a6e0','#9fbf7a','#dd9a7a','#8fb8d6','#d68fb0','#8a94a6'];

  /* ---- מצב תצוגה ---- */
  let section  = 'today';      /* today | tasks | library */
  let screen   = null;         /* notes | lists | archive | places | settings */
  let tview    = 'day';        /* day | d3 | week | month */
  let filter   = 'all';
  let taskQ    = '';
  let selDate  = Plan.today();
  /* חלון "3 ימים"/"שבוע" מחזיק עוגן משלו. בלי זה כניסה ליום רחוק
     הייתה מזיזה את החלון, והחזרה אליו הראתה טווח אחר לגמרי. */
  let rangeFrom = Plan.today();
  /* תת-משימות שהמשתמש פתח כדי לקרוא את התיאור. מצב תצוגה בלבד. */
  const peeked = new Set();
  /* תיאורים שהמשתמש קיפל בעצמו. ברירת המחדל היא תיאור פתוח. */
  const noteShut = {
    has(id){ return (Store.all.prefs.closedDescriptions || []).includes(id); },
    add(id){ Store.setPref('closedDescriptions', [...new Set([...(Store.all.prefs.closedDescriptions || []), id])]); },
    delete(id){ Store.setPref('closedDescriptions', (Store.all.prefs.closedDescriptions || []).filter(x=>x!==id)); }
  };
  /* מצב "שינוי סדר": פועל על מקטע אחד של משימה אחת בכל רגע.
     מחוץ למצב הזה אין חיצים ואין ידיות — הממשק נשאר נקי. */
  let reorder = null;          /* { taskId, sec } או { root:true, group } */
  /* אילו צ׳קליסטים פתוחים בכרטיס. מצב תצוגה בלבד, לא נשמר בנתונים. */
  const openCl = new Set();
  /* חלוקת מסך המשימות לפי סוג. ברירת המחדל — מחולק. */
  let grouped = true;
  /* מסלול הניווט בתוך "היום" — כדי שכפתור החזרה יחזור צעד אחורה
     (יום → 3 ימים → היום) ולא יקפוץ החוצה מהאפליקציה. */
  const trail = [];
  let calY, calM;
  { const [y,m] = selDate.split('-').map(Number); calY = y; calM = m - 1; }
  let deferred = false, alertItem = null;
  let openList = null, listKind = 'simple', itemMore = false;
  let openNote = null, noteQ = '';
  let addKind = 'search';      /* טופס הוספת מקום */

  const SCREEN_TITLE = { notes:'הערות', lists:'קניות', archive:'ארכיון',
                         places:'מקומות', settings:'הגדרות' };
  const SEC_TITLE    = { today:'היום', tasks:'משימות', library:'ספרייה' };

  const fmtM = m => m < 1000 ? Math.round(m)+' מ׳' : (m/1000).toFixed(1)+' ק״מ';
  const fmtDate = ts => {
    const d = new Date(ts), n = new Date();
    const hm = d.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
    if (d.toDateString() === n.toDateString()) return 'היום ' + hm;
    if (new Date(n-864e5).toDateString() === d.toDateString()) return 'אתמול ' + hm;
    return d.toLocaleDateString('he-IL',{day:'numeric',month:'short'}) + ' ' + hm;
  };
  const longDate = k => {
    const [y,m,d] = k.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'});
  };
  function eventCountdown(ev){const day=Plan.today(),n=Math.round((new Date(ev.date+'T12:00:00')-new Date(day+'T12:00:00'))/864e5);return n===0?'היום':n>0?'בעוד '+n+' ימים':'לפני '+Math.abs(n)+' ימים';}
  const nowHM = () => new Date().toTimeString().slice(0,5);

  /* ---------- מצב האתר: האם בכלל מותר לבקש מיקום? ---------- */
  function originState(){
    const p = location.protocol;
    const opaque = (p==='content:' || p==='file:' || p==='blob:');
    const secure = (window.isSecureContext !== false) && !opaque;
    return { protocol:p, opaque, secure, canGeo: secure && !!navigator.geolocation };
  }
  function originWarn(){
    const st = originState();
    if (st.canGeo || Native.on) return '';
    return `<div class="notice warn"><b>המיקום חסום, וזה לא באפליקציה.</b><br>
      הקובץ נפתח מכתובת ${esc(st.protocol)}// וכרום אוסר גישה למיקום מכתובת כזאת.
      כל השאר עובד רגיל.</div>`;
  }

  const cleanSrc = u => String(u||'').replace(/([?&])t=\d+&?/g,'$1').replace(/[?&]$/,'');
  const bustSrc  = u => { const c = cleanSrc(u);
                          return c + (c.includes('?') ? '&' : '?') + 't=' + Date.now(); };

  /* ====================================================================
     תיאורי משימה — טקסט, לא אייקונים (סעיף 63)
     ==================================================================== */
  function whereLabel(r){
    const p = Store.place(r.placeId);
    if (!p) return 'מקום שנמחק';
    const root = Store.placeRoot(p.id);
    const name = (root && root.id !== p.id) ? root.name + ' · ' + p.name : p.name;
    return name + (r.delayMin > 0 ? ' · אחרי ' + r.delayMin + ' דק׳' : '');
  }
  /** שורת המטא של משימה: מה שצריך לדעת, לא כל מה שידוע (סעיף 12) */
  function taskMeta(t, opts){
    opts = opts || {};
    const out = [];
    if (!opts.noCat) out.push(CAT[t.mission]);
    if (t.kind === 'long') out.push('ארוך טווח');
    const r = t.reminder;
    if (r && r.type === 'time' && !opts.noTime) out.push('עד ' + r.at);
    if (r && r.type === 'place') out.push(whereLabel(r));
    if (r && r.type === 'trip')  out.push('אחרי ' + r.km + ' ק״מ נסיעה');
    if (Store.isHabit(t) && !opts.noRepeat) out.push(repeatLabel(t.repeat));
    if (t.planned && !opts.noPlan && t.planned !== selDate) out.push(Plan.label(t.planned));
    const kids = Store.children(t.id).length;
    if (kids && !opts.noKids) out.push(kids + (kids === 1 ? ' תת-משימה' : ' תת-משימות'));
    return out.filter(Boolean).join(' · ');
  }
  function repeatLabel(rep){
    if (!rep) return '';
    const d = rep.days.slice().sort();
    let days;
    if (d.length === 7) days = 'כל יום';
    else if (d.join() === '0,1,2,3,4,5') days = 'א׳–ו׳';
    else if (d.join() === '0,1,2,3,4') days = 'א׳–ה׳';
    else days = d.map(x => DAYL[x]).join('׳ ') + '׳';
    return days;
  }

  /* ====================================================================
     היום
     ==================================================================== */
  function renderToday(){
    $$('#tvModes button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === tview));
    const box = $('#todayBody');
    if (tview === 'day')   return void (box.innerHTML = dayView(selDate));
    if (tview === 'd3')    return void (box.innerHTML = rangeView(3));
    if (tview === 'week')  return void (box.innerHTML = rangeView(7));
    box.innerHTML = monthView();
  }

  /** מה שקורה עכשיו — מוצג רק אם באמת יש משהו (סעיף 10) */
  function nowBlock(date){
    if (date !== Plan.today()) return '';
    const parts = [];
    const hm = nowHM();

    const ev = Store.events(date).find(e => e.time <= hm &&
      new Date(Cal.endMs(e)).toTimeString().slice(0,5) > hm);
    if (ev){
      const end = new Date(Cal.endMs(ev));
      const eh = String(end.getHours()).padStart(2,'0')+':'+String(end.getMinutes()).padStart(2,'0');
      parts.push(`<div class="row" style="border:0;padding:4px 0">
        <div class="when">${esc(ev.time)}<span class="e">${eh}</span></div>
        <div class="bd"><div class="t">${esc(ev.title)}</div></div></div>`);
    }

    if (Geo.last){
      const at = Store.topPlaces().find(p => Geo.dist(Geo.last, p) <= p.radius);
      if (at){
        const ids = new Set([at.id, ...Store.subPlaces(at.id).map(p => p.id)]);
        const here = Store.all.tasks.filter(t => !t.archived && !t.done && t.reminder &&
          t.reminder.type === 'place' && ids.has(t.reminder.placeId));
        if (here.length){
          const list = here.slice()
            .map(t => ({ t, sub: Store.place(t.reminder.placeId) }))
            .sort((a,b) => Geo.dist(Geo.last, Store.placeCoordinates(a.sub.id)) - Geo.dist(Geo.last, Store.placeCoordinates(b.sub.id)));
          parts.push(`<div style="padding:2px 0">
            <div class="t" style="margin-bottom:8px">אתה ב${esc(at.name)}</div>
            ${list.map(({t,sub}) => `<div class="row" data-id="${t.id}" style="padding:9px 0">
                <button class="cb" data-act="done"></button>
                <div class="bd"><div class="t" style="font-size:14px">${esc(t.title)}</div>
                  ${sub.id !== at.id ? `<div class="m">${esc(sub.name)}</div>` : ''}</div>
              </div>`).join('')}</div>`);
        }
      }
    }
    if (!parts.length) return '';
    return `<div class="nowbox" id="nowBox"><div class="lb">עכשיו</div>${parts.join('')}</div>`;
  }

  /** משימות שהשעה שלהן עברה ועדיין פתוחות. בלי דרמה, בלי הזזה אוטומטית. */
  function overdueBlock(date){
    if (date !== Plan.today()) return '';
    const hm = nowHM();
    const late = Store.plannedFor(date).filter(t =>
      t.reminder && t.reminder.type === 'time' && t.reminder.at < hm);
    if (!late.length) return '';
    return `<h2 class="sh">עבר הזמן</h2>` + late.map(t => `
      <div class="row" data-id="${t.id}">
        <button class="cb" data-act="done"></button>
        <div class="bd"><div class="t">${esc(t.title)}</div>
          <div class="m">היה מתוכנן ל-${esc(t.reminder.at)}</div></div>
        <span class="chev" data-act="open">‹</span>
      </div>`).join('');
  }

  /** ציר זמן אחד — אירועים, משימות והרגלים ביחד (סעיף 10) */
  function dayView(date){
    const isToday = date === Plan.today();
    const hm = nowHM();
    const rows = [];

    const allDay = [];
    Store.events(date).forEach(e => {
      if (e.allDay) allDay.push(e);
      else rows.push({ at:e.time, kind:'event', ref:e });
    });

    Store.plannedFor(date).forEach(t => {
      const at = (t.reminder && t.reminder.type === 'time') ? t.reminder.at : null;
      if (isToday && at && at < hm) return;              /* מוצג ב"עבר הזמן" */
      if (t.eventId && !at && Store.event(t.eventId)) return;  /* מקופל לתוך האירוע */
      rows.push({ at, kind:'task', ref:t });
    });

    Store.habitsFor(date).forEach(t => {
      if (Store.habitFull(t, date)) return;              /* נסגר להיום */
      const next = t.repeat.times.find(x => x >= hm);
      rows.push({ at: isToday ? (next || t.repeat.times[0]) : t.repeat.times[0],
                  kind:'habit', ref:t });
    });

    /* צ׳קליסט חוזר שהמחזור שלו פתוח מופיע כאן בזכות עצמו — גם אם
       המשימה שמחזיקה אותו היא מיכל שלא מתוזמן בכלל. */
    Store.activeChecklists(date).forEach(x => {
      rows.push({ at:x.at, kind:'cl', ref:x });
    });

    const timed   = rows.filter(r => r.at).sort((a,b) => a.at.localeCompare(b.at));
    const notimed = rows.filter(r => !r.at);

    let body = '';
    let drawnNow = false;
    timed.forEach(r => {
      if (isToday && !drawnNow && r.at > hm){
        drawnNow = true;
        body += `<div class="nowline"><span class="lbl">${hm}</span><span class="ln"></span></div>`;
      }
      body += r.kind === 'event' ? eventRow(r.ref)
            : r.kind === 'cl'      ? clTodayRow(r.ref, r.at)
            : taskRow(r.ref, r.at, date);
    });

    let out = originWarn() + nowBlock(date) + overdueBlock(date);
    if (allDay.length){
      out += `<h2 class="sh">כל היום</h2>` + allDay.map(eventRow).join('');
    }
    if (body) out += `<h2 class="sh">${isToday ? 'במהלך היום' : 'לוח הזמנים'}</h2>` + body;
    if (notimed.length){
      out += `<h2 class="sh">ללא שעה</h2>` +
             notimed.map(r => r.kind === 'cl' ? clTodayRow(r.ref, null)
                                              : taskRow(r.ref, null, date)).join('');
    }
    if (!body && !notimed.length && !allDay.length && !nowBlock(date) && !overdueBlock(date)){
      out += emptyToday(date);
    }
    return `<div class="big">${esc(Plan.label(date))}</div>
            <div class="sub">${esc(longDate(date))}</div>` + out + (typeof Reflection!=='undefined'?Reflection.render(date):'');
  }

  function emptyToday(date){
    const nx = Plan.shift(date, 1);
    const n  = Store.events(nx).length + Store.plannedFor(nx).length;
    return `<div class="empty" style="${typeof Reflection!=='undefined'&&Reflection.available(date)?'padding:24px 16px':''}">
      <div class="h">${date === Plan.today() ? 'היום פנוי' : 'היום הזה פנוי'}</div>
      <div class="d">אין שום דבר מתוכנן.</div>
      <button class="btn" data-act="add">+ הוסף משהו</button>
      ${n ? `<div class="m" style="margin-top:22px;color:var(--muted2)">מחר יש ${n} דברים</div>` : ''}
    </div>`;
  }

  /**
   * שורת צ׳קליסט חוזר ב"היום". מציגה את מה שצריך כדי להחליט: שם
   * הצ׳קליסט, המשימה שהוא שייך לה, וכמה כבר סומן. נגיעה פותחת את
   * הצ׳קליסט עצמו — לא את פרטי המשימה שמעליו.
   */
  function clTodayRow(x, at){
    return `<div class="row clday" data-clday="${x.cl.id}" data-clt="${x.task.id}">
      ${at ? `<div class="when">${esc(at)}</div>` : ''}
      <span class="cb" style="border-style:dashed;opacity:.6"></span>
      <div class="bd">
        <div class="t">${esc(x.cl.name)}</div>
        <div class="m">${esc(x.task.title)}</div>
        ${x.total ? `<div class="clprog" style="margin-top:6px">
          <div class="clbar"><i style="width:${Math.round(x.done/x.total*100)}%"></i></div>
          <span>${x.done} מתוך ${x.total}</span></div>` : ''}
      </div>
      <span class="chev">‹</span>
    </div>`;
  }

  function taskRow(t, at, date){
    const hab = Store.isHabit(t);
    const done = hab && Store.habitFull(t, date || Plan.today());
    return `<div class="row" data-id="${t.id}">
      ${at ? `<div class="when">${esc(at)}</div>` : ''}
      ${t.kind === 'long'
        ? '<span class="cb" style="border-style:dotted;border-color:currentColor;opacity:.45"></span>'
        : `<button class="cb${hab?' hab':''}${done?' on':''}" data-act="done">✓</button>`}
      <div class="bd"><div class="t">${esc(t.title)}</div>
        ${(() => { const m = taskMeta(t,{noPlan:true,noKids:true,noTime:!!at});
                   return m ? `<div class="m">${esc(m)}</div>` : ''; })()}
        ${noteBlock(t)}
        ${dayKids(t, date)}
      </div>
      <span class="chev" data-act="open">‹</span>
    </div>`;
  }

  /** תת-המשימות של משימה שנקבעה ליום — משימה ביומן בלי הילדים שלה
      היא רק כותרת, ואי אפשר לעבוד ממנה. פריטי רשימה נכללים גם הם. */
  function dayKids(t, date){
    const day  = date || Plan.today();
    const kids = [...Store.subtasksOf(t.id), ...Store.habitsOf(t.id)]
                   .filter(c => !c.archived);
    const cl   = Store.checklist(t.id).filter(x => !x.checked);
    if (!kids.length && !cl.length) return '';
    const row = c => {
      const hab  = Store.isHabit(c);
      const done = hab && Store.habitFull(c, day);
      return `<div class="dkid" data-kid="${c.id}">
        <button class="cb${hab?' hab':''}${done?' on':''}" data-act="doneKid"
                style="width:16px;height:16px;font-size:9px">✓</button>
        <span class="dkt">${esc(c.title)}</span>
        ${(() => { const m = taskMeta(c, { noCat:true, noKids:true, noPlan:true });
                   return m ? `<span class="dkm">${esc(m)}</span>` : ''; })()}
      </div>`;
    };
    return `<div class="dkids">${kids.map(row).join('')}${
      cl.slice(0,6).map(x => `<div class="dkid clitem"><span class="dot"></span>
        <span class="dkt">${esc(x.title)}</span></div>`).join('')}${
      cl.length > 6 ? `<div class="dkid clitem"><span class="dkm">ועוד ${cl.length-6} פריטים</span></div>` : ''}</div>`;
  }

  /** אירוע. משימות קשורות ללא שעה משלהן מקופלות פנימה (סעיף 13) */
  function eventRow(e){
    const ty  = Cal.type(e);
    const end = new Date(Cal.endMs(e));
    const eh  = String(end.getHours()).padStart(2,'0')+':'+String(end.getMinutes()).padStart(2,'0');
    const linked = Store.tasksForEvent(e.id).filter(t=>t.kind!=='long')
      .filter(t => !(t.reminder && t.reminder.type === 'time'));
    const days = Cal.dayCount(e);
    const list = e.listId ? Store.list(e.listId) : null;
    const meta = [ty.name, days > 1 ? days + ' ימים' : '',
                  list ? 'רשימה · ' + list.items.filter(i=>!i.done).length + ' פריטים' : '',
                  linked.length ? linked.length + ' דברים להכין' : ''].filter(Boolean).join(' · ');
    return `<div class="evrow" data-ev="${e.id}">
      <div class="when">${e.allDay ? 'כל<span class="e">היום</span>'
                                   : esc(e.time) + `<span class="e">${eh}</span>`}</div>
      <span class="bar" style="background:${ty.color}"></span>
      <div class="bd">
        <div class="t">${esc(e.title)}</div>
        <div class="m"><span class="edot" style="background:${ty.color}"></span>${esc(meta)}</div>
        ${e.note ? `<div class="m" style="color:var(--muted)">${esc(e.note)}</div>` : ''}
      </div>
      <span class="chev" data-act="openEv">‹</span>
    </div>`;
  }

  /** 3 ימים / שבוע — סקירה בלבד, לא ציר זמן מלא (סעיפים 14–15) */
  function rangeView(n){
    const days = [];
    for (let i = 0; i < n; i++) days.push(Plan.shift(rangeFrom, i));
    const cap = n === 3 ? 3 : 2;
    const head = `<div class="rangenav">
      <button class="hbtn" data-rng="-${n}" aria-label="אחורה">&#8249;</button>
      <div class="ttl">${esc(Plan.longDate(days[0]))} — ${esc(Plan.longDate(days[n-1]))}</div>
      ${days.includes(Plan.today()) ? '' : `<button class="txtbtn" data-rng="today">היום</button>`}
      <button class="hbtn" data-rng="${n}" aria-label="קדימה">&#8250;</button></div>`;
    return head + days.map(k => {
      const evs = Store.events(k);
      const tsk = Store.plannedFor(k);
      const hab = Store.habitsFor(k).filter(t => !Store.habitFull(t, k));
      const items = [...evs.map(e => e.title + (e.allDay ? ' · כל היום' : '')),
                     ...hab.map(t => t.title), ...tsk.map(t => t.title)];
      const total = items.length;
      return `<div style="margin-bottom:6px">
        <button class="row" data-day="${k}" style="width:100%;text-align:start">
          <div class="bd">
            <div class="t">${esc(Plan.label(k))}${k===Plan.today()?'':''}</div>
            ${total
              ? `<div class="m">${items.slice(0,cap).map(esc).join(' · ')}${
                  total > cap ? ' · ועוד ' + (total-cap) : ''}</div>`
              : `<div class="m">פנוי</div>`}
          </div>
          <span class="chev">‹</span>
        </button></div>`;
    }).join('');
  }

  /** חודש. מספרים ונקודות ליום בודד, ופס רציף לאירוע שנמשך כמה ימים (סעיף 16) */
  function monthView(){
    const todayKey = Plan.today();
    const cells = Cal.monthGrid(calY, calM);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    /* אירוע שתופס יותר מיום אחד, או אירוע של יום שלם — נמתח כפס */
    const spans = Store.all.events.filter(e =>
      e.allDay || (e.endDate && e.endDate !== e.date));

    return `<div class="cal">
      <div class="calnav">
        <button class="hbtn" data-mo="-1" aria-label="חודש קודם">&#8249;</button>
        <div class="ttl">${Cal.MONTHS[calM]} ${calY}</div>
        <button class="hbtn" data-mo="1" aria-label="חודש הבא">&#8250;</button>
      </div>
      <div class="mgrid">${DAYL.map(d => `<div class="wd">${d}</div>`).join('')}</div>
      <div id="mGrid">${weeks.map(w => `
        <div class="mweek">
          <div class="mgrid">${w.map(c => {
            const evs = Store.events(c.key).filter(e => !e.allDay &&
              (!e.endDate || e.endDate === e.date));
            const tsk = Store.plannedFor(c.key).length;
            const pips = evs.slice(0,3).map(e =>
              `<span class="pip" style="background:${Cal.type(e).color}"></span>`).join('')
              + (tsk ? `<span class="pip" style="background:var(--muted2)"></span>` : '');
            return `<button class="day${c.out?' out':''}${c.key===todayKey?' today':''}"
              data-day="${c.key}" aria-selected="${c.key===selDate}">
              <span>${c.date.getDate()}</span><div class="pips">${pips}</div></button>`;
          }).join('')}</div>
          ${weekBars(w, spans)}
        </div>`).join('')}</div>
      </div>
      <div class="rule"></div>
      <div class="t" style="margin-bottom:10px">${esc(longDate(selDate))}</div>
      <div id="mDay">${monthDayList(selDate)}</div>`;
  }

  /**
   * הפסים של שבוע אחד. כל אירוע מקבל מסלול משלו, כדי ששני אירועים
   * חופפים לא ידרסו זה את זה. אירוע שנמשך מעבר לשבוע נחתך בקצה
   * ומאבד את העיגול בצד החתוך — ככה רואים שהוא ממשיך.
   */
  function weekBars(week, spans){
    const first = week[0].key, last = week[6].key;
    const lanes = [];
    spans.forEach(e => {
      const from = e.date, to = e.endDate || e.date;
      if (to < first || from > last) return;
      const s = Math.max(0, week.findIndex(c => c.key === from));
      const eIdx = to > last ? 6 : week.findIndex(c => c.key === to);
      if (eIdx < 0) return;
      const lane = lanes.find(l => l.every(x => x.e < s || x.s > eIdx));
      const item = { s, e:eIdx, ev:e, open: from < first, cont: to > last };
      if (lane) lane.push(item); else lanes.push([item]);
    });
    if (!lanes.length) return '';
    return lanes.slice(0, 3).map(lane => `<div class="mbars">${
      lane.sort((a,b) => a.s - b.s).map(x => {
        const cls = x.open && x.cont ? 'mid' : x.open ? 'tail' : x.cont ? 'head' : '';
        return `<div class="mbar ${cls}" data-ev="${x.ev.id}"
          style="grid-column:${x.s+1}/${x.e+2};background:${Cal.type(x.ev).color}"
          >${x.open ? '' : esc(x.ev.title)}</div>`;
      }).join('')}</div>`).join('');
  }
  function monthDayList(date){
    const all = Store.events(date);
    const evs = all.filter(e => e.allDay).concat(all.filter(e => !e.allDay));
    const tsk = Store.plannedFor(date);
    const hab = Store.habitsFor(date).filter(t => !Store.habitFull(t, date));
    if (!evs.length && !tsk.length && !hab.length)
      return `<div class="dim small" style="padding:6px 0">אין כלום ביום הזה.</div>`;
    return evs.map(eventRow).join('') +
           [...hab, ...tsk].map(t => taskRow(t, null, date)).join('');
  }

  /* ====================================================================
     משימות
     ==================================================================== */
  /* אזור אחד לכל סוג. משימה ראשית מופיעה באזור אחד בלבד. */
  const AREAS = [
    { key:'long',  name:'ארוכות טווח', test:t => t.kind === 'long' },
    { key:'check', name:'צ׳קליסטים',   test:t => t.kind === 'check' },
    { key:'habit', name:'הרגלים',      test:t => t.kind !== 'long' && t.kind !== 'check' && Store.isHabit(t) },
    { key:'short', name:'קצרות טווח',  test:t => t.kind !== 'long' && t.kind !== 'check' && !Store.isHabit(t) },
  ];
  const areaOf = t => (AREAS.find(a => a.test(t)) || AREAS[3]).key;

  function renderTasks(){
    $$('#tFilters button').forEach(b => b.setAttribute('aria-selected', b.dataset.f === filter));
    const box = $('#tasksBody');
    const q = taskQ.trim().toLowerCase();

    if (q){
      const hits = Store.active(filter).filter(t =>
        t.title.toLowerCase().includes(q) || (t.note||'').toLowerCase().includes(q));
      box.innerHTML = hits.length
        ? `<h2 class="sh">${hits.length} תוצאות</h2>` + hits.map(t => `
            <div class="row" data-id="${t.id}">
              <div class="bd"><div class="t">${esc(t.title)}</div>
                <div class="m">${esc(path(t) || taskMeta(t))}</div></div>
              <span class="chev" data-act="open">‹</span>
            </div>`).join('')
        : `<div class="empty"><div class="h">לא נמצא</div>
             <div class="d">אין משימה שמתאימה ל"${esc(taskQ)}".</div></div>`;
      return;
    }

    /* הסדר הגלובלי הוא מקור האמת. הסינון והחלוקה רק בוחרים ממנו. */
    const roots = Store.allRoots().filter(t => filter === 'all' || t.mission === filter);
    if (!roots.length){ box.innerHTML = emptyTasks(); return; }

    const ord = reorder && reorder.root ? reorder : null;
    /* פעולת סידור קיימת רק כשיש באמת שני פריטים להחליף ביניהם */
    const orderBtn = (group, n) => (n < 2 || (ord && ord.group !== group)) ? '' :
      (ord && ord.group === group
        ? `<button class="secact" data-act="rootOrderOff">סיום</button>`
        : `<button class="secact" data-act="rootOrderOn" data-group="${group}">שנה סדר</button>`);

    /* חלוקה לפי סוג היא ברירת המחדל בכל מקום. רק ב"הכל" יש טעם לכבות
       אותה, כי שם הרשימה מערבבת קטגוריות וסדר גלובלי אחד הוא מה שמעניין. */
    const canFlatten = filter === 'all';
    const groupedNow = canFlatten ? grouped : true;
    let out = '';
    if (!groupedNow){
      out += `<div class="sechead"><span class="secname">כל המשימות</span>
        ${orderBtn('flat', roots.length)}
        ${ord ? '' : `<button class="secact" data-act="groupOn">חלוקה לפי סוג</button>`}</div>`;
      out += roots.map((t,i) => card(t, false,
        ord && ord.group === 'flat' ? { i, n:roots.length } : null)).join('');
    } else {
      const shown = AREAS.map(a => ({ a, list: roots.filter(a.test) })).filter(x => x.list.length);
      shown.forEach(({ a, list }, k) => {
        out += `<div class="sechead"${k ? ' style="margin-top:22px"' : ''}>
          <span class="secname">${a.name}</span>
          ${orderBtn(a.key, list.length)}
          ${(k === 0 && !ord && canFlatten) ? `<button class="secact" data-act="groupOff">בטל חלוקה</button>` : ''}
        </div>`;
        out += list.map((t,i) => card(t, false,
          ord && ord.group === a.key ? { i, n:list.length } : null)).join('');
      });
    }
    box.innerHTML = out;
  }

  function path(t){
    if(Store.parentsOf(t).length>1)return Store.parentsOf(t).map(p=>p.title).join(' · ');
    const names = []; let p = t.parentId ? Store.task(t.parentId) : null, g = 0;
    while (p && g++ < 8){ names.unshift(p.title); p = p.parentId ? Store.task(p.parentId) : null; }
    return names.join(' › ');
  }

  function emptyTasks(){
    return `<div class="empty">
      <div class="h">אין משימות פתוחות</div>
      <div class="d">כל מה שסיימת נשאר זמין בארכיון.</div>
      <button class="btn" data-act="add">+ משימה חדשה</button></div>`;
  }

  /** תווית מקטע — מופיעה רק כשיש יותר ממקטע אחד, אחרת היא רעש */
  function secLbl(name, on, many){ return (on && many) ? `<div class="seclbl">${name}</div>` : ''; }

  /** שורת פריט ברשימה. שם וסימון — ותו לא. */
  function clRow(ownerId, x, ord, i, n){
    if (ord) return `<div class="clrow ordering" data-cl="${x.id}" data-clp="${ownerId}">
      <span class="ct"><span>${esc(x.title)}</span></span>
      <span class="ord">
        <button data-act="clup" ${i===0?'disabled':''} aria-label="הזז למעלה">↑</button>
        <button data-act="cldown" ${i===n-1?'disabled':''} aria-label="הזז למטה">↓</button>
      </span></div>`;
    return `<div class="clrow${x.checked ? ' ck' : ''}" data-cl="${x.id}" data-clp="${ownerId}">
      <button class="cb${x.checked ? ' on' : ''}" data-act="ckl"
              style="width:18px;height:18px;font-size:10px;flex:0 0 auto">✓</button>
      <button class="ct" data-act="ckopen"><span>${esc(x.title)}</span>
        ${x.note ? `<span class="cn">${esc(x.note)}</span>` : ''}</button>
    </div>`;
  }

  /** שלושת המקטעים שמתחת למשימה — רשימה, תת-משימות, הרגלים. לעולם לא עץ אחד מעורבב. */
  /** תיאור מקופל/פתוח — נשלט מה-UI בלבד */
  function noteBlock(t){
    if (!t.note && !t.img) return '';
    const shut = noteShut.has(t.id);
    return `<div class="tnotewrap">
      <button class="notetog" data-act="notetog" data-nid="${t.id}"
        aria-expanded="${!shut}">${shut ? '‹ הצג תיאור' : '⌄ הסתר תיאור'}</button>
      ${shut ? '' : (t.note ? `<div class="tnote copy-note" role="button" tabindex="0" data-copy-note-id="${t.id}" title="לחץ להעתקת התיאור">${esc(t.note)}</div>` : '')
              + (t.img ? `<img class="tnimg" src="${t.img}" alt="" data-act="zoom">` : '')}
    </div>`;
  }

  /** האירוע שהמשימה קשורה אליו — יחס גלוי, לא פריט בתפריט */
  function linkedEventLine(t){
    const ev = t.eventId ? Store.event(t.eventId) : null;
    if (!ev) return '';
    const ty = Cal.type(ev);
    return `<button class="evlink" data-act="openEv" data-ev="${ev.id}">
      <span class="edot" style="background:${ty.color}"></span>
      <span class="el">${esc(ev.title)}</span>
      <span class="em">${esc(Plan.label(ev.date))}${ev.allDay ? '' : ' · ' + esc(ev.time)}</span>
    </button>`;
  }

  /** אילו סוגי תוכן קיימים במשימה — בשמות, בלי מונים.
      תת-משימות והרגלים כבר מופיעים בשורות שמתחת לכרטיס, ולכן אין טעם
      לחזור עליהם כאן. נשארים רק הצ׳קליסטים, שהתוכן שלהם חי בפרטים. */
  function contentBits(id){
    const t = Store.task(id);
    /* במשימת צ׳קליסט הרשימה נושאת את שם המשימה — אין טעם לחזור עליו */
    if (t && t.kind === 'check') return [];
    return Store.checklists(id).map(c => c.name);
  }

  /**
   * כרטיס משימה — קומפקטי בכוונה. המסך הזה נועד למצוא, לנווט ולסדר;
   * השימוש בתוכן קורה בפרטי המשימה. נגיעה פותחת פרטים, לא טופס.
   */
  function card(t, gap, ord){
    const hab  = Store.isHabit(t);
    const doneToday = hab && Store.habitFull(t, Plan.today());
    const meta = taskMeta(t, { noKids:true });
    const bits = contentBits(t.id);
    if (ord) return `<div class="tcard ${t.mission}${t.kind==='long'?' long':''} ordering"
      data-id="${t.id}">
      <div class="thead">
        <div class="bd"><div class="ttl">${esc(t.title)}</div></div>
        <span class="ord">
          <button data-act="rootup" ${ord.i===0?'disabled':''} aria-label="הזז למעלה">↑</button>
          <button data-act="rootdown" ${ord.i===ord.n-1?'disabled':''} aria-label="הזז למטה">↓</button>
        </span>
      </div></div>`;
    return `<div class="tcard ${t.mission}${t.kind==='long'?' long':''}${
      gap ? ' gap' : ''}" data-id="${t.id}">
      <div class="thead">
        ${t.kind === 'long'
          ? '<span class="cb" style="border-style:dotted;border-color:currentColor;opacity:.45"></span>'
          : `<button class="cb${hab?' hab':''}${doneToday?' on':''}" data-act="done">✓</button>`}
        <button class="bd" data-act="detail">
          <div class="ttl">${esc(t.title)}</div>
          <div class="tmeta">${esc(meta || CAT[t.mission])}</div>
          ${bits.length ? `<div class="tbits">${bits.map(esc).join(' · ')}</div>` : ''}
        </button>
        <button class="hbtn" data-act="menu" style="width:28px;height:28px;font-size:15px">⋯</button>
      </div>
      ${noteBlock(t)}
      ${subLines(t)}
      ${clLines(t)}
      ${linkedEventLine(t)}
    </div>`;
  }

  /**
   * צ׳קליסטים בתוך הכרטיס. אפשר לפתוח אותם במקום ולסמן פריטים בלי
   * להיכנס לפרטי המשימה בכלל — זה הרי כל העניין בצ׳קליסט: לפתוח,
   * לסמן, להמשיך.
   */
  function clLines(t){
    const lists = Store.checklists(t.id);
    if (!lists.length) return '';
    return `<div class="tcls">${lists.map(c => {
      const open = openCl.has(c.id);
      const done = c.items.filter(x => x.checked).length;
      const rep  = c.repeat;
      /* במשימת צ׳קליסט השם כבר מופיע ככותרת הכרטיס */
      const own  = Store.isOwnList(t, c);
      return `<div class="tcl${open ? ' open' : ''}" data-cl="${c.id}">
        <button class="tclhead" data-act="clToggle" data-clid="${c.id}"
                aria-expanded="${open}">
          <span class="ar">‹</span>
          <span class="nm">${own ? (open ? 'סגור' : 'הצג פריטים') : esc(c.name)}</span>
          ${rep ? `<span class="rp">חוזר</span>` : ''}
          <span class="pg">${c.items.length ? done + '/' + c.items.length : 'ריק'}</span>
        </button>
        ${open ? `<div class="tclbody">
          ${c.items.map(x => `
            <div class="clrow${x.checked ? ' ck' : ''}" data-cli="${x.id}" data-clid="${c.id}">
              <button class="cb${x.checked ? ' on' : ''}" data-act="clTick"
                      data-clid="${c.id}" data-iid="${x.id}"
                      style="width:18px;height:18px;font-size:10px;flex:0 0 auto">✓</button>
              <span class="ct"><span>${esc(x.title)}</span></span>
            </div>`).join('')
            || `<div class="secempty">הצ׳קליסט ריק.</div>`}
          <button class="tclopen" data-act="clOpen" data-clid="${c.id}">פתח את הצ׳קליסט</button>
        </div>` : ''}
      </div>`; }).join('')}</div>`;
  }

  /**
   * תת-משימות בתוך הכרטיס. המבנה של משימה צריך להיות מובן בלי לפתוח
   * אותה — קודם היה כתוב "תת-משימות" בלי לומר אילו. השורות קומפקטיות
   * בכוונה: אפשר לסמן ולפתוח, אבל לא לערוך, כדי שהמסך יישאר מסך ניווט.
   */
  function subLines(t){
    const kids = [...Store.subtasksOf(t.id), ...Store.habitsOf(t.id)];
    if (!kids.length) return '';
    const SHOW = 4;
    const expanded=!!Store.all.prefs.expandedChildren?.[t.id];
    const shown = expanded ? kids : kids.slice(0, SHOW);
    const rest  = kids.length - shown.length;
    return `<div class="tsubs">${shown.map(c => {
      const hab = Store.isHabit(c);
      const done = hab ? Store.habitFull(c, Plan.today()) : !!c.archived;
      const m = taskMeta(c, { noCat:true, noKids:true });
      return `<div class="tsub" data-sub="${c.id}">
        <button class="cb${hab?' hab':''}${done?' on':''}" data-act="subdone" data-sid="${c.id}"
                style="width:16px;height:16px;font-size:9px;flex:0 0 auto">✓</button>
        <button class="st2" data-act="subopen" data-sid="${c.id}">
          <span class="sn">${esc(c.title)}</span>
          ${m ? `<span class="sm">${esc(m)}</span>` : ''}</button>
      ${Store.parentsOf(c).filter(p=>p.id!==t.id).length?`<span class="shared-with">משותפת עם: ${Store.parentsOf(c).filter(p=>p.id!==t.id).map(p=>esc(p.title)).join(' · ')}</span>`:''}
      ${noteBlock(c)}
      </div>`; }).join('')}
      ${expanded ? '<button class="tsubmore" data-act="childrenToggle" aria-expanded="true">צמצם תתי־משימות</button>' : ''}
      ${rest > 0 ? `<button class="tsubmore" data-act="childrenToggle" aria-expanded="false">ועוד ${rest} תתי־משימות</button>` : ''}
    </div>`;
  }

  /* ====================================================================
     ספרייה
     ==================================================================== */
  function renderLibrary(){
    $('#libNotes').textContent = Store.notes().length
      ? Store.notes().length + ' הערות' : 'אין עדיין';
    const items = Store.openItems().length;
    $('#libLists').textContent = Store.all.lists.length
      ? Store.all.lists.length + ' רשימות · ' + items + ' פריטים פתוחים' : 'אין עדיין';

    const links = Store.links();
    $('#libLinks').innerHTML = links.length
      ? links.map(l => `
        <div class="row" data-link="${l.id}">
          <button class="bd" data-act="openLink" style="text-align:start">
            <div class="t">${esc(l.name)}</div>
            <div class="m" dir="ltr" style="unicode-bidi:isolate">${esc(Store.hostOf(l.url))}</div>
          </button>
          <button class="hbtn sm" data-act="linkMenu" aria-label="עוד">⋯</button>
        </div>`).join('')
      : `<div class="ex" style="padding:4px 2px 10px">שמור כאן אתרים שאתה פותח הרבה —
           לחיצה אחת ואתה שם.</div>`;
  }

  /* ====================================================================
     ארכיון
     ==================================================================== */
  function renderArchive(){
    const list = Store.archived();
    const box = $('#archiveBody');
    if (!list.length){
      box.innerHTML = `<div class="empty"><div class="h">הארכיון ריק</div>
        <div class="d">כל משימה שתסיים תישמר כאן ותמיד אפשר יהיה להחזיר אותה.</div></div>`;
      return;
    }
    box.innerHTML = `<div class="sub">${list.length} פריטים. שום דבר לא נמחק לבד.</div>` +
      list.map(t => {
        const kids = Store.descendants(t.id).length;
        return `<div class="arow" data-id="${t.id}">
          <div class="ab2">
            <div class="at">${esc(t.title)}</div>
            <div class="am">${CAT[t.mission]}${t.kind==='long'?' · ארוך טווח':''}${
              kids ? ' · ' + kids + ' תת-משימות' : ''}${
              t.archivedAt ? ' · ' + esc(fmtDate(t.archivedAt)) : ''}</div>
          </div>
          <button class="link" data-act="restore">החזר</button>
        </div>`;
      }).join('');
  }

  /* ====================================================================
     קניות
     ==================================================================== */
  const KIND = {
    simple : { label:'רגילה',  note:'פריטים, חנות, קישור ותמונה.' },
    errand : { label:'שליחות', note:'בשביל מישהו אחר. בסוף סוגרים חשבון ונשלחת הודעה עם הפירוט והסכום.' },
    wish   : { label:'משאלות', note:'דברים שאתה רוצה לקנות, כולל כאלה שעוד לא יצאו.' },
  };
  const isOut = it => !it.releaseDate || it.releaseDate <= Plan.today();

  function renderLists(){
    if (openList) return renderListDetail();
    const ls = Store.all.lists, box = $('#listsBody');
    if (!ls.length){
      box.innerHTML = `<div class="empty"><div class="h">אין רשימות כרגע</div>
        <div class="d">רשימה רגילה, שליחות בשביל מישהו, או רשימת משאלות.</div>
        <button class="btn" data-act="add">+ רשימה חדשה</button></div>`;
      return;
    }
    box.innerHTML = routeBlock() + ls.map(l => {
      const left = l.items.filter(i => !i.done).length;
      const k = KIND[l.kind] || KIND.simple;
      const extra = l.kind === 'errand' && l.forWho ? ' · בשביל ' + esc(l.forWho)
                  : l.kind === 'wish'
                    ? ' · ' + l.items.filter(i => i.releaseDate && !isOut(i)).length + ' עוד לא יצאו'
                    : '';
      return `<button class="lrow" data-list="${l.id}" style="width:100%;text-align:start">
        <div class="lb"><div class="ln2">${esc(l.name)}</div>
          <div class="lm">${k.label} · ${left} פתוחים מתוך ${l.items.length}${extra}</div></div>
        <span class="chev">‹</span></button>`;
    }).join('');
  }

  /** מסלול מומלץ בין החנויות */
  function routeBlock(){
    const names = [...new Set(Store.openItems().map(i => i.where).filter(Boolean))];
    const pts = Store.all.places.filter(p => names.includes(p.name));
    if (names.length >= 2 && pts.length < 2){
      const missing = names.filter(n => !Store.placeByName(n));
      return `<div class="notice">רוצה <b>מסלול מומלץ</b> בין החנויות? שמור אותן כמקומות
        (תפריט ⋯ ← מקומות), באותו שם בדיוק.
        ${missing.length ? '<br>עוד לא שמורות: ' + missing.slice(0,4).map(esc).join(' · ') : ''}</div>`;
    }
    if (!Geo.last || pts.length < 2) return '';
    const { stops, total } = Geo.route(Geo.last, pts);
    const mins = Math.round(total/1000/25*60) + stops.length*8;
    return `<h2 class="sh">מסלול מומלץ · ${(total/1000).toFixed(1)} ק״מ · כ-${mins} דק׳</h2>
      <div class="stops">${stops.map((st,i) => `<div class="stop">
        <span class="num">${i+1}</span><span class="sn">${esc(st.name)}</span>
        <span class="sd2">${fmtM(st.leg)}</span>
        <a class="link" href="https://waze.com/ul?ll=${(Store.placeCoordinates(st.id)||st).lat},${(Store.placeCoordinates(st.id)||st).lng}&navigate=yes"
           target="_blank" rel="noopener">ניווט</a></div>`).join('')}</div>
      <div class="rule"></div>`;
  }

  function renderListDetail(){
    const l = Store.list(openList);
    if (!l){ openList = null; return renderLists(); }
    const k = KIND[l.kind] || KIND.simple;

    const item = it => {
      const rel = l.kind === 'wish' && it.releaseDate
        ? (isOut(it) ? 'יצא' : 'יוצא ' + it.releaseDate) : '';
      const meta = [ it.where, it.price != null ? it.price + ' ₪' : '', rel ]
                   .filter(Boolean).join(' · ');
      return `<div class="irow ${it.done ? 'done' : ''}" data-id="${it.id}">
        <button class="cb${it.done?' on':''}" data-act="tItem">✓</button>
        ${it.img ? `<img src="${it.img}" alt="">` : ''}
        <div class="ib">
          <div class="it">${esc(it.title)}</div>
          ${meta ? `<div class="im">${esc(meta)}</div>` : ''}
          ${it.link ? `<a class="im" href="${esc(it.link)}" target="_blank" rel="noopener"
                          style="color:var(--accent)">${esc(it.link.slice(0,52))}</a>` : ''}
          ${l.kind === 'wish' ? `<button class="im" data-act="check"
                                   style="color:var(--accent)">בדוק תאריך יציאה</button>` : ''}
        </div>
        <button class="hbtn" data-act="editItem" style="width:26px;height:26px;font-size:14px">⋯</button>
      </div>`;
    };

    const open = l.items.filter(i => !i.done), done = l.items.filter(i => i.done);
    let body = '';
    if (l.kind === 'wish'){
      const soon = open.filter(i => !isOut(i)), have = open.filter(i => isOut(i));
      body = (have.length ? `<h2 class="sh">אפשר לקנות</h2>` + have.map(item).join('') : '')
           + (soon.length ? `<h2 class="sh">עוד לא יצאו</h2>` + soon.map(item).join('') : '');
    } else {
      body = open.length ? open.map(item).join('')
        : `<div class="empty"><div class="h">אין פריטים פתוחים</div></div>`;
    }
    if (done.length) body += `<h2 class="sh">נקנה (${done.length})</h2>` + done.map(item).join('');

    $('#listsBody').innerHTML = `
      <div class="row" style="border:0;padding:0 0 10px;align-items:center">
        <button class="hbtn" id="lBack">›</button>
        <div class="bd"><div class="t">${esc(l.name)}</div>
          <div class="m">${k.label}${l.kind === 'errand' && l.forWho ? ' · בשביל ' + esc(l.forWho) : ''}</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input type="text" id="iTitle" placeholder="${l.kind === 'wish' ? 'מה אתה רוצה?' : 'מה צריך?'}" autocomplete="off">
        <button class="btn p" id="iAdd" style="flex:0 0 auto">הוסף</button>
      </div>
      ${l.kind === 'wish'
        ? `<div style="margin-bottom:6px"><label>תאריך יציאה (אם ידוע)</label>
             <input type="date" id="iRel"></div>`
        : `<div style="margin-bottom:6px"><label>איפה</label>
             <input type="text" id="iWhere" placeholder="שם החנות" list="storeList" autocomplete="off">
             <datalist id="storeList"></datalist></div>`}
      <button class="txtbtn" id="iMore" aria-expanded="${itemMore}">${itemMore?'⌄':'‹'} קישור או תמונה</button>
      <div id="iExtra" ${itemMore ? '' : 'hidden'}>
        <div style="margin-bottom:8px"><label>קישור</label>
          <input type="text" id="iLink" placeholder="https://…" inputmode="url"></div>
        <button class="btn wide" id="iPic" style="margin-top:0">בחר תמונה</button>
        <input type="file" id="iFile" accept="image/*" hidden>
      </div>
      <div id="iPrev"></div>
      <div class="rule"></div>
      ${(() => {
        const ev = Store.listEvent(l.id);
        return ev
          ? `<div class="set"><div class="sb"><div class="st">משובצת ליומן</div>
               <div class="sd">${esc(Plan.label(ev.date))}${
                 ev.allDay ? ' · כל היום' : ' · ' + esc(ev.time)}${
                 ev.remindMin >= 0 ? ' · תזכורת ' + (ev.remindMin ? ev.remindMin + ' דק׳ לפני' : 'בזמן') : ''}</div></div>
               <button class="link" id="lUnplan">הסר</button></div>`
          /* שיבוץ ליומן הוא הדבר שהופך רשימה לתוכנית. הוא היה קישור טקסט
             קטן שאיש לא ראה — עכשיו הוא הפעולה הראשית של המסך. */
          : `<button class="btn p wide" id="lPlan" style="margin:4px 0 6px">
               שבץ ליומן עם תזכורת</button>
             <div class="ex" style="margin-bottom:8px">קובע מתי אתה עושה את זה,
               ומקבל תזכורת. אפשר לשבץ את כל הרשימה או רק פריטים שתבחר.</div>`;
      })()}
      ${body}
      ${l.kind === 'errand'
        ? `<button class="btn p wide" id="lSettle">סיימתי — סגירת חשבון${l.forWho ? ' ושליחה ל' + esc(l.forWho) : ''}</button>`
        : ''}
      <button class="btn d wide" id="lDelete">מחיקת הרשימה</button>`;

    const dl = $('#storeList');
    if (dl) dl.innerHTML = [...new Set(Store.openItems().map(i => i.where).filter(Boolean))]
      .map(w => `<option value="${esc(w)}">`).join('');
  }

  /* ====================================================================
     מקומות
     ==================================================================== */
  function renderPlaces(){
    PlaceSearch.render(document.getElementById("placesBody"));return;
    const box = $('#placesBody');
    const row = (p, isSub) => {
      const d = Geo.last ? Geo.dist(Geo.last, p) : null;
      const used = Store.all.tasks.filter(t => !t.archived && !t.done && t.reminder &&
                                               t.reminder.placeId === p.id).length;
      const meta = (isSub ? 'נקודה בתוך הגדר' : 'גדר ' + p.radius + ' מ׳')
        + (d !== null ? ' · ' + fmtM(d) + ' מכאן' : '')
        + (used ? ' · ' + used + ' משימות' : '');
      return `<div class="prow" data-id="${p.id}">
        <div class="pb"><div class="pn2">${esc(p.name)}</div><div class="pm2">${meta}</div></div>
        <a class="link" href="https://waze.com/ul?ll=${(Store.placeCoordinates(p.id)||p).lat},${(Store.placeCoordinates(p.id)||p).lng}&navigate=yes"
           target="_blank" rel="noopener">ניווט</a>
        <button class="x" data-act="delPlace">×</button></div>`;
    };
    const list = !Store.all.places.length
      ? `<div class="empty"><div class="h">אין מקומות שמורים</div>
           <div class="d">חפש בשם, שמור את המקום שאתה נמצא בו, או הדבק נ״צ מגוגל מפות.</div></div>`
      : Store.topPlaces().map(top => {
          const kids = Store.subPlaces(top.id);
          return row(top, false) +
            (kids.length ? `<div class="subplaces">${kids.map(k => row(k, true)).join('')}</div>` : '');
        }).join('');

    box.innerHTML = `
      <div class="seg" id="pSeg" style="margin-bottom:16px">
        <button data-k="search" aria-selected="${addKind==='search'}">חיפוש בשם</button>
        <button data-k="here"   aria-selected="${addKind==='here'}">כאן עכשיו</button>
        <button data-k="manual" aria-selected="${addKind==='manual'}">נ״צ ידני</button>
      </div>

      <div id="pSubSearch" ${addKind==='search'?'':'hidden'}>
        <div style="display:flex;gap:8px"><input type="text" id="qName"
             placeholder="מה מחפשים — למשל: סטימצקי" autocomplete="off">
          <button class="btn p" id="qGo" style="flex:0 0 auto">חפש</button></div>
        <input type="text" id="qArea" placeholder="באיזו עיר / אזור (לא חובה)"
               autocomplete="off" style="margin-top:8px">
        <div class="notice" style="margin-top:10px">אם שדה האזור ריק, אני מנסה לזהות עיר בתוך
          מה שכתבת (למשל "סטימצקי גן שמואל"), ואם אין — מחפש סביב המיקום הנוכחי.</div>
        <div id="qResults"></div>
      </div>

      <div id="pSubHere" ${addKind==='here'?'':'hidden'}>
        <label>שם המקום</label><input type="text" id="pName" placeholder="בסיס / בית / מכולת">
        <div class="fgrid" style="margin-top:10px">
          <div><label>רדיוס במטרים</label>
            <input type="number" id="pRad" value="250" min="80" max="5000" inputmode="numeric"></div>
          <div><label>בתוך מקום</label><select id="pParent"></select></div>
        </div>
        <div class="notice" style="margin-top:10px">מתחת ל-100 מטר הגדר לא אמינה — דיוק ה-GPS
          ליד מבנים גדול מזה. לחדר בתוך בסיס עדיף לבחור "בתוך מקום".</div>
        <button class="btn p wide" id="pAdd">שמור את המקום שאני בו</button>
      </div>

      <div id="pSubManual" ${addKind==='manual'?'':'hidden'}>
        <label>שם, או הדבקה של נ״צ</label>
        <input type="text" id="mName" placeholder="בסיס  ·  או 32.4589, 34.9481">
        <div class="fgrid" style="margin-top:10px">
          <div><label>קו רוחב</label><input type="text" id="mLat" inputmode="decimal"></div>
          <div><label>קו אורך</label><input type="text" id="mLng" inputmode="decimal"></div>
        </div>
        <div style="margin-top:10px"><label>רדיוס</label>
          <input type="number" id="mRad" value="250" min="80" max="5000" inputmode="numeric"></div>
        <button class="btn p wide" id="mAdd">שמור</button>
      </div>

      <div class="rule"></div>
      <h2 class="sh">מקומות שמורים</h2>
      ${list}
      <div class="notice" style="margin-top:14px">רק למקום ראשי יש גדר שמערכת ההפעלה שומרת.
        תת-מקומות הם נקודות בתוך הגדר — הם מכוונים אותך בשטח ולא יורים תזכורת בעצמם.</div>`;

    const sel = $('#pParent');
    if (sel) sel.innerHTML = `<option value="">— מקום עצמאי —</option>` +
      Store.topPlaces().map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  }

  /* ====================================================================
     הגדרות
     ==================================================================== */
  /* ההגדרות נפתחות כמעט ריקות. עדכון האפליקציה ראשון, כי זה הדבר היחיד
     שבאמת מעניין ביום רגיל; כל השאר — הרשאות שמאשרים פעם אחת, אבחון
     תקלות, וכלים נדירים — יושב במקטעים מכווצים. שום יכולת לא נמחקה. */
  let setOpen = { update:true, perms:false, diag:false, more:false };

  function renderSettings(){
    const d = Store.all, st = originState();
    const nOk = Alerts.supported && Notification.permission === 'granted';
    const n = Native.status() || {};
    const ago = n.lastCheck ? Math.round((Date.now()-n.lastCheck)/60000) : null;

    const sw = (id, title, desc, on) => `
      <div class="set"><div class="sb"><div class="st">${title}</div><div class="sd">${desc}</div></div>
        <button class="sw" id="${id}" aria-checked="${!!on}"></button></div>`;

    const perm = (ok, title, desc, act) => `
      <div class="set"><div class="sb"><div class="st">${title}</div><div class="sd">${desc}</div></div>
        ${ok ? '<span class="dim small">מאושר</span>'
             : `<button class="btn" data-nat="${act}" style="padding:8px 13px">אשר</button>`}</div>`;

    /** מקטע מתקפל. סגור = שורה אחת. */
    const sec = (key, name, inner, note) => `
      <div class="acc setacc" data-set="${key}" aria-expanded="${!!setOpen[key]}">
        <button class="ah" data-settoggle="${key}">
          <span class="an">${name}</span>
          ${note ? `<span class="as">${note}</span>` : ''}
          <span class="ar">‹</span></button>
        <div class="ab">${inner}</div>
      </div>`;

    const withTime = () => Store.all.tasks.filter(t => !t.archived && !t.done &&
      ((t.reminder && t.reminder.type === 'time') || Store.isHabit(t))).length;

    /* ---------- 1. עדכון האפליקציה — ראשון, פתוח כברירת מחדל ---------- */
    const updateBody = `
      <div class="set"><div class="sb"><div class="st">גרסה שרצה עכשיו</div>
        <div class="sd">הדף: <b dir="ltr" style="unicode-bidi:isolate">${esc(BUILD)}</b>${
          Native.on ? `<br>המעטפת (APK): <b dir="ltr" style="unicode-bidi:isolate">${
            esc(Native.version() || 'ישנה מ-' + NEED_APK)}</b>${
            Native.apkOld() ? ' — צריך ' + esc(NEED_APK) : ''}` : ''}</div></div></div>
      ${Native.on && Native.apkOld() ? `
        <div class="notice warn"><b>המעטפת של האפליקציה ישנה.</b><br>
          הדף מתעדכן לבד מהאינטרנט, אבל קובץ ה-APK לא — והוא זה שמפעיל את
          ההתראות. הדף הזה (${esc(BUILD)}) מבקש מהמעטפת פעולות שקיימות רק
          מגרסה <b dir="ltr" style="unicode-bidi:isolate">${esc(NEED_APK)}</b>.<br>
          <b>כל עוד זה כתוב כאן — אבחון ההתראות לא אמין, ותזכורות לא ירשמו.</b>
          צריך לבנות ולהתקין APK חדש.</div>` : ''}
      ${Native.on ? `
        ${n.updatePending ? `<div class="notice"><b>ירדה גרסה חדשה.</b>
            <button class="btn p wide" data-nat="apply">טען את הגרסה החדשה</button></div>` : ''}
        <div class="set"><div class="sb"><div class="st">בדיקה אחרונה</div>
          <div class="sd">${ago===null?'עוד לא נבדק':(ago<1?'לפני רגע':'לפני '+ago+' דקות')}</div></div></div>
        <button class="btn p wide" data-nat="check">בדוק עדכון עכשיו</button>`
      : `<div class="notice">אתה מריץ את הגרסה בדפדפן. היא לא יכולה לעקוב אחרי מיקום כשהיא
           סגורה ולא לכתוב לשעון של הטלפון — זו מגבלת דפדפן. הגרסה המותקנת עושה את שניהם.</div>`}`;

    /* ---------- 2. הרשאות והתקנה — מאשרים פעם אחת ושוכחים ---------- */
    const permsBody = !Native.on
      ? `<div class="notice">בדפדפן אין הרשאות מערכת לאשר.</div>`
      : `
      ${perm(n.locationBackground,'מיקום כל הזמן',
             n.locationBackground ? 'גדרות המיקום פעילות'
             : 'צריך "Allow all the time" — בלי זה אין תזכורות מקום ברקע','loc')}
      ${perm(n.notifications,'התראות',
             n.notifications ? 'מאושר' : 'בלי זה לא תראה כלום כשהאפליקציה סגורה','notif')}
      ${perm(n.batteryUnrestricted,'ללא הגבלת סוללה',
             n.batteryUnrestricted ? 'אנדרואיד לא ירדים את האפליקציה'
             : 'בלי זה סמסונג תרדים את האפליקציה אחרי כמה ימים','batt')}
      ${perm((n.alarms||{}).exact !== false, 'התראות ותזכורות',
             (n.alarms||{}).exact !== false ? 'תזכורות שעה יורות בשנייה המדויקת'
             : 'בלי זה אנדרואיד ידחה תזכורות בכמה דקות כדי לחסוך סוללה','exact')}
      ${typeof n.fullScreen !== 'boolean'
        ? `<div class="set"><div class="sb"><div class="st">התראה במסך מלא</div>
             <div class="sd">לא ידוע — המעטפת המותקנת לא יודעת לענות על זה.</div></div></div>`
        : perm(n.fullScreen, 'התראה במסך מלא',
             n.fullScreen ? 'התזכורת יכולה לקפוץ מעל מה שפתוח'
               : 'בלי זה אנדרואיד לא ירשה פופ-אפ מלא — רק שורה בשורת הסטטוס','fullscreen')}
      ${String(n.manufacturer||'').toLowerCase().includes('samsung') ? `
        <div class="notice"><b>סמסונג מרדימה אפליקציות אחרי 3 ימים.</b>
          זה הצעד הכי חשוב כאן — הוסף את "משימה" ל-Never sleeping apps.
          <button class="btn wide" data-nat="samsung">פתח את ההגדרה</button></div>` : ''}`;

    const permsNote = Native.on
      ? (() => {
          const need = [n.locationBackground, n.notifications, n.batteryUnrestricted]
            .filter(x => x === false).length;
          return need ? need + ' לאישור' : 'הכול מאושר';
        })()
      : '';

    /* ---------- 3. אבחון התראות — כלים, מוסתרים בשימוש רגיל ---------- */
    const diagBody = !Native.on
      ? `<div class="notice">בדפדפן אין מה לאבחן — התראות רקע לא קיימות שם.</div>`
      : `
      ${(() => {
        const a = n.alarms || {};
        const nx = a.next ? new Date(a.next) : null;
        const k  = nx ? Plan.key(nx) : '';
        const when = nx ? (k === Plan.today() ? '' : Plan.label(k) + ' ')
                          + nx.toTimeString().slice(0,5) : '';
        return `<div class="set"><div class="sb"><div class="st">שרשרת התזכורות</div>
          <div class="sd">משימות עם שעה: <b>${withTime()}</b><br>
            האפליקציה חישבה קדימה: <b>${Native.alarmList().length}</b><br>
            המערכת רשמה בפועל: <b>${a.scheduled||0}</b>${
            when ? '<br>הקרובה: ' + esc(when) : ''}</div></div>
          <button class="txtbtn" data-nat="resync">רענן</button></div>`;
      })()}
      ${(Native.alarmList().length && !((n.alarms||{}).scheduled||0)) ? `
        <div class="notice">האפליקציה חישבה תזכורות אבל המערכת לא רשמה אף אחת.
          לחץ על <b>"בדוק התראה עכשיו"</b> כדי לראות איפה זה נתקע.</div>` : ''}
      ${!withTime() ? `<div class="notice">אף משימה לא מחזיקה <b>שעה</b>.
        תזכורת נרשמת רק כשיש שעה — תאריך לבד לא מספיק.</div>` : ''}
      ${(() => {
        const c = n.channel;
        if (!c || typeof c !== 'object') return `<div class="set"><div class="sb">
          <div class="st">ערוץ ההתראות</div>
          <div class="sd">לא ידוע — המעטפת המותקנת לא יודעת לענות על זה.</div></div></div>`;
        if (c.exists === false) return `<div class="set"><div class="sb">
          <div class="st">ערוץ ההתראות</div>
          <div class="sd">עוד לא נוצר — יווצר בהתראה הראשונה</div></div></div>`;
        const ok = !c.blocked && (c.importance == null || c.importance >= 4);
        return `<div class="set"><div class="sb"><div class="st">ערוץ ההתראות</div>
          <div class="sd">${c.blocked ? 'מושתק לגמרי בהגדרות הטלפון'
            : ok ? 'פעיל, עם קפיצה וצליל'
                 : 'פעיל אבל בלי קפיצה — צריך "התראה" ולא "שקט"'}</div></div>
          ${ok ? '' : `<button class="txtbtn" data-nat="chan">פתח</button>`}</div>`;
      })()}
      <div class="notice">שתי הבדיקות האלה עוברות בדיוק באותו מסלול של תזכורת אמיתית.
        אם הן עובדות — הצינור תקין והבעיה בנתונים. אם לא — הבעיה בהרשאות.</div>
      <button class="btn wide" data-nat="testnow">בדוק התראה עכשיו</button>
      <button class="btn wide" data-nat="test60" style="margin-top:8px">
        תזכורת מבחן בעוד דקה</button>
      <div class="set" style="margin-top:10px"><div class="sb"><div class="st">תזכורות מקום רשומות</div>
        <div class="sd">${n.fences||0} מתוך ${Native.fenceCount()} רשומות במערכת${
          n.fencesResult ? ' · ' + esc(n.fencesResult) : ''}</div></div></div>
      <div class="notice">תזכורת מקום נשענת על שירותי המיקום של אנדרואיד. היא ממשיכה
        לעבוד כשהאפליקציה סגורה, אבל היא <b>לא מיידית</b>: המערכת בודקת כל כמה דקות,
        ורדיוס קטן מ-140 מטר מורחב אוטומטית.</div>
      <button class="btn wide" data-nat="alarms">פתח את השעון של הטלפון</button>`;

    /* ---------- 4. עוד הגדרות — נדיר, הרסני, וטכני ---------- */
    const moreBody = `
      <h2 class="sh">התראות באפליקציה</h2>
      ${sw('swGeo','מעקב מיקום','נדרש לתזכורות לפי מקום ולפי מרחק נסיעה', Geo.on)}
      ${sw('swVib','רטט','', d.prefs.vib)}
      ${sw('swSnd','צליל','', d.prefs.snd)}
      ${Native.on
        ? `<div class="set"><div class="sb"><div class="st">התראות מערכת</div>
             <div class="sd">באפליקציה המותקנת ההתראות מגיעות מהאפליקציה עצמה,
               והן נשלטות בשורת <b>"התראות"</b> תחת "הרשאות והתקנה".
               המתג שהיה כאן לא שלט בכלום.</div></div></div>`
        : sw('swNotif','התראות מערכת',
           !Alerts.supported ? 'הדפדפן הזה לא תומך בהתראות'
           : !st.secure ? 'דורש כתובת https'
           : Notification.permission === 'denied' ? 'נדחה — לאפשר בהגדרות הדפדפן'
           : 'התראות גם כשהחלון ברקע', nOk && d.prefs.notif)}

      <h2 class="sh">גיבוי ידני</h2>
      <div class="set"><div class="sb"><div class="st">מצב האחסון</div>
        <div class="sd">${Store.canPersist ? 'נשמר על המכשיר'
          : '⚠ אחסון חסום כאן — הנתונים יימחקו בסגירה.'}</div></div></div>
      <div class="set"><div class="sb"><div class="st">מה יש באפליקציה</div>
        <div class="sd">${Store.active().length} משימות פעילות · ${Store.archivedCount()} בארכיון ·
          ${d.events.length} אירועים · ${d.notes.length} הערות · ${d.places.length} מקומות</div></div></div>
      <button class="btn wide" id="btnExport">ייצוא גיבוי</button>
      <button class="btn wide" id="btnImport">ייבוא מגיבוי</button>
      <input type="file" id="fileIn" accept="application/json" hidden>
      <button class="btn wide" id="btnPaste" style="margin-top:8px">הדבקת גיבוי כטקסט</button>
      <div class="notice">אם כפתור הייבוא לא מגיב — זה קורה כשבורר הקבצים של
        המערכת חסום — יש שתי דרכים אחרות: לפתוח את קובץ הגיבוי מההורדות עם
        "פתח באמצעות משימה", או להעתיק את תוכן הקובץ ולהדביק אותו כאן.</div>

      ${Native.on ? `
      <h2 class="sh">מקור העדכונים</h2>
      <div class="set"><div class="sb"><div class="st">כתובת המקור</div>
        <div class="sd">הקישור ל-index.html. משם האפליקציה מושכת עדכונים.</div>
        <input type="text" id="srcUrl" value="${esc(cleanSrc(n.sourceUrl||''))}"
               inputmode="url" style="margin-top:9px"></div></div>
      <button class="btn wide" data-nat="saveSrc">שמור כתובת</button>
      <button class="btn wide" data-nat="peek">מה יש בשרת עכשיו?</button>` : ''}

      <h2 class="sh">איך זה עובד</h2>
      <div class="notice">
        ${Native.on ? `<b>מה עובד כשהאפליקציה סגורה:</b> תזכורות לפי מקום, לפי שעה,
          תזכורות חוזרות ותזכורות אירוע — מערכת ההפעלה מחזיקה את כולן.<br>
          <b>מה דורש שהאפליקציה תהיה פתוחה:</b> תזכורת לפי מרחק נסיעה בלבד.<br>
          <span class="dim">האפליקציה רושמת תזכורות לשבוע קדימה. כל פתיחה שלה
          מגלגלת את החלון, וגם בלי פתיחה יש רענון עצמי פעמיים ביום.</span>`
        : `<b>בדפדפן שום תזכורת לא עובדת כשהחלון סגור.</b> זו מגבלת דפדפן, לא באג.
           הגרסה המותקנת עושה את שניהם.`}</div>

      <h2 class="sh">מסוכן</h2>
      <button class="btn d wide" id="btnWipe">מחיקת כל הנתונים</button>`;

    /* ---------- אזהרת תקרה — רק כשבאמת מתקרבים אליה ---------- */
    const cap = Native.on ? Native.alarmDemand() : null;
    const capWarn = (cap && cap.wanted >= cap.cap * 0.9) ? `
      <div class="notice warn">יש לך יותר תזכורות קרובות ממה שאנדרואיד מוכן להחזיק
        בבת אחת (${cap.wanted} מול ${cap.cap}). התזכורות הקרובות רשומות כרגיל;
        המאוחרות יותר יירשמו מאליהן ככל שהזמן מתקדם. אין מה לעשות עם זה —
        זה רק כדי שתדע.</div>` : '';

    Settings.render({updateBody, permsBody, diagBody, moreBody, n, capWarn});
  }

  /* ====================================================================
     הערות
     ==================================================================== */
  function noteText(html){
    const d = document.createElement('div');
    d.innerHTML = html || '';
    d.querySelectorAll('script,style').forEach(x => x.remove());
    d.querySelectorAll('p,div,li,h1,h2,h3,br,blockquote,tr').forEach(x => x.append(' '));
    return (d.textContent || '').replace(/\s+/g,' ').trim();
  }
  function firstImg(html){
    const m = /<img[^>]+src="([^"]+)"/i.exec(html || '');
    return m ? m[1] : '';
  }
  function renderNotes(){
    const idx = $('#notesIndex'), ed = $('#noteEdit');
    if (openNote && Store.note(openNote)){ idx.hidden = true; ed.hidden = false; return; }
    openNote = null; idx.hidden = false; ed.hidden = true;

    const q = noteQ.trim().toLowerCase();
    const all = Store.notes();
    const list = !q ? all : all.filter(n =>
      (n.title||'').toLowerCase().includes(q) || noteText(n.html).toLowerCase().includes(q));
    const el = $('#notesList');
    if (!list.length){
      el.innerHTML = q
        ? `<div class="empty"><div class="h">לא נמצא</div>
             <div class="d">אין הערה שמתאימה לחיפוש.</div></div>`
        : `<div class="empty"><div class="h">אין הערות עדיין</div>
             <div class="d">מחשבות, שיעורים, ציטוטים — מה שבא.</div>
             <button class="btn" data-act="add">+ הערה חדשה</button></div>`;
      return;
    }
    el.innerHTML = list.map(n => {
      const txt = noteText(n.html), img = firstImg(n.html);
      return `<div class="ncard" data-id="${n.id}">
        ${img ? `<img class="thumb" src="${esc(img)}" alt="">` : ''}
        <div class="nb">
          <div class="nt">${n.pinned ? '★ ' : ''}${esc(n.title || 'ללא כותרת')}</div>
          <div class="np">${esc(txt || '—')}</div>
          <div class="nd">${esc(fmtDate(n.updatedAt))}</div>
        </div>
        <button class="hbtn" data-act="nMenu" style="width:26px;height:26px;font-size:14px">⋯</button>
      </div>`;
    }).join('');
  }

  /* ====================================================================
     מעטפת, רינדור ראשי, התראות
     ==================================================================== */
  function renderChrome(){
    $('#hTitle').textContent = screen ? SCREEN_TITLE[screen] : SEC_TITLE[section];
    $$('#nav button').forEach(b =>
      b.setAttribute('aria-selected', !screen && b.dataset.s === section));
    $$('.sec').forEach(s => s.classList.remove('on'));
    const id = screen ? 's-' + screen : 's-' + section;
    const el = document.getElementById(id);
    if (el) el.classList.add('on');

    const g = $('#gps');
    g.hidden=screen==='settings'||!!window.MesimaDesktop;
    g.classList.toggle('on', Geo.on && !!Geo.last);
    $('#gpsTxt').textContent = !Geo.on ? 'GPS כבוי'
      : (Geo.last ? (Geo.trip.meters > 200 ? (Geo.trip.meters/1000).toFixed(1) + ' ק״מ' : 'מיקום פעיל')
                  : 'מחפש…');

    /* כפתור ההוספה קיים רק איפה שיש משמעות ליצירה (סעיף 44) */
    const fabOn = (!screen && (section === 'today' || section === 'tasks')) ||
                  (screen === 'notes' && !openNote) || (screen === 'lists');
    $('#fab').hidden = !fabOn;
  }

  function typing(){
    const a = document.activeElement;
    if (!a) return false;
    if (a.tagName === 'TEXTAREA' || a.isContentEditable) return true;
    if (a.tagName !== 'INPUT') return false;
    return ['text','number','url','search','tel','email',''].includes((a.type||'').toLowerCase());
  }

  function render(){
    try { API.afterRender && API.afterRender(); } catch(e){}
    if (typing()){ deferred = true; renderChrome(); return; }
    deferred = false;
    renderChrome();
    if (screen === 'notes')    return renderNotes();
    if (screen === 'lists')    return renderLists();
    if (screen === 'archive')  return renderArchive();
    if (screen === 'places')   return renderPlaces();
    if (screen === 'settings') return renderSettings();
    if (section === 'today')   return renderToday();
    if (section === 'tasks')   return renderTasks();
    if (section === 'library') return renderLibrary();
  }

  let toastT = null;
  function toast(msg){
    const t = $('#toast');
    t.onclick = null; t.classList.remove('act');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
  }
  /** טוסט עם ביטול — מחיקה שקטה של פריט ברשימה חייבת דרך חזרה */
  function undo(msg, fn){
    const t = $('#toast');
    t.innerHTML = esc(msg) + '<button class="un">ביטול</button>';
    t.classList.add('on','act');
    const off = () => { t.classList.remove('on','act'); t.onclick = null; };
    t.onclick = e => { if (e.target.closest('.un')){ off(); fn(); toast('הוחזר'); } };
    clearTimeout(toastT); toastT = setTimeout(off, 5400);
  }

  /* ---- תור התראות ---- */
  const alertQ = [];
  let alertT = null;
  function showAlert(item, why, kind){
    alertQ.push({ item, why, kind });
    if (!alertItem && !alertT) alertT = setTimeout(() => { alertT = null; nextAlert(); }, 0);
  }
  function nextAlert(){
    let a = alertQ.shift();
    while(a&&Store.reminderBlocked(ReminderLink.resolve(a.item.id)))a=alertQ.shift();
    if (!a){ alertItem = null; $('#alert').classList.remove('on'); return; }
    alertItem = { item:a.item, kind:a.kind, why:a.why };
    $('#alMsg').textContent = a.item.title;
    $('#alSub').textContent = a.why + (alertQ.length ? '  ·  ועוד ' + alertQ.length : '');
    $('#alTtl').textContent = a.kind === 'event' ? 'אירוע ביומן'
                            : a.kind === 'place' ? 'מיקום' : 'תזכורת';
    $('#alDet').innerHTML = alertDetail(a.item, a.kind);
    $('#alDet').hidden = !$('#alDet').innerHTML;
    /* "פתח" מוביל לפרטי המשימה — אותו מודל מנטלי כמו נגיעה בכרטיס.
       התראה לא זורקת אותך לתוך טופס עריכה. */
    const canOpen = a.kind === 'task' && !!Store.task(a.item.id);
    $('#alOpen').hidden = !canOpen;
    $('#alComplete').hidden = !canOpen || Store.task(a.item.id)?.kind!=='short';
    $('#alert').classList.add('on');
  }
  function closeAlert(){ alertItem = null; nextAlert(); }

  /** מה בעצם צריך לעשות עכשיו — תיאור, תמונה, ותת-המשימות הפתוחות.
      התראה שמראה רק כותרת מכריחה לפתוח את האפליקציה כדי להיזכר. */
  function alertDetail(item, kind){
    if (!item) return '';
    const bits = [];
    const line = [];
    if (kind === 'event'){
      const ty = Cal.type(item);
      line.push(item.allDay ? 'כל היום' : (item.time || '') + (item.end ? '–' + item.end : ''));
      if (ty) line.push(ty.name);
      if (line.length) bits.push(`<div class="dk">${esc(line.filter(Boolean).join(' · '))}</div>`);
      if (item.note) bits.push(`<div class="dnote">${esc(item.note)}</div>`);
      const linked = Store.tasksForEvent(item.id).filter(t=>t.kind!=='long');
      if (linked.length){
        bits.push(`<div class="dh">מה להכין</div>` + linked.map(t =>
          `<div class="dk"><span class="dot"></span>${esc(t.title)}</div>`).join(''));
      }
      return bits.join('');
    }
    const t = Store.task(item.id) || item;
    const meta = taskMeta(t, { noKids:true });
    if (meta) bits.push(`<div class="dk">${esc(meta)}</div>`);
    if (t.note) bits.push(`<div class="dnote">${esc(t.note)}</div>`);
    if (t.img)  bits.push(`<img src="${t.img}" alt="">`);
    const kids = [...Store.subtasksOf(t.id), ...Store.habitsOf(t.id)].filter(c => !c.archived);
    if (kids.length){
      bits.push(`<div class="dh">תת-משימות</div>` + kids.slice(0,8).map(c =>
        `<div class="dk"><span class="dot"></span>${esc(c.title)}</div>`).join(''));
    }
    const cl = Store.checklist(t.id).filter(x => !x.checked);
    if (cl.length){
      bits.push(`<div class="dh">רשימה</div>` + cl.slice(0,10).map(x =>
        `<div class="dk"><span class="dot"></span>${esc(x.title)}</div>`).join('') +
        (cl.length > 10 ? `<div class="dk">ועוד ${cl.length-10}</div>` : ''));
    }
    return bits.join('');
  }

  /** תמונה מוקטנת כ-data URL. גלריה בלבד — אין `capture`, ולכן אנדרואיד
      פותח את בוחר הקבצים ולא את המצלמה. */
  function shrinkImage(file, max){
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => { const im = new Image();
        im.onload = () => { const sc = Math.min(1, max / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.round(im.width*sc); c.height = Math.round(im.height*sc);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.72)); };
        im.onerror = rej; im.src = fr.result; };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }

  function download(name, text, mime){
    if(window.MesimaDesktop){window.MesimaDesktop.save(name,text);return;}
    if (Native.on && Native.save(name, text, mime)) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  const API = {
    init:()=>Wire.init(), render, renderNotes, renderTasks, renderChrome,
    toast, undo, showAlert, closeAlert, download, esc, eventCountdown, fmtM, fmtDate, longDate,
    CAT, DAYL, PALETTE, KIND, whereLabel, taskMeta, repeatLabel, path, monthDayList,
    originState, typing, cleanSrc, bustSrc, noteText, shrinkImage,
    get setOpen(){ return setOpen; },
    get openCl(){ return openCl; },
    get section(){ return section; }, set section(v){ section=v; },
    get screen(){ return screen; },   set screen(v){ screen=v; },
    get tview(){ return tview; },     set tview(v){ tview=v; },
    get filter(){ return filter; },   set filter(v){ filter=v; },
    get taskQ(){ return taskQ; },     set taskQ(v){ taskQ=v; },
    get selDate(){ return selDate; }, set selDate(v){ selDate=v; },
    get rangeFrom(){ return rangeFrom; }, set rangeFrom(v){ rangeFrom=v; },
    peeked, noteShut, trail,
    noteBlock,
    get reorder(){ return reorder; }, set reorder(v){ reorder=v; },
    get grouped(){ return grouped; }, set grouped(v){ grouped=v; },
    get calY(){ return calY; },       set calY(v){ calY=v; },
    get calM(){ return calM; },       set calM(v){ calM=v; },
    get openList(){ return openList; }, set openList(v){ openList=v; },
    get listKind(){ return listKind; }, set listKind(v){ listKind=v; },
    get itemMore(){ return itemMore; }, set itemMore(v){ itemMore=v; },
    get openNote(){ return openNote; }, set openNote(v){ openNote=v; },
    get noteQ(){ return noteQ; },     set noteQ(v){ noteQ=v; },
    get addKind(){ return addKind; }, set addKind(v){ addKind=v; },
    get alertItem(){ return alertItem; }, set alertItem(v){ alertItem=v; },
    get deferred(){ return deferred; },
    afterRender: null,
  };
  return API;
})();
/* -------------------------------- Wire ---------------------------------- */
