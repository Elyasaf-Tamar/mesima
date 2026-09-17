const Engine = (() => {
  function check(){
    const now = Date.now();
    try{const rows=JSON.parse(localStorage.getItem('mesima.snoozes')||'[]'),due=rows.filter(x=>x.at<=now);if(due.length){localStorage.setItem('mesima.snoozes',JSON.stringify(rows.filter(x=>x.at>now)));due.filter(x=>!Store.reminderBlocked(x.meta||ReminderLink.resolve(x.id))).forEach(x=>Alerts.fire(Store.task(x.id)||{id:x.id,title:x.title,rt:{}},x.body,'task'));}}catch{}
    let changed = false;

    /* ------- משימות ------- */
    Store.all.tasks.forEach(t => {
      /* משימה יומית חוזרת: תזכורת אחת לכל שעה, רק בימי החובה,
         ורק אם עוד לא סימנת מספיק פעמים היום. */
      if (Store.isHabit(t) && !t.archived){
        const day = Plan.today();
        /* חריג לפי סוג אירוע: היום הזה פשוט אינו יום חובה. אין תזכורת,
           והרצף לא נשבר — זו בדיוק ההבחנה מ"התאמה סביב אירועים". */
        if (!Store.habitRequired(t, day)) return;
        t.rt = t.rt || {};
        if (t.rt.snoozeTo && now < t.rt.snoozeTo) return;
        if (Store.habitFull(t, day)) return;            /* כבר סימנת היום — שקט */
        /* התזכורות הן ניסיונות חוזרים על אותה משימה: יורים רק על השעה
           האחרונה שעברה, כדי שלא תקבל ערימה של התראות בבת אחת. */
        const nowHM = new Date().toTimeString().slice(0,5);
        /* התאמה סביב אירועים: ההרגל עדיין נדרש, אבל לא באמצע האירוע.
           נבדק על כל השעות ולא רק על אלה שעברו, כי תזכורת ההכנה מקדימה
           את שעת ההרגל בשש שעות ולכן נופלת לפניה. */
        let covered = null;
        if (t.repeat.around){
          const evs = Store.events(day);
          for (const hm2 of t.repeat.times){
            const cov = Cal.covering(evs, Cal.atMs(day, hm2));
            if (cov){ covered = { hm:hm2, ev:cov }; break; }
          }
        }
        if (covered){
          const prep  = Cal.startMs(covered.ev) - 6*3600000;
          const after = Cal.endMs(covered.ev) + 2*3600000;
          const pKey = day + '@prep@' + covered.hm;
          const aKey = day + '@after@' + covered.hm;
          if (now >= after && after>(t.rt.resumeAt||0) && t.rt.firedKey !== aKey){
            t.rt.firedKey = aKey; changed = true;
            Alerts.fire(t, 'שים לב — היית אמור לעשות את זה', 'task');
          } else if (now >= prep && prep>(t.rt.resumeAt||0) && now < after &&
                     t.rt.firedKey !== pKey && t.rt.firedKey !== aKey){
            t.rt.firedKey = pKey; changed = true;
            Alerts.fire(t, 'שים לב — יש לך אירוע בזמן ההרגל הזה. תיערך בהתאם.', 'task');
          }
          return;                                     /* שקט בזמן האירוע */
        }
        const due = t.repeat.times.filter(hm => hm <= nowHM);
        if (!due.length) return;
        const hm = due[due.length-1];
        const key = day + '@' + hm;
        if (t.rt.firedKey !== key && Cal.atMs(day,hm) > (t.rt.resumeAt||0)){
          t.rt.firedKey = key; changed = true;
          const more = t.repeat.times.filter(x => x > nowHM);
          Alerts.fire(t, 'תזכורת יומית ' + hm + (more.length ? ' · תזכורת נוספת ב-' + more[0] : ''), 'task');
        }
        return;
      }
      if (t.archived || t.done || !t.reminder) return;
      t.rt = t.rt || {};
      /* דחייה משתיקה את ההתראה בלבד; המעקב ממשיך לרוץ */
      const snoozed = !!(t.rt.snoozeTo && now < t.rt.snoozeTo);
      const r = t.reminder;

      if (r.type === 'time'){
        /* משימה שיש לה תאריך יורה רק ביום שלה. בלי הבדיקה הזאת משימה
           שתוכננה למחר בשעה שכבר עברה היום הייתה מצלצלת מיד — וזו בדיוק
           הסמנטיקה שהמתזמן ברקע כבר עובד לפיה. */
        if (t.planned && t.planned !== Plan.today()) return;
        const [h,m] = (r.at||'00:00').split(':').map(Number);
        const target = new Date(); target.setHours(h,m,0,0);
        const key = new Date().toDateString()+r.at;
        if (now >= target.getTime() && target.getTime() > (t.rt.resumeAt||0) && t.rt.firedKey !== key){
          if (snoozed) return;
          t.rt.firedKey = key; changed = true;
          /* "חד-פעמית" היא פעם אחת. תזכורת בלי תאריך שירתה מתקבעת על
             היום שבו ירתה, ולכן היא לא חוזרת מחר — וזה גם מרפא נתונים
             ישנים שנשמרו לפני התיקון. */
          if (!t.planned) t.planned = Plan.today();
          Alerts.fire(t, 'הגיע הזמן — '+r.at, 'task');
        }
        return;
      }

      if(NativeState.available() && ['trip','place'].includes(r.type))return;
      if (r.type === 'trip'){
        const km = Geo.trip.meters/1000;
        if (km < r.km){ if (t.rt.firedAt && km < 0.2){ t.rt.firedAt=null; changed=true; } return; }
        if (t.rt.firedAt || snoozed) return;
        t.rt.firedAt = now; t.rt.snoozeTo = null; changed = true;
        Alerts.fire(t, 'נסעת '+km.toFixed(1)+' ק״מ ברצף', 'task');
        return;
      }

      /* תזכורות מקום מטופלות מקובצות מתחת — כדי לא לירות ארבע התראות בבת אחת */
    });

    /* ------- מיקום: התראה אחת מקובצת לכל מקום (סעיף 57) ------- */
    if (Geo.last && !NativeState.available()){
      const ready = [];
      Store.all.tasks.forEach(t => {
        const r = t.reminder;
        if (t.archived || t.done || !r || r.type !== 'place') return;
        t.rt = t.rt || {};
        const p = Store.place(r.placeId);
        const root = p ? Store.placeRoot(p.id) : null;
        if (!p || !root) return;
        const inside = Geo.dist(Geo.last, root) <= root.radius;
        if (!inside){
          /* יצאנו — מאפסים כדי שהביקור הבא יוכל להזכיר שוב (סעיף 58) */
          if (t.rt.arrivedAt || t.rt.firedAt || t.rt.ackAt){
            t.rt.arrivedAt = null; t.rt.firedAt = null; t.rt.ackAt = null; changed = true;
          }
          return;
        }
        if (!t.rt.arrivedAt){ t.rt.arrivedAt = now; changed = true; }
        if (t.rt.firedAt || t.rt.ackAt) return;
        if (t.rt.snoozeTo && now < t.rt.snoozeTo) return;
        if ((now - t.rt.arrivedAt)/60000 >= (r.delayMin || 0)) ready.push({ t, root });
      });

      if (ready.length){
        const byPlace = new Map();
        ready.forEach(x => {
          if (!byPlace.has(x.root.id)) byPlace.set(x.root.id, { root:x.root, list:[] });
          byPlace.get(x.root.id).list.push(x.t);
        });
        byPlace.forEach(g => {
          g.list.forEach(t => { t.rt.firedAt = now; t.rt.snoozeTo = null; });
          changed = true;
          if (g.list.length === 1){
            Alerts.fire(g.list[0], 'אתה ב' + g.root.name, 'place');
          } else {
            Alerts.fire({ id:'place_'+g.root.id, title:'אתה ב'+g.root.name, rt:{} },
                        g.list.length + ' משימות מחכות כאן', 'place');
          }
        });
      }
    }

    /* ------- אירועי יומן ------- */
    Store.all.events.forEach(ev => {
      if (ev.remindMin == null || ev.remindMin < 0) return;
      ev.rt = ev.rt || {};
      if (ev.rt.firedAt) return;
      if (ev.rt.snoozeTo && now < ev.rt.snoozeTo) return;
      const at = Cal.remindAt(ev);
      if (now >= at && now < at + 6*60*60*1000){
        ev.rt.firedAt = now; changed = true;
        if (ev.allDay){
          Alerts.fire(ev, ev.date === Plan.today() ? 'היום · כל היום'
                                                   : Plan.label(ev.date) + ' · כל היום', 'event');
        } else {
          const mins = Math.round((Cal.startMs(ev)-now)/60000);
          Alerts.fire(ev, mins > 0 ? `מתחיל בעוד ${mins} דקות (${ev.time})` : `מתחיל עכשיו (${ev.time})`, 'event');
        }
      }
    });

    /* ------- צ׳קליסט חד-פעמי עם שעה ------- */
    Store.all.tasks.forEach(t => {
      if (t.archived || t.done) return;
      (t.checklists || []).forEach(c => {
        if (c.repeat || !c.once || !c.once.date || !c.once.time) return;
        if (c.items.length && c.items.every(x => x.checked)) return;
        if (c.once.date !== Plan.today()) return;
        if (new Date().toTimeString().slice(0,5) < c.once.time) return;
        c.rt = c.rt || {};
        const key = c.once.date + '@' + c.once.time;
        if (c.rt.firedKey === key || Cal.atMs(c.once?.date||day,c.once?.time||hm)<=(c.rt.resumeAt||0)) return;
        c.rt.firedKey = key; changed = true;
        const left = c.items.filter(x => !x.checked).length;
        Alerts.fire({ id:'cl_'+t.id+'_'+c.id, title:c.name, rt:c.rt },
                    (left ? left + ' פריטים פתוחים' : 'צ׳קליסט') + ' · ' + t.title, 'task');
      });
    });

    /* ------- צ׳קליסטים חוזרים -------
       אותו מנוע חזרתיות של ההרגלים, כולל חריגים והתאמה סביב אירועים.
       מחזור שלא הושלם נשאר פתוח — חצות לא סוגר אותו. */
    Store.all.tasks.forEach(t => {
      if (t.archived || t.done) return;
      (t.checklists || []).forEach(c => {
        const rep = c.repeat;
        if (!rep || !Recur.times(rep).length) return;
        /* איפוס: שש שעות לפני המופע הבא, פעם אחת למחזור */
        if (Store.rollChecklist(t.id, c.id)) changed = true;
        if (Store.checklistCycleDone(c)) return;      /* המחזור נסגר מעצמו */
        const day = Store.checklistCycle(c);
        if (!day || day > Plan.today()) return;       /* המופע עוד לפנינו */
        const hm = Recur.times(rep).filter(h=>Cal.atMs(day,h)<=now).at(-1)||Recur.times(rep)[0];
        c.rt = c.rt || {};
        const ar = Recur.around(rep, day, hm);
        if (ar){
          const pKey = day + '@prep', aKey = day + '@after';
          if (now >= ar.after && ar.after>(c.rt.resumeAt||0) && c.rt.firedKey !== aKey){
            c.rt.firedKey = aKey; changed = true;
            Alerts.fire({ id:'cl_'+t.id+'_'+c.id, title:c.name, rt:c.rt },
                        'שים לב — היית אמור לעבור על זה · ' + t.title, 'task');
          } else if (now >= ar.prep && ar.prep>(c.rt.resumeAt||0) && now < ar.after &&
                     c.rt.firedKey !== pKey && c.rt.firedKey !== aKey){
            c.rt.firedKey = pKey; changed = true;
            Alerts.fire({ id:'cl_'+t.id+'_'+c.id, title:c.name, rt:c.rt },
                        'שים לב — יש לך אירוע בזמן הזה. תיערך בהתאם · ' + t.title, 'task');
          }
          return;
        }
        /* התזכורת נשארת רלוונטית גם אחרי חצות, כל עוד המחזור פתוח */
        if (Date.now() < Cal.atMs(day, hm)) return;
        const key = day + '@' + hm;
        if (c.rt.firedKey === key || Cal.atMs(c.once?.date||day,c.once?.time||hm)<=(c.rt.resumeAt||0)) return;
        c.rt.firedKey = key; changed = true;
        const left = c.items.filter(x => !x.checked).length;
        Alerts.fire({ id:'cl_'+t.id+'_'+c.id, title:c.name, rt:c.rt },
                    left ? left + ' פריטים פתוחים · ' + t.title : 'מחזור חדש · ' + t.title, 'task');
      });
    });

    /* ------- פריטי משאלות שיצאו ------- */
    const todayKey = Plan.today();
    Store.all.lists.forEach(l => {
      if (l.kind !== 'wish') return;
      l.items.forEach(it => {
        if (it.done || it.notified || !it.releaseDate) return;
        if (it.releaseDate <= todayKey){
          it.notified = true; changed = true;
          Alerts.fire({ id:'item_'+it.id, title:it.title, rt:{} },
                      'יצא היום — אפשר לקנות (' + l.name + ')', 'task');
        }
      });
    });

    if (changed) Store.commit();
  }
  /* start/stop סימטריים. stop קיים כדי שאפשר יהיה לבחון מסכים בלי
     שהתראה אמיתית תקפוץ באמצע ותכסה את מה שנבדק. */
  let timer = null;
  return { check,
    start(){ if (timer) clearInterval(timer); timer = setInterval(check, 20000); check(); },
    stop(){ if (timer){ clearInterval(timer); timer = null; } } };
})();

/* -------------------------------- boot ---------------------------------- */
