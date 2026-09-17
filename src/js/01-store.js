const Store = (() => {
  const KEY = 'mesima.v1';
  const seed = () => ({ v:5, tasks:[], places:[], lists:[], events:[], notes:[],
                        eventTypes:[], links:[], completions:[], reflections:[],
                        prefs:{ vib:true, snd:true, geo:false, notif:false, noteZoom:1 } });

  function localDay(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  let persist = true;
  try { localStorage.setItem('__t','1'); localStorage.removeItem('__t'); }
  catch(e){ persist = false; }

  let data;
  try {
    const raw = persist ? localStorage.getItem(KEY) : null;
    data = raw ? Object.assign(seed(), JSON.parse(raw)) : seed();
  } catch(e){ data = seed(); }
  function normalize(input){
    const data = Object.assign(seed(), input);
    for(const key of ['tasks','places','lists','events','notes','eventTypes','links','completions','reflections']){
      if(input[key] !== undefined && !Array.isArray(input[key])) throw new Error('מבנה גיבוי לא תקין');
      if(!Array.isArray(data[key])) data[key]=[];
      if(data[key].some(x=>!x || typeof x!=='object' || Array.isArray(x))) throw new Error('פריט פגום בגיבוי');
    }
    data.prefs = {...seed().prefs,...(data.prefs || {})};
  /* מיגרציות */
  if (!Array.isArray(data.events)) data.events = [];
  if (!data.prefs) data.prefs = seed().prefs;
  if (!data.prefs.noteZoom) data.prefs.noteZoom = 1;
  if (!Array.isArray(data.lists)) data.lists = [];
  if (!Array.isArray(data.notes)) data.notes = [];
  /* v2 -> v3: רשימת הקניות השטוחה הופכת לרשימה אחת מסוג "פשוט" */
  if (Array.isArray(data.shop) && data.shop.length){
    data.lists.unshift({
      id:'migrated-shop', name:'קניות', kind:'simple', forWho:'', phone:'',
      createdAt:Date.now(),
      items:data.shop.map(x=>({ id:x.id, title:x.title, where:x.where||'', link:'', img:'',
                                done:!!x.done, price:null, note:'', releaseDate:'', notified:false }))
    });
  }
  delete data.shop;
  /* הרגל שסומן "בוצע" נעלם מכל התצוגות ואי אפשר להחזיר אותו.
     זה קרה בגלל שכפתור "בוצע" בהתראה קרא ל-toggleTask. מרפאים למפרע. */
  data.tasks.forEach(t=>{
    if (t.repeat && t.repeat.times && t.repeat.times.length && t.done){
      t.done = false; t.doneAt = null; t.autoDone = false;
    }
  });
  data.tasks.forEach(t=>{ if(t.parentId===undefined) t.parentId=null;
                          if(t.planned===undefined) t.planned=null;
                          if(t.eventId===undefined) t.eventId=null;
                          if(t.note===undefined) t.note='';
                          if(t.repeat===undefined) t.repeat=null;
                          if(!t.log) t.log={}; });
  data.places.forEach(p=>{ if(p.parentId===undefined) p.parentId=null; });
  data.events.forEach(e=>{
    if (!['army','home','personal'].includes(e.cat)) e.cat = 'personal';
    if (e.note === undefined) e.note = '';
    if (e.taskIds !== undefined) delete e.taskIds;
    if (e.endDate === undefined) e.endDate = '';
    if (e.allDay === undefined) e.allDay = false;
    if (e.listId === undefined) e.listId = null;
    if (!e.end){                       /* גרסאות ישנות שמרו אורך בדקות */
      const [h,m] = (e.time||'09:00').split(':').map(Number);
      const t = h*60 + m + (e.mins || 60);
      e.end = String(Math.floor(t/60) % 24).padStart(2,'0') + ':' + String(t % 60).padStart(2,'0');
    }
  });
  /* ---------- v3 -> v4 (גרסה 2.0) ---------- */
  if (!Array.isArray(data.eventTypes)) data.eventTypes = [];
  if (!data.eventTypes.length){
    /* סוגי אירוע נולדים מהקטגוריות הישנות, ומכאן ואילך הם עצמאיים */
    data.eventTypes = [
      { id:'t_army', name:'צבא',  color:'#7aa2f7' },
      { id:'t_home', name:'בית',  color:'#e0a458' },
      { id:'t_pers', name:'אישי', color:'#b48ead' },
    ];
  }
  const CAT2TYPE = { army:'t_army', home:'t_home', personal:'t_pers' };
  data.events.forEach(e => {
    if (!e.typeId) e.typeId = CAT2TYPE[e.cat] || 't_pers';
  });

  data.tasks.forEach(t => {
    /* מחזור חיים: קצר-טווח (נגמר) מול ארוך-טווח (מיכל שלא נגמר מעצמו) */
    if (!['short','long','list','check'].includes(t.kind)) t.kind = 'short';
    /* ארכיון: כל מה שכבר סומן כבוצע עובר לארכיון ולא נעלם */
    if (t.archived === undefined){
      t.archived  = !!t.done;
      t.archivedAt = t.done ? (t.doneAt || Date.now()) : null;
    }
    if (t.autoArch === undefined) t.autoArch = false;
    /* הרגל הוא משימה רגילה — הוא לא "נגמר" ולכן לא מגיע לארכיון */
    if (t.repeat && t.repeat.times && t.repeat.times.length){
      t.archived = false; t.archivedAt = null; t.done = false; t.doneAt = null;
    }
  });
  /* ---------- v4 -> v5: פריט ארוך-טווח לא יכול להיות הרגל בעצמו ----------
     אם נשמר לו לוח חזרות, מעבירים אותו לתת-משימה קצרת-טווח אחת ומסמנים
     שהטיפול בוצע, כדי שטעינה חוזרת לא תיצור כפילויות. */
  data.tasks.slice().forEach(t => {
    if (t.kind !== 'long' || !t.repeat || !t.repeat.times || !t.repeat.times.length) return;
    if (!t.repeatMovedTo || !data.tasks.some(x => x.id === t.repeatMovedTo)){
      const child = {
        id: (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
        mission: t.mission, title: t.title, done:false, createdAt: Date.now(), doneAt:null,
        reminder:null, rt:{}, parentId: t.id, planned:null, eventId:null, note:'',
        repeat: t.repeat, log: t.log || {}, collapsed:true, kind:'short',
        archived:false, archivedAt:null, autoArch:false,
      };
      data.tasks.push(child);
      t.repeatMovedTo = child.id;
    }
    t.repeat = null; t.log = {};
  });
  /* ---------- v4 -> v5: פריט ברשימה הוא ישות קלה, וסדר מפורש לכל ילד ----------
     פריט אינו משימה: אין לו קטגוריה, תאריך, תזכורת, ארכיון או נוכחות ב"היום".
     תת-משימות קיימות נשארות תת-משימות — אפשר להמיר אותן ידנית לפריטים. */
  data.tasks.forEach((t, i) => {
    if (!Array.isArray(t.checklist)) t.checklist = [];
    t.checklist = t.checklist.filter(c => c && c.title).map(c => ({
      ...c, // Preserve repeat, once and runtime state across reloads.
      id: c.id || (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
      title: String(c.title), note: c.note || '', checked: !!c.checked }));
    if (typeof t.sortIndex !== 'number') t.sortIndex = i;
  });
  /* ---------- v5 -> v6: תמונה אחת לכל משימה, וסוג "רשימה" ----------
     `noteHidden` יצא משימוש ב-2.6 — הקיפול הוא מצב תצוגה בלבד. */
  data.tasks.forEach(t => { if (t.img === undefined) t.img = null; });
  /* ---------- v6 -> v7: "רשימה" מפסיקה להיות סוג משימה ----------
     היא הייתה שאלה של מימוש, לא שאלה של משתמש. שום נתון לא הולך לאיבוד:
     הפריטים, התת-משימות, ההרגלים, החזרה, התאריך והתמונה נשארים כפי שהם.
     רשימה שנשאה חזרה או תזכורת נשארת קצרת-טווח, כדי שהתזכורת תמשיך לעבוד
     בדיוק כמו קודם. אחרת היא הופכת למיכל ארוך-טווח, שזה מה שהיא באמת. */
  /* ---------- v7 -> v8: כמה צ׳קליסטים בעלי שם באותה משימה ----------
     הפריטים הקיימים עוברים כמו שהם לצ׳קליסט אחד — אותם מזהים, שמות,
     הערות, סימונים וסדר. השדה הישן נמחק אחרי ההעברה, ולכן טעינה חוזרת
     לא יכולה ליצור עותק שני. */
  data.tasks.forEach(t => {
    if (!Array.isArray(t.checklists)){
      const old = Array.isArray(t.checklist) ? t.checklist : [];
      t.checklists = old.length
        ? [{ id: (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
             name:'צ׳קליסט', items: old }]
        : [];
    }
    delete t.checklist;
    t.checklists = t.checklists.filter(c => c && Array.isArray(c.items)).map(c => ({
      ...c, // Preserve repeat, once and runtime state across reloads.
      id: c.id || (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
      name: String(c.name || 'צ׳קליסט'),
      items: c.items.filter(x => x && x.title).map(x => ({
        id: x.id || (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
        title: String(x.title), note: x.note || '', checked: !!x.checked })),
    }));
  });
  data.tasks.forEach(t => {
    if (t.kind !== 'list') return;
    const ticks = !!(t.repeat && t.repeat.times && t.repeat.times.length);
    const timed = !!(t.reminder && t.reminder.type);
    t.kind = (ticks || timed) ? 'short' : 'long';
  });
  /* ---------- v8 -> v9: חריגים, התאמה סביב אירועים, וצ׳קליסט חוזר ----------
     שלושת אלה נשמרים על האובייקטים הקיימים ולא במודל שני. פריט חוזר הוא
     עדיין משימה עם repeat, בדיוק כמו קודם. */
  data.tasks.forEach(t => {
    if (t.repeat && Array.isArray(t.repeat.times)){
      if (!Array.isArray(t.repeat.skipTypes)) t.repeat.skipTypes = [];
      if (t.repeat.skipScope !== 'week') t.repeat.skipScope = 'day';
      if (typeof t.repeat.around !== 'boolean') t.repeat.around = false;
    }
    /* פריט חוזר הוא פעולה אטומית: אין בו תת-משימות, צ׳קליסטים או הרגלים.
       תוכן שנשמר בעבר לא נמחק — הוא משתחרר החוצה כדי שלא ייעלם. */
    (t.checklists || []).forEach(c => {
      if (!c.repeat) { c.repeat = null; return; }
      if (!Array.isArray(c.repeat.days)) c.repeat.days = [];
      if (!c.repeat.time) c.repeat.time = '20:00';
      if (typeof c.repeat.resetMin !== 'number') c.repeat.resetMin = 360;
      if (!Array.isArray(c.repeat.skipTypes)) c.repeat.skipTypes = [];
      if (c.repeat.skipScope !== 'week') c.repeat.skipScope = 'day';
    });
  });
  /* משימה חוזרת שהחזיקה תוכן — התוכן עובר החוצה ולא נמחק */
  data.tasks.forEach(t => {
    const rep = t.repeat && t.repeat.times && t.repeat.times.length;
    if (!rep || t.kind === 'long') return;
    const kids = data.tasks.filter(x => x.parentId === t.id);
    kids.forEach(k => { k.parentId = t.parentId || null; });
    if ((t.checklists || []).length && t.parentId){
      const host = data.tasks.find(x => x.id === t.parentId);
      if (host){ host.checklists = (host.checklists||[]).concat(t.checklists); t.checklists = []; }
    }
  });
  /* ---------- v8 -> v9: "חד-פעמית" חייבת להיות פעם אחת ----------
     תזכורת שעה בלי תאריך נרשמה עד כה בכל יום מחדש. מצמידים לה את
     המופע הקרוב — היום אם השעה עוד לפנינו, אחרת מחר. */
  (() => {
    const p2 = x => String(x).padStart(2,'0');
    const k = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
    const today = k(new Date());
    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate()+1); return k(d); })();
    const nowHM = new Date().toTimeString().slice(0,5);
    data.tasks.forEach(t => {
      if (t.kind === 'long') return;
      if (t.repeat && t.repeat.times && t.repeat.times.length) return;
      if (!t.reminder || t.reminder.type !== 'time') return;
      if (t.planned) return;
      t.planned = (t.reminder.at > nowHM) ? today : tomorrow;
    });
  })();
  data.v = 9;

  /* ---------- v9 -> v10: מיכל, פריט חוזר, ומחזור צ׳קליסט ----------
     שום תוכן לא נמחק כאן. מה שמיכל כבר לא רשאי להחזיק עובר ל-t.parked
     ונשאר בנתונים; מה שחסר בשדות חדשים מקבל ברירת מחדל בטוחה. */
  if (!Array.isArray(data.links)) data.links = [];
  data.links = data.links.filter(l => l && l.url).map(l => ({
    id: l.id || (Date.now().toString(36) + Math.random().toString(36).slice(2,7)),
    name: String(l.name || l.url), url: String(l.url),
  }));

  data.tasks.forEach(t => {
    if (t.parked === undefined) t.parked = null;
    (t.checklists || []).forEach(c => {
      if (c.repeat){
        /* נקודת האיפוס אינה נשאלת יותר — היא קבועה על שש שעות */
        c.repeat.resetMin = 360;
        if (typeof c.repeat.around !== 'boolean') c.repeat.around = false;
        if (!Array.isArray(c.repeat.skipTypes)) c.repeat.skipTypes = [];
        if (c.repeat.skipScope !== 'week') c.repeat.skipScope = 'day';
        if (!c.rt || typeof c.rt !== 'object') c.rt = { cycle:'', doneAt:null };
        if (c.rt.doneAt === undefined) c.rt.doneAt = null;
      } else {
        /* צ׳קליסט רגיל נשאר רגיל — חזרתיות נדלקת רק במפורש */
        c.repeat = null;
      }
      if (c.once === undefined) c.once = null;
    });
  });

  /* מיכל אינו נושא תאריך, שעה, תזכורת או קישור לאירוע. הערכים לא
     נמחקים — הם נשמרים ב-parked כדי שאפשר יהיה לראות ולשחזר. */
  data.tasks.forEach(t => {
    if (t.kind !== 'long') return;
    const had = t.planned || t.reminder || t.repeat || t.eventId;
    if (had && !t.parked){
      t.parked = { planned:t.planned || null, reminder:t.reminder || null,
                   repeat:t.repeat || null, eventId:t.eventId || null, at:Date.now() };
    }
    t.planned = null; t.reminder = null; t.repeat = null; t.log = {};
  });

  /* מיכל בתוך מיכל אסור בכל עומק. הילד נשאר במקומו ורק הופך לקצר-טווח. */
  (() => {
    const byId = new Map(data.tasks.map(t => [t.id, t]));
    const underLong = t => {
      let p = t.parentId ? byId.get(t.parentId) : null, g = 0;
      while (p && g++ < 16){
        if (p.kind === 'long') return true;
        p = p.parentId ? byId.get(p.parentId) : null;
      }
      return false;
    };
    data.tasks.forEach(t => { if (t.kind === 'long' && underLong(t)) t.kind = 'short'; });
  })();

  data.tasks.forEach(t => {
    const ids = [...new Set([t.parentId, ...(Array.isArray(t.parentIds)?t.parentIds:[])].filter(Boolean))];
    t.parentIds = ids.filter(id => id!==t.id && data.tasks.some(p=>p.id===id && (id===t.parentId || p.kind==='long')));
    t.parentId = t.parentIds[0] || null;
  });
  if((input.v || 0)<12){
    const put=(t,day,at,kind,occurrence)=>{
      const id=kind+':'+t.id+':'+occurrence;
      if(!data.completions.some(x=>x.id===id)) data.completions.push({id,taskId:t.id,kind,occurrence,day,at,title:t.title,active:true,legacy:true,
        projects:(t.parentIds||[]).map(id=>data.tasks.find(p=>p.id===id)).filter(Boolean).map(p=>({id:p.id,title:p.title}))});
    };
    for(const t of data.tasks){
      if(t.done && t.doneAt && t.kind!=='long'){const d=new Date(t.doneAt);put(t,localDay(d),t.doneAt,'task','once');}
      for(const [day,value] of Object.entries(t.log||{})) if(value) put(t,day,null,'habit',day);
    }
  }
  for(const t of data.tasks) for(const c of t.checklists||[]) if(!c.cycleDay && c.rt?.cycle) c.cycleDay=c.rt.cycle;
  // Per-occurrence history is authoritative when two devices changed different days.
  for(const r of data.completions){
    if(r.legacy)continue;const t=data.tasks.find(t=>t.id===r.taskId);if(!t)continue;
    if(r.kind==='habit'){t.log=t.log||{};if(r.active)t.log[r.occurrence]=1;else delete t.log[r.occurrence];}
    if(!r.active&&r.revokedAt){t.rt=t.rt||{};t.rt.resumeAt=Math.max(t.rt.resumeAt||0,r.revokedAt);}
    if(r.kind==='task'){t.done=!!r.active;t.doneAt=r.active?r.at:null;}
  }
  for(const t of data.tasks)if(t.kind==='check'&&t.checklists?.[0]?.repeat){t.done=false;t.doneAt=null;}
  data.v = 12;

    return data;
  }
  data=normalize(data);

  const subs = [];
  let batching = false;
  const save = () => {
    if(batching) return;
    if (persist) { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch(e){ persist = false; } }
    subs.forEach(f => f());
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

  return {
    get canPersist(){ return persist; },
    get all(){ return data; },
    onChange(f){ subs.push(f); },
    commit: save,
    transaction(fn){
      if(batching) return fn();
      const before=JSON.stringify(data);batching=true;
      try {const result=fn();batching=false;save();return result;}
      catch(e){data=JSON.parse(before);batching=false;throw e;}
    },

    tasks(m){ return data.tasks.filter(t => t.mission === m && !t.archived && !t.done); },
    /** כל המשימות הפעילות, אופציונלית מסוננות לפי קטגוריה. 'all' = הכול */
    active(cat){ return data.tasks.filter(t => !t.archived && !t.done && (!cat || cat==='all' || t.mission===cat)); },
    task(id){ return data.tasks.find(t => t.id === id); },
    /** ילדים ישירים של משימה. null = משימות שורש. */
    parentIds(t){ return [...new Set([t?.parentId,...(t?.parentIds||[])].filter(Boolean))]; },
    parentsOf(t){ return this.parentIds(t).map(id=>this.task(id)).filter(Boolean); },
    belongs(t,id){ return id ? this.parentIds(t).includes(id) : !this.parentIds(t).length; },
    ownedDescendants(id, includeArchived=false){
      const owned=new Set([id]); let changed=true;
      while(changed){ changed=false; this.all.tasks.forEach(t=>{
        const ps=this.parentIds(t); if(!owned.has(t.id)&&ps.length&&ps.every(p=>owned.has(p)||(includeArchived&&this.task(p)?.archived))){owned.add(t.id);changed=true;}
      });} return this.all.tasks.filter(t=>t.id!==id&&owned.has(t.id));
    },
    children(parentId, mission){
      return data.tasks.filter(t => this.belongs(t,parentId) && !t.archived && !t.done &&
                                    (mission == null || mission === 'all' || t.mission === mission));
    },
    /** ילדים כולל מאורכבים — לתצוגת עץ בארכיון */
    childrenAll(parentId){ return data.tasks.filter(t => this.belongs(t,parentId)); },
    /** כל הצאצאים לכל עומק — לספירה ולמחיקה רקורסיבית */
    descendants(id){
      const out = [];
      const walk = pid => data.tasks.forEach(t => { if (t.parentId === pid){ out.push(t); walk(t.id); } });
      walk(id); return out;
    },
    depth(id){
      let d = 0, t = this.task(id);
      while (t && t.parentId){ d++; t = this.task(t.parentId); }
      return d;
    },
    addTask(o){
      const t = { id:uid(), mission:o.mission, title:o.title, done:false,
        createdAt:Date.now(), doneAt:null, reminder:o.reminder||null, rt:o.rt||{},
        parentId:o.parentId||null, parentIds:o.parentId?[o.parentId]:[], planned:o.planned||null, eventId:o.eventId||null,
        note:o.note||'', repeat:o.repeat||null, log:{}, collapsed:true,
        kind:['long','check'].includes(o.kind) ? o.kind : 'short',
        img:o.img||null, archived:false, archivedAt:null, autoArch:false,
        checklists:[], parked:null, sortIndex:0 };
      /* מיכל בתוך מיכל אסור בכל עומק, ותת-משימה לעולם אינה מיכל.
         ילד הוא תמיד קצר-טווח, ולכן גם לא נשאלת עליו השאלה בממשק. */
      if (t.kind === 'long' && (t.parentId || !this.canBeLong(null, t.parentId))) t.kind = 'short';
      /* משימת צ׳קליסט היא עלה: היא לא נתלית על אף אחד ולא נושאת מיקום */
      if (t.kind === 'check'){
        t.parentId = null; t.parentIds=[];
        if (t.reminder && t.reminder.type !== 'time') t.reminder = null;
      }
      if (t.kind === 'long'){
        t.parked = this.parkSchedule(t);
        t.reminder = null; t.repeat = null; t.planned = null;
      }
      /* תת-משימה יורשת את המשימה-על של ההורה, אחרת היא נעלמת מהתצוגה */
      if (t.parentId){
        let p = this.task(t.parentId);
        /* פריט חוזר הוא פעולה אטומית ולא מחזיק תוכן. אם מישהו מנסה לתלות
           בו משהו, הפריט נתלה על ההורה שלו ולא נעלם בשקט. */
        let guard = 0;
        while (p && !this.canHoldContent(p) && guard++ < 8){
          t.parentId = p.parentId || null;
          p = t.parentId ? this.task(t.parentId) : null;
        }
        if (p) t.mission = p.mission;
      }
      /* משימה חדשה נכנסת למקום שהעין מחפשת: שורש בראש, תת-משימה בסוף הרשימה */
      t.sortIndex = (typeof o.sortIndex === 'number') ? o.sortIndex : this.freeIndex(t);
      data.tasks.unshift(t); save(); return t;
    },
    /** מיקום פנוי בקצה הנכון של הקבוצה שאליה הפריט שייך */
    freeIndex(t){
      /* משימה ראשית נכנסת לראש הרצף הגלובלי — יש רצף אחד, לא אחד לקטגוריה */
      const sibs = t.parentId ? this.childrenAll(t.parentId)
                              : data.tasks.filter(x => !x.parentId);
      const idx = sibs.filter(x => x.id !== t.id).map(x => x.sortIndex || 0);
      if (!idx.length) return 0;
      return t.parentId ? Math.max(...idx) + 1 : Math.min(...idx) - 1;
    },
    updateTask(id, patch){
      const t=this.task(id); if(!t) return;
      const rt = patch.rt;              /* אפשר לקבוע rt מפורש — למשל "אל תירה היום" */
      const wasLong = t.kind === 'long';
      Object.assign(t, patch);
      t.rt = rt || {};
      /* אותם שני חוקים שנאכפים ביצירה נאכפים גם בעריכה, כדי שלא תיווצר
         דרך עוקפת דרך הטופס. */
      if (t.kind === 'long' && (t.parentId || !this.canBeLong(t.id, t.parentId))) t.kind = 'short';
      if (t.kind === 'check'){
        t.parentId = null; t.parentIds=[];
        if (t.reminder && t.reminder.type !== 'time') t.reminder = null;
        t.repeat = null;                 /* החזרתיות יושבת על הצ׳קליסט */
      }
      if (t.kind === 'long'){
        if (!wasLong) t.parked = this.parkSchedule(t);
        t.reminder = null; t.repeat = null; t.planned = null;
        t.log = {};
      }
      if(patch.checklists)for(const c of t.checklists||[])this.reconcileChecklist(id,c);
      save();
    },
    setPlanned(id, date){
      const t=this.task(id); if(!t) return;
      if (t.kind === 'long') return;    /* מיכל לא נושא תאריך */
      t.planned=date; save();
    },
    toggleCollapse(id){ const t=this.task(id); if(t){ t.collapsed=!t.collapsed; save(); } },
    /** משימות שתוכננו ליום מסוים */
    plannedFor(date){ return data.tasks.filter(t => t.planned === date && !t.archived && !t.done && !this.isHabit(t)); },
    /** משימות שקושרו לאירוע */
    tasksForEvent(eventId){ return data.tasks.filter(t => t.eventId === eventId && !t.archived && !t.done); },
    linkTask(taskId, eventId){
      const t = this.task(taskId); if(!t) return;
      
      t.eventId = eventId || null;
      const ev = eventId ? this.event(eventId) : null;
      if (ev && t.kind !== 'long' && !t.planned) t.planned = ev.date;   /* נוח: המשימה נוחתת ביום האירוע */
      save();
    },
    /* ---------- הרגל יומי ----------
       t.repeat = { days:[0..6], times:['08:00','16:00'] }
       t.log    = { '2026-08-26': 1 }  — קיום המפתח = היום סומן */
    /* פריט ארוך-טווח לעולם אינו הרגל בעצמו — ההרגל הוא תת-משימה שלו.
       הבדיקה מגנה גם על נתונים ישנים שנשמרו לפני התיקון. */
    isHabit(t){ return !!(t && t.kind !== 'long' &&
                          t.repeat && t.repeat.times && t.repeat.times.length); },
    habitDay(t, date){ return Recur.active(t.repeat, date); },
    /* ---------- חריגים לפי סוג אירוע ----------
       cfg = { skipTypes:[מזהי סוג], skipScope:'day'|'week' }
       שומרים מזהים ולא שמות, כדי ששינוי שם של סוג אירוע לא ישבור כלום.
       יום שדולג עליו אינו "יום חובה" — ולכן הוא לא שובר רצף ולא מזכיר. */
    /* חזרתיות היא מנוע אחד. Store רק מפנה אליו, כדי שלא תיווצר
       סמנטיקה שנייה להרגל מול צ׳קליסט חוזר. */
    skipDates(cfg, date){ return Recur.skipped(cfg, date); },
    /** האם ההרגל נדרש בתאריך הזה: יום פעיל, ובלי חריג */
    habitRequired(t, date){
      return this.isHabit(t) && Recur.due(t.repeat, date);
    },
    /** האם קיים חריג פעיל היום — כדי שה-UI יסביר למה ההרגל שקט */
    habitSkipped(t, date){
      return this.isHabit(t) && Recur.active(t.repeat, date) && Recur.skipped(t.repeat, date);
    },
    /** פריט חוזר הוא פעולה אטומית: בלי תת-משימות, צ׳קליסטים או הרגלים */
    canHoldContent(t){ return !!t && !this.isHabit(t) && t.kind !== 'check'; },
    /* השעות הן ניסיונות חוזרים על אותה משימה, לא שלבים:
       סימון אחד סוגר את היום ומשתיק את השעות שנותרו. */
    habitFull(t, date){ return !!(t.log && t.log[date]); },
    tickHabit(id, date, at=Date.now()){
      const t = this.task(id); if(!t || !this.isHabit(t)) return null;
      t.log = t.log || {};
      this.recordCompletion(t,'habit',date,date,at);
      t.log[date] = 1;
      t.rt = t.rt || {};
      save();
      return { full:true, streak:this.streak(id) };
    },
    untickHabit(id, date){
      const t = this.task(id); if(!t) return;
      if (t.log) delete t.log[date];
      this.revokeCompletion('habit:'+id+':'+date);
      t.rt=t.rt||{};t.rt.resumeAt=Date.now();
      save();
    },
    /** ימים ברצף. יום שאינו יום-חובה נדלג עליו ולא שובר. */
    streak(id){
      const t = this.task(id); if(!t || !this.isHabit(t)) return 0;
      let n = 0, k = Plan.today(), first = true, guard = 0;
      while (guard++ < 400){
        /* יום שדולג עליו בגלל חריג מתנהג כמו יום שאינו יום-חובה:
           הוא לא נספר, והוא גם לא שובר את הרצף. */
        if (this.habitRequired(t, k)){
          if (this.habitFull(t, k)) n++;
          else if (!first) break;          /* היום עוד לא נגמר — לא שובר */
        }
        first = false;
        k = Plan.shift(k, -1);
      }
      return n;
    },
    habitsFor(date){
      return data.tasks.filter(t => this.isHabit(t) && !t.archived && !t.done && this.habitRequired(t, date));
    },

    /**
     * סימון ✓ בתצוגה. להרגל זה סימון יומי; לכל השאר זה סיום — והמשימה
     * עוברת מיד לארכיון, כפי שדורש סעיף 25 באפיון.
     */
    toggleTask(id, date){
      const t = this.task(id); if(!t) return;
      if (this.isHabit(t)){
        const d = date || Plan.today();
        if (this.habitFull(t, d)) this.untickHabit(id, d); else this.tickHabit(id, d);
        return;
      }
      if(t.done) this.undoCompletion(id); else this.finishTask(id);
    },

    /* ---------- מחזור חיים וארכיון (2.0) ---------- */
    isLong(t){ return !!t && t.kind === 'long'; },
    /**
     * משימת צ׳קליסט: המשימה *היא* הרשימה. יש לה בדיוק צ׳קליסט אחד,
     * ואין לה מיקום, נסיעה או תת-משימות — היא לא אירוע במרחב ולא עץ.
     * חד-פעמית עוברת לארכיון כשמסמנים את הפריט האחרון; רב-פעמית מקבלת
     * את אותו מנוע חזרתיות של הרגל.
     */
    isCheck(t){ return !!t && t.kind === 'check'; },
    /** הצ׳קליסט של משימת צ׳קליסט — תמיד הראשון, ותמיד קיים */
    ownChecklist(id){
      const t = this.task(id);
      if (!t || t.kind !== 'check') return null;
      if (!Array.isArray(t.checklists)) t.checklists = [];
      if (!t.checklists.length){ this.forceChecklist(id, t.title); }
      return t.checklists[0] || null;
    },
    /** יצירה שעוקפת את איסור התוכן, כי כאן הצ׳קליסט הוא המשימה עצמה */
    forceChecklist(id, name){
      const t = this.task(id); if(!t) return null;
      if (!Array.isArray(t.checklists)) t.checklists = [];
      const c = { id:uid(), name:String(name||'').trim() || 'צ׳קליסט', items:[], repeat:null };
      t.checklists.push(c); save(); return c;
    },
    /** האם משימת הצ׳קליסט חוזרת */
    checkRepeats(t){
      const c = t && t.kind === 'check' && (t.checklists||[])[0];
      return !!(c && c.repeat && Recur.times(c.repeat).length);
    },
    /** נשאר רק בשביל נתונים ישנים; המיגרציה ל-v7 כבר ניקתה אותם. */
    isList(t){ return !!t && t.kind === 'list'; },

    /**
     * סיום משימה קצרת-טווח. המשמעות היא "אני מחשיב את כל הדבר הזה כגמור",
     * ולכן כל העץ עובר לארכיון — גם אם נשארו בו תת-משימות פתוחות.
     * המצב הפנימי של הילדים נשמר כדי שהשחזור יחזיר את התמונה המדויקת.
     */
    recordCompletion(t,kind,occurrence,day=localDay(),at=Date.now(),cl=null){
      const id=kind+':'+t.id+':'+(cl?cl.id+':':'')+occurrence;
      const old=data.completions.find(r=>r.id===id);
      if(old?.active) return old;
      const row={id,taskId:t.id,checklistId:cl?.id||null,kind,occurrence,day,at,
        legacy:false,title:cl?(t.kind==='check'?t.title:cl.name):t.title,
        projects:[...(t.kind==='long'?[t]:[]),...this.parentsOf(t)].map(p=>({id:p.id,title:p.title})),active:true};
      if(old)Object.assign(old,row);else data.completions.push(row);return row;
    },
    revokeCompletion(id){const r=data.completions.find(x=>x.id===id);if(r){r.active=false;r.revokedAt=Date.now();}},
    reminderBlocked(meta){
      if(!meta?.taskId)return false;const t=this.task(meta.taskId);if(!t||t.archived||t.done)return true;
      if(this.isHabit(t)&&this.habitFull(t,meta.day||Plan.today()))return true;
      if(meta.checklistId){const c=this.checklistOf(t.id,meta.checklistId);if(!c)return true;
        const occurrence=meta.occurrence||meta.day||this.checklistOccurrence(c);
        return c.items.length>0&&c.items.every(i=>i.checked)&&occurrence===this.checklistOccurrence(c);
      }return false;
    },
    completionsFor(day){return data.completions.filter(x=>x.active&&x.day===day).sort((a,b)=>(a.at||0)-(b.at||0)||a.id.localeCompare(b.id));},
    reflection(kind,key){return data.reflections.find(x=>x.id===kind+':'+key)?.text||'';},
    setReflection(kind,key,text){
      if(!['day','week'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(key))throw Error('תאריך סיכום לא תקין');
      const id=kind+':'+key,row=data.reflections.find(x=>x.id===id);
      if(row?.text===text)return;
      if(row)Object.assign(row,{text,updatedAt:Date.now()});else data.reflections.push({id,kind,date:key,text,updatedAt:Date.now()});save();
    },
    finishTask(id,at=Date.now(),day=localDay(new Date(at))){
      const t=this.task(id);if(!t)return;
      if(this.isHabit(t)){this.tickHabit(id,day,at);return;}
      if(t.kind==='long'){this.closeProject(id);return;}
      if(t.done)return;
      t.done=!(t.kind==='check'&&this.checkRepeats(t));t.doneAt=t.done?at:null;
      if(t.kind!=='check')this.recordCompletion(t,'task','once',day,at);
      else for(const c of t.checklists||[]){c.items.forEach(i=>i.checked=true);this.reconcileChecklist(id,c,at,day);}
      save();
    },
    undoCompletion(id){
      const t=this.task(id);if(!t)return;
      t.done=false;t.doneAt=null;t.rt=t.rt||{};t.rt.resumeAt=Date.now();
      this.revokeCompletion('task:'+id+':once');
      if(t.kind==='check')for(const c of t.checklists||[]){c.items.forEach(i=>i.checked=false);this.reconcileChecklist(id,c);}
      save();
    },
    /** Archive is an explicit action; it never claims unfinished children were completed. */
    closeProject(id){
      const t=this.task(id);if(!t)return;
      t.archived=true;t.archivedAt=Date.now();t.autoArch=false;
      this.ownedDescendants(id,true).forEach(c=>{if(!c.archived){c.archived=true;c.archivedAt=t.archivedAt;c.autoArch=true;}});save();
    },
    relatedTasks(id){return data.tasks.filter(t=>t.id!==id&&((this.task(id)?.relatedTaskIds||[]).includes(t.id)||(t.relatedTaskIds||[]).includes(id)));},
    setRelatedTasks(id,ids){
      const t=this.task(id);if(!t)return;
      const wanted=[...new Set(ids)].filter(x=>x!==id&&this.task(x));t.relatedTaskIds=wanted;
      for(const other of data.tasks)if(!wanted.includes(other.id)&&other.relatedTaskIds?.includes(id))other.relatedTaskIds=other.relatedTaskIds.filter(x=>x!==id);
      save();
    },
    /**
     * מעבר לארוך-טווח. מיכל הוא מיכל: אין לו זמן, מיקום, נסיעה, תאריך,
     * חזרה או קישור לאירוע. מה שהיה נשמר ב-t.parked ולא נמחק, כדי
     * שהחזרה לקצר-טווח תוכל להחזיר אותו ושום נתון לא ייעלם בשקט.
     */
    makeLong(id){
      const t = this.task(id); if(!t) return;
      if (t.kind !== 'long') t.parked = this.parkSchedule(t);
      t.kind = 'long';
      t.reminder = null; t.repeat = null; t.planned = null;
      t.log = {}; t.rt = {};
      save();
    },
    /** צילום של כל מה שמיכל לא רשאי להחזיק */
    parkSchedule(t){
      const has = t.planned || t.reminder || t.repeat || t.eventId;
      if (!has) return null;
      return { planned:t.planned || null, reminder:t.reminder || null,
               repeat:t.repeat || null, eventId:t.eventId || null, at:Date.now() };
    },
    /** האם למשימה מותר להיות ארוכת-טווח: אסור מיכל בתוך מיכל, בכל עומק */
    canBeLong(id, parentId){
      const pid = parentId !== undefined ? parentId
                : (this.task(id) || {}).parentId;
      let p = pid ? this.task(pid) : null, guard = 0;
      while (p && guard++ < 16){
        if (p.kind === 'long') return false;
        p = p.parentId ? this.task(p.parentId) : null;
      }
      return true;
    },

    /** החזרה מהארכיון — המשימה וכל מה שאורכב יחד איתה */
    restoreTask(id){
      const t = this.task(id); if(!t) return;
      if(!t.archived){this.undoCompletion(id);return;}
      t.archived = false; t.archivedAt = null; t.done = false; t.doneAt = null; t.autoArch = false;
      /* שחזור משימת צ׳קליסט מנקה את הסימונים — אחרת היא הייתה חוזרת
         מלאה ומיד נסגרת שוב בסימון הבא. */
      if (t.kind === 'check') (t.checklists || []).forEach(c =>
        c.items.forEach(x => { x.checked = false; }));
      this.ownedDescendants(id,true).forEach(c => {
        if (c.autoArch){ c.archived = false; c.archivedAt = null; c.autoArch = false; }
      });
      /* אב מאורכב היה מסתיר את המשימה המשוחזרת */
      let p = t.parentId ? this.task(t.parentId) : null, guard = 0;
      while (p && guard++ < 12){
        if (p.archived){ p.archived = false; p.archivedAt = null; p.done = false; p.doneAt = null; }
        p = p.parentId ? this.task(p.parentId) : null;
      }
      save();
    },
    /* ---------- רשימה לשימוש חוזר ----------
       "רשימה" היא לא ישות חדשה — זו משימה עם תת-משימות. איפוס מחזיר את
       הפריטים שסומנו למצב פעיל, בלי לשכפל ובלי למחוק היסטוריה גלובלית.
       הפונקציה טהורה ומקבלת מזהה בלבד, כך שאיפוס אוטומטי בעתיד
       (כל יום ראשון, כל שבוע) יוכל לקרוא לה בלי שינוי נוסף. */

    /** כמה פריטים ברשימה מסומנים כרגע — רק הם מתאפסים */
    resettableCount(id, clId){
      return this.checklist(id, clId).filter(x => x.checked).length;
    },
    /** האם יש כאן רשימת פריטים */
    hasChecklist(id){ return this.checklists(id).length > 0; },

    /**
     * מחזיר את כל צאצאי המשימה למצב פעיל, לכל עומק.
     * שם, הערה, מבנה, תזכורות והיררכיה נשארים בדיוק כפי שהם.
     * הרגלים לא מושפעים — הם ממילא לא מסומנים כגמורים.
     */
    /**
     * מאפס פריטי רשימה בלבד.
     * פריט ותת-משימה הם שני דברים שונים: פריט הוא סימון, תת-משימה היא
     * עבודה שנעשתה. איפוס הרשימה לא מחזיר לחיים תת-משימות שהסתיימו,
     * לא מוציא מהארכיון ולא נוגע בהרגלים.
     */
    resetChecklist(id, clId){
      const t = this.task(id); if(!t) return 0;
      let n = 0;
      /* שם, הערה וסדר נשמרים בדיוק. רק הסימון יורד. */
      this.checklist(id, clId).forEach(it => { if (it.checked){ it.checked = false; n++; } });
      for(const c of this.checklists(id).filter(c=>!clId||c.id===clId)){
        if(c.repeat) this.reconcileChecklist(id,c);
        else {c.manualCycle=(c.manualCycle||0)+1;c.rt={};}
      }
      if(t.kind==='check'){t.done=false;t.doneAt=null;}
      t.lastResetAt = Date.now();
      save();
      return n;
    },

    /* ================= פריטי רשימה =================
       פריט חי בתוך המשימה עצמה: { id, title, note, checked }.
       הוא לא משימה: אין לו סוג, קטגוריה, תאריך, תזכורת, מיקום, נסיעה,
       חזרה, תת-פריטים, רשומת ארכיון או נוכחות במסך "היום".
       פריט מסומן נשאר גלוי — הערך שלו הוא לראות מה כבר נארז. */
    /* ---- צ׳קליסטים: משימה יכולה להחזיק כמה, כל אחד עם שם משלו ----
       "ציוד לקחת" ו"דברים לבדוק" הם שני דברים שונים, ולא ערבוב אחד.
       פריט נשאר ישות קלה: שם, הערה קצרה וסימון. */
    checklists(id){
      const t = this.task(id); if(!t) return [];
      if (!Array.isArray(t.checklists)) t.checklists = [];
      return t.checklists;
    },
    checklistOf(id, clId){
      return this.checklists(id).find(c => c.id === clId) || null;
    },
    /** פריטים. עם clId — של צ׳קליסט אחד; בלעדיו — כל הפריטים במשימה. */
    checklist(id, clId){
      const ls = this.checklists(id);
      if (clId){ const c = ls.find(x => x.id === clId); return c ? c.items : []; }
      return ls.reduce((acc, c) => acc.concat(c.items), []);
    },
    checklistStats(id, clId){
      const l = this.checklist(id, clId);
      return { total:l.length, checked:l.filter(x => x.checked).length };
    },
    addChecklist(id, name){
      const t = this.task(id); if(!t) return null;
      /* פריט חוזר הוא פעולה אטומית — הוא לא מחזיק תוכן */
      if (!this.canHoldContent(t)) return null;
      if (!Array.isArray(t.checklists)) t.checklists = [];
      const c = { id:uid(), name:String(name || '').trim() || 'צ׳קליסט', items:[], repeat:null };
      t.checklists.push(c); save(); return c;
    },
    /* ---------- צ׳קליסט חוזר ----------
       אותו אובייקט חוזר במחזורים. לא נוצר עותק חדש בכל שבוע: המחזור
       הפתוח נשאר פתוח עד שמסמנים, ולפני המופע הבא הסימונים מתאפסים. */
    /** תזכורת אחת לצ׳קליסט חד-פעמי: תאריך ושעה, ותו לא */
    setChecklistOnce(id, clId, at){
      const c = this.checklistOf(id, clId); if(!c) return false;
      c.once = (at && at.date && at.time) ? { date:at.date, time:at.time } : null;
      c.rt = c.rt || {};
      c.rt.firedKey = '';
      save(); return true;
    },
    setChecklistRepeat(id, clId, rep){
      const c = this.checklistOf(id, clId); if(!c) return false;
      c.repeat = rep ? {
        days: (rep.days || []).slice(),
        time: rep.time || rep.times?.[0] || '20:00',
        times:rep.times?.length?rep.times.slice():[rep.time||'20:00'],
        /* נקודת האיפוס קבועה: שש שעות לפני המופע הבא. השדה נשאר בנתונים
           כדי שרשומות ישנות ייטענו, אבל הוא כבר לא נשאל ולא משתנה. */
        resetMin: Recur.RESET_MIN,
        skipTypes: (rep.skipTypes || []).slice(),
        skipScope: rep.skipScope === 'week' ? 'week' : 'day',
        around: !!rep.around,
      } : null;
      if (c.repeat){c.cycleDay=Recur.nextDay(c.repeat, Plan.today());c.rt = { cycle:c.cycleDay, doneAt:null };}
      save(); return true;
    },
    /** התאריך הקרוב ביותר שבו הצ׳קליסט אמור להיות פתוח, מהיום קדימה */
    checklistNextDay(c, from){ return Recur.nextDay(c && c.repeat, from); },
    /**
     * מגלגל צ׳קליסט חוזר למחזור הבא. נקרא מה-Engine, ולכן חייב להיות
     * זול ואידמפוטנטי: הוא מאפס פעם אחת לכל מחזור, לפי מפתח שמור.
     */
    /**
     * מגלגל צ׳קליסט חוזר למחזור הבא.
     *
     * שלוש הכרעות שמייצרות את ההתנהגות שהאפיון דורש:
     * 1. מחזור שלא הושלם **נשאר פתוח** — לא בשעת היעד ולא בחצות. רק
     *    נקודת האיפוס סוגרת אותו, ולכן חצות לא מסתיר כלום.
     * 2. האיפוס קורה בדיוק שש שעות לפני המופע הבא, מ-Recur.
     * 3. אידמפוטנטי: מפתח המחזור נשמר, ולכן סימון באמצע מחזור לא נמחק
     *    בקריאה הבאה של המנוע.
     */
    rollChecklist(id, clId){
      const c = this.checklistOf(id, clId); if(!c || !c.repeat) return false;
      /* מחפשים את המופע שאחרי המחזור הפתוח, לא את המחזור עצמו */
      const open = c.cycleDay || (c.rt && c.rt.cycle) || '';
      const from = open ? Plan.shift(open, 1) : Plan.today();
      const nx = Recur.nextOccurrence(c.repeat, from);
      if (!nx) return false;
      c.rt = c.rt || {};
      if (Date.now() < nx.resetAt) return false;     /* עוד לא הגיע האיפוס */
      if (c.rt.cycle === nx.day) return false;       /* המחזור הזה כבר הוכן */
      c.cycleDay = nx.day;
      c.rt.cycle = nx.day;
      c.rt.doneAt = null;
      c.items.forEach(x => { x.checked = false; });
      save(); return true;
    },
    /**
     * צ׳קליסטים חוזרים שהמחזור שלהם פתוח ורלוונטי לתאריך. זה מה שהופך
     * צ׳קליסט חוזר לאובייקט עבודה אמיתי: הוא צף במסך "היום" בזכות עצמו,
     * גם כשהמשימה שמחזיקה אותו היא מיכל שלא מתוזמן בכלל.
     */
    activeChecklists(date){
      const day = date || Plan.today();
      const out = [];
      data.tasks.forEach(t => {
        if (t.archived || t.done) return;
        (t.checklists || []).forEach(c => {
          if (!c.repeat || !Recur.times(c.repeat).length) return;
          if (this.checklistCycleDone(c)) return;
          const cycle = this.checklistCycle(c);
          if (!cycle || cycle > day) return;      /* המחזור עוד לא נפתח */
          out.push({ task:t, cl:c, cycle,
                     at: Recur.times(c.repeat)[0],
                     done: c.items.filter(x => x.checked).length,
                     total: c.items.length });
        });
      });
      return out.sort((a,b) => (a.at||'').localeCompare(b.at||''));
    },
    /**
     * האם המשימה היא בעצם צ׳קליסט: קצרת-טווח, צ׳קליסט אחד, ובלי
     * תת-משימות או הרגלים. במקרה כזה הצ׳קליסט הוא הדבר שעושים,
     * והמשימה היא רק השם שלו.
     */
    soleChecklist(id){
      const t = this.task(id);
      if (!t || t.kind === 'long' || this.isHabit(t)) return null;
      const lists = this.checklists(id);
      if (lists.length !== 1) return null;
      if (this.children(id).length) return null;
      return lists[0];
    },
    /** צ׳קליסטים חוזרים שאינם משימת צ׳קליסט בפני עצמה — לתצוגות */
    isOwnList(t, c){ return t.kind === 'check' && (t.checklists||[])[0] === c; },
    /** המחזור הפתוח: היום שאליו הצ׳קליסט מכוון כרגע */
    checklistCycle(c){
      if (!c || !c.repeat) return '';
      if (c.cycleDay) return c.cycleDay;
      if (c.rt && c.rt.cycle) return c.rt.cycle;
      return Recur.nextDay(c.repeat, Plan.today());
    },
    /** מחזור מושלם = כל הפריטים מסומנים. אין פעולת סיום נפרדת. */
    checklistCycleDone(c){
      return !!(c && c.repeat && c.items.length && c.items.every(x => x.checked));
    },
    renameChecklist(id, clId, name){
      const c = this.checklistOf(id, clId); if(!c) return false;
      const n = String(name || '').trim(); if (!n) return false;
      c.name = n; save(); return true;
    },
    delChecklist(id, clId){
      const t = this.task(id); if(!t) return null;
      const i = this.checklists(id).findIndex(c => c.id === clId);
      if (i < 0) return null;
      const gone = t.checklists.splice(i, 1)[0]; save();
      return { list:gone, at:i };
    },
    insertChecklist(id, list, at){
      const t = this.task(id); if(!t) return;
      if (!Array.isArray(t.checklists)) t.checklists = [];
      t.checklists.splice(Math.max(0, Math.min(at == null ? t.checklists.length : at,
                                               t.checklists.length)), 0, list);
      save();
    },
    moveChecklist(id, clId, dir){
      const l = this.checklists(id), i = l.findIndex(c => c.id === clId), j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return false;
      l.splice(j, 0, l.splice(i, 1)[0]); save(); return true;
    },
    /** הצ׳קליסט שמחזיק פריט מסוים — כדי שפעולות ישנות ימשיכו לעבוד בלי clId */
    ownerOf(id, itemId){
      return this.checklists(id).find(c => c.items.some(x => x.id === itemId)) || null;
    },
    addChecklistItem(id, clIdOrTitle, titleOrNote, maybeNote){
      /* חתימה סובלנית: (id, clId, title, note) או (id, title, note) */
      let clId = clIdOrTitle, title = titleOrNote, note = maybeNote;
      if (!this.checklistOf(id, clIdOrTitle)){
        clId = null; title = clIdOrTitle; note = titleOrNote;
      }
      const t = this.task(id); if(!t) return null;
      const ttl = String(title || '').trim(); if (!ttl) return null;
      let c = clId ? this.checklistOf(id, clId) : this.checklists(id)[0];
      if (!c) c = this.addChecklist(id, 'צ׳קליסט');
      const it = { id:uid(), title:ttl, note:note || '', checked:false };
      c.items.push(it); this.reconcileChecklist(id,c); save(); return it;
    },
    updateChecklistItem(id, itemId, patch){
      const c = this.ownerOf(id, itemId); if(!c) return;
      const it = c.items.find(x => x.id === itemId); if(!it) return;
      if (patch.title !== undefined){
        const ttl = String(patch.title).trim(); if (!ttl) return;
        it.title = ttl;
      }
      if (patch.note !== undefined) it.note = patch.note || '';
      if (patch.checked !== undefined) it.checked = !!patch.checked;
      this.reconcileChecklist(id,c);
      save();
    },
    checklistOccurrence(c){return c.repeat?this.checklistCycle(c):'once-'+(c.manualCycle||0);},
    reconcileChecklist(id,c,at=Date.now(),day=localDay(new Date(at))){
      const t=this.task(id);if(!t||!c)return;
      const complete=!!c.items.length&&c.items.every(x=>x.checked),occ=this.checklistOccurrence(c);
      c.rt=c.rt||{};if(c.rt.doneAt&&!complete)c.rt.resumeAt=Date.now();c.rt.doneAt=complete?(c.rt.doneAt||at):null;
      if(complete)this.recordCompletion(t,'checklist',occ,day,at,c);
      else this.revokeCompletion('checklist:'+id+':'+c.id+':'+occ);
      if(t.kind==='check'&&!c.repeat){t.done=complete;t.doneAt=complete?c.rt.doneAt:null;}
    },
    toggleChecklistItem(id, itemId){
      const c=this.ownerOf(id,itemId);if(!c)return null;
      const it=c.items.find(x=>x.id===itemId);if(!it)return null;
      it.checked=!it.checked;this.reconcileChecklist(id,c);save();return it.checked;
    },
    /** מחיקה מחזירה את הפריט, את הצ׳קליסט שלו ואת מקומו, כדי שאפשר יהיה לבטל */
    delChecklistItem(id, itemId){
      const c = this.ownerOf(id, itemId); if(!c) return null;
      const i = c.items.findIndex(x => x.id === itemId);
      if (i < 0) return null;
      const gone = c.items.splice(i, 1)[0]; this.reconcileChecklist(id,c); save();
      return { item:gone, at:i, clId:c.id };
    },
    insertChecklistItem(id, item, at, clId){
      const c = clId ? this.checklistOf(id, clId) : this.checklists(id)[0];
      if (!c) return;
      c.items.splice(Math.max(0, Math.min(at == null ? c.items.length : at,
                                          c.items.length)), 0, item);
      this.reconcileChecklist(id,c);
      save();
    },
    moveChecklistItem(id, itemId, dir){
      const c = this.ownerOf(id, itemId); if(!c) return false;
      const l = c.items, i = l.findIndex(x => x.id === itemId), j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return false;
      l.splice(j, 0, l.splice(i, 1)[0]); save(); return true;
    },

    /* ================= תת-משימות והרגלים =================
       שני מקטעים נפרדים תחת אותה משימה, כל אחד עם סדר משלו. */
    ordered(list){
      return list.slice().sort((a,b) =>
        (a.sortIndex || 0) - (b.sortIndex || 0) || (a.createdAt || 0) - (b.createdAt || 0));
    },
    subtasksOf(id){ return this.ordered(this.children(id).filter(c => !this.isHabit(c))); },
    habitsOf(id){   return this.ordered(this.children(id).filter(c =>  this.isHabit(c))); },
    /** הזזה בתוך המקטע שאליו הפריט שייך בלבד */
    moveChild(id, dir){
      const t = this.task(id); if(!t) return false;
      const sec = this.isHabit(t) ? this.habitsOf(t.parentId) : this.subtasksOf(t.parentId);
      return this.reorder(sec, id, dir);
    },
    /**
     * הזזה כללית. משימת שורש זזה בתוך הקטגוריה שלה בלבד — אחרת היא הייתה
     * קופצת בין קבוצות הצבע, וזה בדיוק מה שהקיבוץ בא למנוע.
     */
    /** קובע סדר מפורש לרשימת מזהים. שייך תמיד לקבוצה אחת. */
    orderIds(ids){
      ids.forEach((id, k) => { const t = this.task(id); if (t) t.sortIndex = k; });
      save(); return true;
    },

    /* ---- סדר גלובלי אחד למשימות הראשיות ----
       "הכול", כל קטגוריה וכל אזור הם תצוגות של אותו רצף. אין סדרים
       נפרדים שסותרים זה את זה: הזזה בתוך אזור מחליפה שני מקומות ברצף
       הגלובלי, וכל השאר נשאר בדיוק איפה שהיה. */
    allRoots(){
      return this.ordered(data.tasks.filter(t => !t.parentId && !t.archived && !t.done));
    },
    /** ממספר מחדש את הרצף הגלובלי, כדי שהשוואות והחלפות יהיו יציבות */
    normalizeRootOrder(){
      this.allRoots().forEach((t, i) => { t.sortIndex = i; });
    },
    /**
     * מזיז משימה ראשית צעד אחד בתוך ההקשר הנראה (אזור, קטגוריה או
     * רשימה רציפה). `visibleIds` הוא מה שהמשתמש באמת רואה.
     */
    moveRootIn(id, dir, visibleIds){
      const i = visibleIds.indexOf(id), j = i + dir;
      if (i < 0 || j < 0 || j >= visibleIds.length) return false;
      this.normalizeRootOrder();
      const a = this.task(id), b = this.task(visibleIds[j]);
      if (!a || !b) return false;
      const tmp = a.sortIndex; a.sortIndex = b.sortIndex; b.sortIndex = tmp;
      save(); return true;
    },
    moveTask(id, dir){
      const t = this.task(id); if(!t) return false;
      if (t.parentId) return this.moveChild(id, dir);
      return this.moveRootIn(id, dir, this.allRoots().map(x => x.id));
    },
    reorder(list, id, dir){
      const i = list.findIndex(x => x.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return false;
      list.splice(j, 0, list.splice(i, 1)[0]);
      list.forEach((x,k) => { x.sortIndex = k; });
      save(); return true;
    },
    /** תת-משימה מתכווצת לפריט קל ברשימה של ההורה */
    toChecklistItem(id){
      const t = this.task(id); if(!t || !t.parentId) return null;
      const p = this.task(t.parentId); if(!p) return null;
      const it = this.addChecklistItem(p.id, t.title, t.note || '');
      if (it && (t.archived || t.done)) it.checked = true;
      this.delTask(id);
      return it;
    },
    /** תת-משימה נגמלת מההורה ועומדת בפני עצמה */
    toIndependent(id){
      const t = this.task(id); if(!t || !t.parentId) return false;
      t.parentId = null; t.parentIds = []; t.autoArch = false;
      t.sortIndex = this.freeIndex(t);
      save(); return true;
    },

    /** שורשי הארכיון: פריט שההורה שלו אינו מאורכב — כדי לא לכפול עצים */
    archived(){
      return data.tasks
        .filter(t => t.archived && !(t.parentId && (this.task(t.parentId)||{}).archived))
        .sort((a,b) => (b.archivedAt||0) - (a.archivedAt||0));
    },
    archivedCount(){ return data.tasks.filter(t => t.archived).length; },

    /* ---------- סוגי אירוע ---------- */
    eventTypes(){ return data.eventTypes; },
    eventType(id){ return data.eventTypes.find(x => x.id === id) || data.eventTypes[0] || null; },
    addEventType(name, color){
      const t = { id:uid(), name, color };
      data.eventTypes.push(t); save(); return t;
    },
    updateEventType(id, patch){ const t=data.eventTypes.find(x=>x.id===id); if(t){ Object.assign(t,patch); save(); } },
    delEventType(id){
      if (data.eventTypes.length <= 1) return false;
      data.eventTypes = data.eventTypes.filter(x => x.id !== id);
      const fb = data.eventTypes[0].id;
      data.events.forEach(e => { if (e.typeId === id) e.typeId = fb; });
      save(); return true;
    },

    delTask(id){
      const kill = new Set([id, ...this.ownedDescendants(id).map(t=>t.id)]);
      data.tasks.forEach(t=>{if(!kill.has(t.id)){t.parentIds=this.parentIds(t).filter(p=>!kill.has(p));t.parentId=t.parentIds[0]||null;}});
      data.tasks = data.tasks.filter(x => !kill.has(x.id));
      save();
    },

    addPlace(name, lat, lng, radius, parentId){
      const p = { id:uid(), name, lat, lng, radius: radius||200, parentId: parentId||null };
      data.places.push(p); save(); return p;
    },
    delPlace(id){
      /* מחיקת מקום ראשי מוחקת גם את תת-המקומות שלו */
      const kill = new Set([id, ...data.places.filter(p=>p.parentId===id).map(p=>p.id)]);
      data.places = data.places.filter(p => !kill.has(p.id));
      data.tasks.forEach(t=>{ if(t.reminder && kill.has(t.reminder.placeId)) t.reminder = null; });
      save();
    },
    place(id){ return data.places.find(p=>p.id===id); },
    placeCoordinates(id){
      let p=this.place(id),seen=new Set();
      while(p&&!seen.has(p.id)){seen.add(p.id);if(p.lat!=null&&p.lng!=null&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng)))return {lat:Number(p.lat),lng:Number(p.lng)};p=this.place(p.parentId);}
      return null;
    },
    addManualPlace(name,parentId){
      const parent=this.place(parentId);if(!parent||parent.parentId||!this.placeCoordinates(parentId))throw Error('בחר מיקום ראשי עם נקודה במפה');
      if(!String(name).trim())throw Error('צריך שם לתת־המיקום');
      return this.addPlace(String(name).trim(),null,null,parent.radius,parentId);
    },
    placeByName(n){ return data.places.find(p=>p.name===n); },
    /** מקומות ראשיים — רק להם יש גדר אמיתית במערכת ההפעלה */
    topPlaces(){ return data.places.filter(p => !p.parentId); },
    subPlaces(id){ return data.places.filter(p => p.parentId === id); },
    /** מטפס עד המקום הראשי. תת-מקום לעולם לא נרשם כגדר בפני עצמו. */
    placeRoot(id){
      let p = this.place(id), guard = 0;
      while (p && p.parentId && guard++ < 8) p = this.place(p.parentId);
      return p || null;
    },

    /* ---------- רשימות ---------- */
    list(id){ return data.lists.find(l => l.id === id); },
    /** האירוע שהרשימה שובצה בו, אם יש */
    listEvent(listId){ return data.events.find(e => e.listId === listId) || null; },
    addList(o){
      const l = { id:uid(), name:o.name, kind:o.kind||'simple', forWho:o.forWho||'',
                  phone:o.phone||'', createdAt:Date.now(), items:[] };
      data.lists.unshift(l); save(); return l;
    },
    updateList(id, patch){ const l=this.list(id); if(l){ Object.assign(l, patch); save(); } },
    delList(id){ data.lists = data.lists.filter(l=>l.id!==id); save(); },
    addItem(listId, o){
      const l = this.list(listId); if(!l) return null;
      const it = { id:uid(), title:o.title, where:o.where||'', link:o.link||'', img:o.img||'',
                   done:false, price:(o.price==null?null:o.price), note:o.note||'',
                   releaseDate:o.releaseDate||'', notified:false, createdAt:Date.now() };
      l.items.unshift(it); save(); return it;
    },
    updateItem(listId, itemId, patch){
      const l=this.list(listId); if(!l) return;
      const it=l.items.find(x=>x.id===itemId); if(!it) return;
      Object.assign(it, patch); save();
    },
    toggleItem(listId, itemId){
      const l=this.list(listId); if(!l) return;
      const it=l.items.find(x=>x.id===itemId); if(it){ it.done=!it.done; save(); }
    },
    delItem(listId, itemId){
      const l=this.list(listId); if(!l) return;
      l.items = l.items.filter(x=>x.id!==itemId); save();
    },
    /** כל הפריטים הפתוחים מכל הרשימות — לתכנון מסלול */
    openItems(){
      const out=[];
      data.lists.forEach(l => l.items.forEach(i => { if(!i.done) out.push({...i, listId:l.id, listName:l.name}); }));
      return out;
    },

    /** אירוע רב-יומי מופיע בכל יום בטווח שלו */
    onDay(e, date){ return e.endDate ? (date >= e.date && date <= e.endDate) : e.date === date; },
    events(date){
      return data.events.filter(e => this.onDay(e, date))
                        .sort((a,b) => (a.time||'').localeCompare(b.time||''));
    },
    eventCount(date){ return data.events.filter(e => this.onDay(e, date)).length; },
    event(id){ return data.events.find(e=>e.id===id); },
    /** אירועים שנוגעים ביום, כולל רב-יומיים שרק עוברים דרכו */
    spanning(date){
      return data.events.filter(e => this.onDay(e, date) &&
        (e.allDay || (e.endDate && e.endDate !== e.date)));
    },
    addEvent(o){
      const ev = { id:uid(), title:o.title, date:o.date, time:o.time||'09:00',
        end:o.end||'10:00', endDate:o.endDate||'',
        typeId:o.typeId || (data.eventTypes[0] && data.eventTypes[0].id) || 't_pers',
        remindMin:(o.remindMin==null?15:o.remindMin), note:o.note||'', rt:{},
        allDay:!!o.allDay, listId:o.listId||null };
      data.events.push(ev); save(); return ev;
    },
    updateEvent(id, patch){ const e=this.event(id); if(e){ Object.assign(e, patch); e.rt={}; save(); } },
    delEvent(id){
      data.events = data.events.filter(e=>e.id!==id);
      data.tasks.forEach(t=>{ if(t.eventId===id) t.eventId=null; });
      save();
    },

    /* ---------- הערות ---------- */
    /* ---------- קיצורי אתרים בספרייה ----------
       קישורים שהמשתמש שומר בעצמו. תוכן, לא הגדרה — ולכן הם חיים
       בספרייה לצד ההערות והרשימות. */
    links(){ return (data.links || []).slice(); },
    addLink(name, url){
      const u = this.cleanUrl(url); if (!u) return null;
      if (!Array.isArray(data.links)) data.links = [];
      const l = { id:uid(), name:String(name||'').trim() || this.hostOf(u), url:u };
      data.links.push(l); save(); return l;
    },
    updateLink(id, patch){
      const l = (data.links||[]).find(x => x.id === id); if(!l) return false;
      if (patch.url !== undefined){
        const u = this.cleanUrl(patch.url); if (!u) return false;
        l.url = u;
      }
      if (patch.name !== undefined) l.name = String(patch.name).trim() || this.hostOf(l.url);
      save(); return true;
    },
    delLink(id){
      const i = (data.links||[]).findIndex(x => x.id === id);
      if (i < 0) return null;
      const gone = data.links.splice(i, 1)[0]; save();
      return { link:gone, at:i };
    },
    insertLink(link, at){
      if (!Array.isArray(data.links)) data.links = [];
      data.links.splice(Math.min(at, data.links.length), 0, link); save();
    },
    moveLink(id, dir){
      const l = data.links || [];
      const i = l.findIndex(x => x.id === id); if (i < 0) return;
      const j = i + dir; if (j < 0 || j >= l.length) return;
      [l[i], l[j]] = [l[j], l[i]]; save();
    },
    /** רק http/https. כתובת בלי סכימה מקבלת https, וכל השאר נדחה. */
    cleanUrl(raw){
      let v = String(raw || '').trim();
      if (!v) return '';
      if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
      try {
        const u = new URL(v);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        if (!u.hostname || !u.hostname.includes('.')) return '';
        return u.href;
      } catch(e){ return ''; }
    },
    hostOf(url){
      try { return new URL(url).hostname.replace(/^www\./, ''); } catch(e){ return url; }
    },

    notes(){ return data.notes.slice().sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0) || b.updatedAt-a.updatedAt); },
    note(id){ return data.notes.find(n=>n.id===id); },
    addNote(o){
      const n = { id:uid(), title:(o&&o.title)||'', html:(o&&o.html)||'',
                  pinned:false, createdAt:Date.now(), updatedAt:Date.now() };
      data.notes.unshift(n); save(); return n;
    },
    /** silent = שמירה תוך כדי הקלדה, בלי לרנדר מחדש ולהרוס את הסמן */
    updateNote(id, patch, silent){
      const n = this.note(id); if(!n) return;
      Object.assign(n, patch); n.updatedAt = Date.now();
      if (silent){ if (persist){ try { localStorage.setItem(KEY, JSON.stringify(data)); }
                                 catch(e){ persist = false; } } }
      else save();
    },
    delNote(id){ data.notes = data.notes.filter(n=>n.id!==id); save(); },
    pinNote(id){ const n=this.note(id); if(n){ n.pinned=!n.pinned; save(); } },

    setPref(k,v){ data.prefs[k]=v; save(); },
    export(){ return JSON.stringify(data, null, 2); },
    import(json){
      const p = JSON.parse(json);
      if (!p || typeof p!=='object' || !Array.isArray(p.tasks)) throw new Error('bad');
      const next = normalize(p);
      // Validate and reserve a recovery copy before touching the current database.
      try {
        localStorage.setItem('mesima.before-import', JSON.stringify(data));
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch(e){ throw new Error('אין מקום לשחזור במכשיר. ייצא גיבוי ופנה מקום לפני שתנסה שוב.'); }
      data = next;persist=true;
      save();
    },
    wipe(){ data = seed(); save(); },
  };
})();

/* -------------------------------- Geo ----------------------------------- */
