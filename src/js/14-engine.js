const Engine = (() => {
  function recurring(t,c,now){
    const rep=c?.repeat||t.repeat,today=Plan.today(),cycle=c?Store.checklistCycle(c):today,rt=c?(c.rt=c.rt||{}):(t.rt=t.rt||{});
    if(rt.snoozeTo&&now<rt.snoozeTo)return false;
    const days=new Set([Plan.shift(today,-1),today,Plan.shift(today,1),cycle].filter(Boolean)),ready=[];
    const completed=c?new Set(Store.completedChecklistCycles(t.id,c.id)):null;
    for(const day of days){
      if(!Recur.due(rep,day)||(c?(completed.has(day)||(Store.checklistCycleDone(c)&&day===cycle)):Store.habitFull(t,day)))continue;
      for(const hm of Recur.times(rep)){
        const ar=Recur.around(rep,day,hm),base=day+'@';
        const add=(stage,at,body)=>{const key=base+(stage==='normal'?'':stage+'@')+hm;
          if(at<=(rt.resumeAt||0)||rt.firedKey===key||rt.firedKeys?.[key]||c&&rt.firedKey===base+stage)return;
          ready.push({day,hm,stage,at,key,body});};
        if(ar){
          // Preparation is useful before the event starts, including the
          // previous evening. Never deliver a late preparation during it.
          if(now>=ar.prep&&now<Cal.startMs(ar.ev))add('prep',ar.prep,'שים לב — יש לך אירוע בזמן הזה. תיערך בהתאם.');
          if(now>=ar.after&&now<ar.after+6*3600000)add('after',ar.after,'שים לב — היית אמור לעשות את זה.');
        }else if(day===(c?cycle:today)&&Cal.atMs(day,hm)<=now){
          const more=Recur.times(rep).filter(x=>x>hm);
          add('normal',Cal.atMs(day,hm),c?(c.items.filter(x=>!x.checked).length+' פריטים פתוחים · '+t.title):'תזכורת יומית '+hm+(more.length?' · תזכורת נוספת ב-'+more[0]:''));
        }
      }
    }
    if(!ready.length)return false;
    ready.sort((a,b)=>a.at-b.at||a.key.localeCompare(b.key));const selected=ready.at(-1);
    rt.firedKeys=rt.firedKeys||{};for(const [key,at]of Object.entries(rt.firedKeys))if(now-at>7*86400000)delete rt.firedKeys[key];
    ready.forEach(x=>rt.firedKeys[x.key]=now);rt.firedKey=selected.key;
    const prefix=c?(selected.stage==='prep'?'cp_':selected.stage==='after'?'ca_':'c_'):(selected.stage==='prep'?'hp_':selected.stage==='after'?'ha_':'h_');
    const reminderId=prefix+t.id+(c?'_'+c.id:'')+'_'+selected.day+'@'+selected.hm;
    const meta={...ReminderLink.resolve(reminderId),reminderId};
    Alerts.fire(c?{id:'cl_'+t.id+'_'+c.id,title:c.name,rt}:t,selected.body,'task',meta);
    return true;
  }
  function check(){
    const now = Date.now();
    try{const rows=JSON.parse(localStorage.getItem('mesima.snoozes')||'[]'),due=rows.filter(x=>x.at<=now);if(due.length){localStorage.setItem('mesima.snoozes',JSON.stringify(rows.filter(x=>x.at>now)));due.filter(x=>!Store.reminderBlocked(x.meta||ReminderLink.resolve(x.id))).forEach(x=>Alerts.fire(Store.task(x.id)||{id:x.id,title:x.title,rt:{}},x.body,'task',x.meta));}}catch{}
    let changed = false;

    /* ------- משימות ------- */
    Store.all.tasks.forEach(t => {
      /* משימה יומית חוזרת: תזכורת אחת לכל שעה, רק בימי החובה,
         ורק אם עוד לא סימנת מספיק פעמים היום. */
      if (Store.isHabit(t) && !t.archived){
        if(recurring(t,null,now))changed=true;
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
        if (c.rt.firedKey === key || Cal.atMs(c.once.date,c.once.time)<=(c.rt.resumeAt||0)) return;
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
        if(recurring(t,c,now))changed=true;
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
