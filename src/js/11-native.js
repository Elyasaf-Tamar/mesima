const Native = (() => {
  const A = () => window.MesimaNative;
  let syncT = null;

  /**
   * גדר אחת לכל (מקום ראשי × עיכוב), לא אחת לכל משימה.
   *
   * הסיבה: GPS של טלפון מדויק ל-20–50 מטר ליד מבנים, ואנדרואיד עצמו לא מתחייב
   * מתחת ל-100 מטר. גדר על "משרד" בתוך בסיס פשוט לא יכולה לירות אמין.
   * לכן הגדר יושבת על המקום הראשי ברדיוס גדול, ותת-המקומות משמשים רק
   * לניווט בתוך האפליקציה. בונוס: התראה אחת בכניסה במקום שש בזמן הליכה.
   */
  function fenceList(){
    if(!Store.all.prefs.geo)return [];
    const groups = new Map();
    Store.all.tasks
      .filter(t => !t.archived && !t.done && t.reminder && t.reminder.type === 'place')
      .forEach(t => {
        const sub  = Store.place(t.reminder.placeId); if (!sub) return;
        const root = Store.placeRoot(sub.id);         if (!root) return;
        const delay = t.reminder.delayMin || 0;
        const key = root.id + '|' + delay;
        if (!groups.has(key)) groups.set(key, { root, delay, items: [] });
        groups.get(key).items.push({ t, sub });
      });

    return [...groups.entries()].map(([key, g]) => {
      const n = g.items.length;
      let title;
      if (n === 1){
        const { t, sub } = g.items[0];
        title = t.title + (sub.id !== g.root.id ? ' · ' + sub.name : '');
      } else {
        const spots = [...new Set(g.items.map(x => x.sub.name))].filter(x => x !== g.root.name);
        title = n + ' משימות ב' + g.root.name + (spots.length ? ' · ' + spots.slice(0,3).join(', ') : '');
      }
      return { id:'g_'+key, lat:g.root.lat, lng:g.root.lng, radius:g.root.radius,
               delayMin:g.delay, title, place:g.root.name,items:g.items.map(x=>({taskId:x.t.id,title:x.t.title,note:x.t.note||""})) };
    }).slice(0, 95);   /* מגבלת מערכת: 100 גדרים לאפליקציה */
  }

  /* ---------------- תזכורות שעה ברקע (סעיף 59) ----------------
     ה-JS מחשב את המופעים הקרובים; אנדרואיד רושם אותם ב-AlarmManager
     ומעיר את עצמו בשעה שנקבעה, גם כשהאפליקציה מתה. הסמנטיקה כאן
     חייבת להיות זהה לזו של Engine — אחרת תקבל התראה כפולה או חסרה. */
  const WINDOW_DAYS = 7;      /* פתיחת האפליקציה מגלגלת את החלון קדימה */
  const ALARM_CAP   = 100;

  const ms = (dateKey, hm) => {
    const [y,mo,d] = dateKey.split('-').map(Number);
    const [h,mi]   = String(hm||'00:00').split(':').map(Number);
    return new Date(y, mo-1, d, h||0, mi||0, 0, 0).getTime();
  };

  function buildAlarms(days){
    const out  = [];
    const now  = Date.now();
    const soon = now + 500;             /* מה שקורה ממש עכשיו — Engine מטפל */
    const t0   = Plan.today();
    const span = [];
    for (let i = 0; i < (days || WINDOW_DAYS); i++) span.push(Plan.shift(t0, i));
    const nowHM = new Date().toTimeString().slice(0,5);

    Store.all.tasks.forEach(t => {
      if (t.archived || t.done) return;

      /* הרגל: כל שעה בכל יום חובה שבחלון, כל עוד היום עוד לא סומן.
         יום עם חריג פעיל (סוג אירוע שנבחר) אינו יום חובה — אין תזכורת,
         והרצף לא נשבר. */
      if (Store.isHabit(t)){
        span.forEach(day => {
          if (!Recur.due(t.repeat, day)) return;
          if (Store.habitFull(t, day)) return;      /* סימון סוגר את כל היום */
          Recur.times(t.repeat).forEach(hm => {
            const at = ms(day, hm);
            const more = Recur.times(t.repeat).filter(x => x > hm);
            /* התאמה סביב אירועים — מאותו מנוע */
            const ar = Recur.around(t.repeat, day, hm);
            if (ar){
              if (ar.prep >= soon)
                out.push({ id:'hp_'+t.id+'_'+day+'@'+hm, at:ar.prep, title:t.title,
                           body:'שים לב — יש לך אירוע בזמן ההרגל הזה. תיערך בהתאם.' });
              if (ar.after >= soon)
                out.push({ id:'ha_'+t.id+'_'+day+'@'+hm, at:ar.after, title:t.title,
                           body:'שים לב — היית אמור לעשות את זה.' });
              return;
            }
            if (at < soon) return;
            out.push({ id:'h_'+t.id+'_'+day+'@'+hm, at, title:t.title,
                       body:'תזכורת יומית ' + hm +
                            (more.length ? ' · תזכורת נוספת ב-' + more[0] : '') });
          });
        });
        return;
      }

      if (t.kind === 'long') return;
      const r = t.reminder;
      if (!r || r.type !== 'time') return;

      /* "חד-פעמית" היא מופע אחד, נקודה. משימה בלי תאריך מקבלת את המופע
         הקרוב בלבד — היום אם השעה עוד לפנינו, אחרת מחר — ולא נרשמת
         מחדש בכל יום שבחלון כפי שהיה קודם. */
      const dayList = t.planned
        ? (t.planned >= t0 ? [t.planned] : [])
        : [ (r.at > nowHM) ? t0 : Plan.shift(t0, 1) ];
      dayList.forEach(day => {
        const at = ms(day, r.at);
        if (at < soon) return;
        /* היום כבר ירה? Engine מסמן firedKey ליום הנוכחי */
        if (day === t0 && t.rt && t.rt.firedKey === new Date().toDateString() + r.at) return;
        out.push({ id:'t_'+t.id+'_'+day, at, title:t.title, body:'הגיע הזמן — ' + r.at });
      });
    });

    /* צ׳קליסט חד-פעמי עם שעה: תזכורת אחת, ביום שנבחר */
    Store.all.tasks.forEach(t => {
      if (t.archived || t.done) return;
      (t.checklists || []).forEach(c => {
        if (c.repeat || !c.once || !c.once.date || !c.once.time) return;
        if (c.items.length && c.items.every(x => x.checked)) return;
        const at = ms(c.once.date, c.once.time);
        if (at < soon) return;
        const left = c.items.filter(x => !x.checked).length;
        out.push({ id:'co_'+t.id+'_'+c.id, at, title:c.name,
                   body:(left ? left + ' פריטים פתוחים' : 'צ׳קליסט') + ' · ' + t.title });
      });
    });

    /* צ׳קליסט חוזר: מופע אחד לכל יום חובה שבחלון, כל עוד המחזור פתוח */
    Store.all.tasks.forEach(t => {
      if (t.archived || t.done) return;
      (t.checklists || []).forEach(c => {
        const rep = c.repeat;
        if (!rep || !Recur.times(rep).length) return;

        Recur.times(rep).forEach(hm => {
        span.forEach(day => {
          if (!Recur.due(rep, day)) return;
          if(Store.checklistCycleDone(c) && day <= Store.checklistCycle(c))return;
          const ar = Recur.around(rep, day, hm);
          if (ar){
            if (ar.prep >= soon)
              out.push({ id:'cp_'+t.id+'_'+c.id+'_'+day+'@'+hm, at:ar.prep, title:c.name,
                         body:'שים לב — יש לך אירוע בזמן הזה. תיערך בהתאם · ' + t.title });
            if (ar.after >= soon)
              out.push({ id:'ca_'+t.id+'_'+c.id+'_'+day+'@'+hm, at:ar.after, title:c.name,
                         body:'שים לב — היית אמור לעבור על זה · ' + t.title });
            return;
          }
          const at = ms(day, hm);
          if (at < soon) return;
          const left = c.items.filter(x => !x.checked).length;
          out.push({ id:'c_'+t.id+'_'+c.id+'_'+day+'@'+hm, at, title:c.name,
                     body: (left ? left + ' פריטים פתוחים' : 'מחזור חדש') + ' · ' + t.title });
        });
        });
      });
    });

    /* אירועי יומן */
    Store.all.events.forEach(ev => {
      if (ev.remindMin == null || ev.remindMin < 0) return;
      if (ev.rt && ev.rt.firedAt) return;
      const at = Cal.remindAt(ev);
      if (at < soon || at > now + (days || WINDOW_DAYS) * 86400000) return;
      out.push({ id:'e_'+ev.id, at, title:ev.title,
                 body: ev.allDay
                   ? (ev.date === Plan.today() ? 'היום · כל היום'
                                               : Plan.label(ev.date) + ' · כל היום')
                   : ev.remindMin > 0
                     ? 'מתחיל בעוד ' + ev.remindMin + ' דקות (' + ev.time + ')'
                     : 'מתחיל עכשיו (' + ev.time + ')' });
    });

    return out.map(a=>{
      const link=ReminderLink.resolve(a.id),t=link?.taskId?Store.task(link.taskId):null,ev=link?.eventId?Store.event(link.eventId):null;
      const note=(t?.notificationText ?? t?.note ?? ev?.note ?? '').trim();
      return {...a,...link,body:note?note+'\n\n'+a.body:a.body};
    }).sort((a,b) => a.at - b.at);
  }
  /** הרשימה שנמסרת למערכת — חתוכה לתקרה שהמערכת מסוגלת להחזיק */
  function alarmList(days){ return buildAlarms(days).slice(0, ALARM_CAP); }
  /** כמה מופעים חושבו באמת לפני החיתוך. רק זה יודע אם נגענו בתקרה. */
  function alarmDemand(days){
    const all = buildAlarms(days);
    return { wanted: all.length, cap: ALARM_CAP, over: Math.max(0, all.length - ALARM_CAP) };
  }

  return {
    get on(){ return !!A(); },
    status(){ try { return A() ? JSON.parse(A().status()) : null; } catch(e){ return null; } },
    /* נדחה מעט כדי לא לרשום מחדש על כל הקלדה */
    sync(){
      if (!A()) return;
      NativeState.publish();
      try { A().syncAlarms(JSON.stringify(alarmList())); } catch(e){}
      clearTimeout(syncT);
      syncT = setTimeout(() => {
        try { A().syncGeofences(JSON.stringify(fenceList())); } catch(e){}
        try { A().syncAlarms(JSON.stringify(alarmList())); } catch(e){}
      }, 600);
    },
    fenceCount(){ return fenceList().length; },
    fenceList,
    alarmList, alarmDemand,
    alarmCount(){ return alarmList().length; },
    /** האם המערכת מרשה תזכורת בשנייה המדויקת */
    canExact(){ try { return A() ? !!A().canExactAlarms() : false; } catch(e){ return false; } },
    askExact(){ try { A().requestExactAlarms(); } catch(e){} },
    askLocation(){ try { A().requestLocation(); } catch(e){} },
    askNotifications(){ try { A().requestNotifications(); } catch(e){} },
    battery(){ try { A().requestBatteryExemption(); } catch(e){} },
    samsung(){ try { A().openSamsungSleepingApps(); } catch(e){} },
    appSettings(){ try { A().openAppSettings(); } catch(e){} },
    showAlarms(){ try { A().showAlarms(); } catch(e){} },
    /* פותח את מסך יצירת ההתראה באפליקציית השעון ומשאיר למשתמש לאשר.
       skipUi=false בכוונה — המשתמש רוצה לראות ולאשר את ההתראה בעצמו. */
    openAlarm(at, label){
      if (!A()) return false;
      const [h,m] = String(at).split(':').map(Number);
      try { A().setAlarm(h|0, m|0, label, false); return true; } catch(e){ return false; }
    },
    setAlarm(at, message){ return this.openAlarm(at, message); },
    addEvent(ev){
      if (!A()) return false;
      const b = Cal.startMs(ev), e = Cal.endMs(ev);
      try { A().addCalendarEvent(ev.title, b, e, ev.note||'', ''); return true; } catch(x){ return false; }
    },
    /* ה-WebView לא יודע להוריד blob, ולכן שמירה עוברת דרך אנדרואיד */
    save(name, text, mime){
      if (!A()) return false;
      try { A().saveText(name, text, mime||'text/plain'); return true; } catch(e){ return false; }
    },
    /* אנדרואיד צריך לדעת מראש אם לכפתור החזרה יש עוד מה לסגור.
       שאלה אסינכרונית בכל לחיצה יצרה מרוץ שסגר את האפליקציה באמצע מסלול. */
    canBack(v){ try { A().setCanBack(!!v); } catch(e){} },
    /* בדיקה עצמית — עוברת באותו מסלול בדיוק של תזכורת אמיתית */
    /** מסירה מיידית, בלי ההשהיה — ומחזירה כמה נרשמו בפועל */
    syncNow(){
      if (!A()) return -1;
      NativeState.publish();
      try { return A().syncAlarms(JSON.stringify(alarmList())); } catch(e){ return -1; }
    },
    /* גרסת מעטפת האנדרואיד. מעטפת ישנה לא מכירה את המתודה הזאת ולכן
       מחזירה '' — וזה בדיוק הסימן שצריך להתקין APK חדש. */
    version(){ try { return String(A().version() || ''); } catch(e){ return ''; } },
    /* משווה 0.9 מול 0.8 כמספרים, לא כמחרוזות */
    apkOld(){
      const v = this.version();
      if (!this.on) return false;
      if (!v) return true;
      const a = v.split('.').map(Number), b = NEED_APK.split('.').map(Number);
      for (let i = 0; i < Math.max(a.length, b.length); i++){
        const x = a[i]||0, y = b[i]||0;
        if (x !== y) return x < y;
      }
      return false;
    },
    testNotify(){ try { return A().testNotify(); } catch(e){ return 'no bridge'; } },
    testAlarm(sec){ try { return A().testAlarm(sec); } catch(e){ return 0; } },
    askFullScreen(){ try { A().requestFullScreen(); } catch(e){} },
    openChannel(){ try { A().openChannelSettings(); } catch(e){} },
    ready(){ try { A().ready(); } catch(e){} },
    setSource(u){ try { A().setSourceUrl(u); } catch(e){} },
    checkUpdate(){ try { A().checkUpdate(); } catch(e){} },
    applyUpdate(){ try { A().applyUpdate(); } catch(e){} },
  };
})();

/* --------------------------------- UI ----------------------------------- */
/* משימה 2.0 — רינדור בלבד. כל ההיגיון יושב ב-Store וב-Engine. */
