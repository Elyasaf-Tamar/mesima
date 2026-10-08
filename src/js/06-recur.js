const Recur = (() => {
  /* איפוס המחזור קורה בדיוק שש שעות לפני המופע הבא. קבוע, לא מוגדר. */
  const RESET_MIN = 360;
  /* התאמה סביב אירוע: כמה לפני ההתחלה, וכמה אחרי הסוף */
  const PRE_MS   = 6 * 3600000;
  const POST_MS  = 2 * 3600000;

  const norm = rep => {
    if (!rep) return null;
    const days = [...new Set(Array.isArray(rep.days) ? rep.days.filter(d=>Number.isInteger(d)&&d>=0&&d<=6) : [])].sort();
    const times = [...new Set(Array.isArray(rep.times) ? rep.times : rep.time ? [rep.time] : [])]
      .filter(t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t)).sort();
    return { days, times,
             skipTypes: Array.isArray(rep.skipTypes) ? rep.skipTypes : [],
             skipScope: rep.skipScope === 'week' ? 'week' : 'day',
             around: !!rep.around };
  };

  const times = rep => (norm(rep) || { times:[] }).times;

  /** יום פעיל לפי לוח הימים בלבד — בלי חריגים */
  function active(rep, date){
    const r = norm(rep);
    if (!r || !r.days.length || !r.times.length) return false;
    return r.days.includes(new Date(date + 'T00:00:00').getDay());
  }

  /** חריג לפי סוג אירוע. מזהים נשמרים, לא שמות. */
  function skipped(rep, date){
    const r = norm(rep);
    if (!r || !r.skipTypes.length) return false;
    const days = r.skipScope === 'week' ? Cal.weekOf(date) : [date];
    return days.some(k => Store.all.events.some(e =>
      !!e && r.skipTypes.includes(e.typeId) && Store.onDay(e, k)));
  }

  /** נדרש היום: יום פעיל, ובלי חריג. זו ההגדרה היחידה בכל האפליקציה. */
  function due(rep, date){ return active(rep, date) && !skipped(rep, date); }

  /** דילוג ישיר מעבר לאירועים החוסמים; אין תקרת שבועיים שרירותית. */
  function findDay(rep,from,direction){
    const r=norm(rep);if(!r?.days.length||!r.times.length)return '';
    let day=from||Plan.today();
    // Each jump passes at least one finite event boundary. The final seven-day
    // search is only for a weekday, never a limit on the requested date.
    for(let guard=0;guard<Store.all.events.length+2;guard++){
      let found=false;for(let i=0;i<7;i++){if(active(r,day)){found=true;break;}day=Plan.shift(day,direction);}
      if(!found)return '';
      const scope=r.skipScope==='week'?Cal.weekOf(day):[day];
      const blockers=Store.all.events.filter(e=>r.skipTypes.includes(e.typeId)&&scope.some(d=>Store.onDay(e,d)));
      if(!blockers.length)return day;
      const edges=blockers.map(e=>direction>0?Cal.key(new Date(Cal.endMs(e)-1)):Cal.key(new Date(Cal.startMs(e))));
      let edge=direction>0?edges.sort().at(-1):edges.sort()[0];
      if(r.skipScope==='week')edge=Cal.weekOf(edge)[direction>0?6:0];
      day=Plan.shift(edge,direction);
    }
    return '';
  }
  function nextDay(rep,from){return findDay(rep,from,1);}
  function previousDay(rep,from){return findDay(rep,from,-1);}

  /** רגע המופע הבא, ורגע האיפוס שלו — שש שעות לפניו */
  function nextOccurrence(rep, from){
    const day = nextDay(rep, from);
    if (!day) return null;
    const hm = times(rep)[0] || '00:00';
    const at = Cal.atMs(day, hm);
    return { day, hm, at, resetAt: at - RESET_MIN * 60000 };
  }
  /** Latest cycle whose reset has arrived, even after months without opening. */
  function cycleAt(rep,now=Date.now()){
    const today=Cal.key(new Date(now));
    for(const from of [Plan.shift(today,1),today]){const nx=nextOccurrence(rep,from);if(nx&&nx.resetAt<=now)return nx.day;}
    return previousDay(rep,Plan.shift(today,-1));
  }

  /**
   * התאמה סביב אירוע. מחזיר null אם התזכורת לא נופלת בתוך אירוע;
   * אחרת את רגע ההכנה ורגע המעקב. המעקב נמדד מ**סוף** האירוע.
   * זה לא חריג: הפעולה עדיין נדרשת, רק לא באמצע האירוע.
   */
  function around(rep, date, hm){
    const r = norm(rep);
    if (!r || !r.around) return null;
    const ev = Cal.covering(Store.events(date), Cal.atMs(date, hm));
    if (!ev) return null;
    return { ev, prep: Cal.startMs(ev) - PRE_MS, after: Cal.endMs(ev) + POST_MS };
  }

  return { RESET_MIN, PRE_MS, POST_MS, norm, times, active, skipped, due,
           nextDay, previousDay, nextOccurrence, cycleAt, around };
})();
/* -------------------------------- Modal --------------------------------- */
/* גיליון תחתון כללי. משמש לבורר משימות, לסגירת חשבון ולעריכת פריט. */
