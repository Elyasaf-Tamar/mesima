const Recur = (() => {
  /* איפוס המחזור קורה בדיוק שש שעות לפני המופע הבא. קבוע, לא מוגדר. */
  const RESET_MIN = 360;
  /* התאמה סביב אירוע: כמה לפני ההתחלה, וכמה אחרי הסוף */
  const PRE_MS   = 6 * 3600000;
  const POST_MS  = 2 * 3600000;

  const norm = rep => {
    if (!rep) return null;
    const days = Array.isArray(rep.days) ? rep.days : [];
    const times = Array.isArray(rep.times) ? rep.times.slice()
                : rep.time ? [rep.time] : [];
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

  /** התאריך הקרוב שבו זה נדרש, מ-from קדימה (עד שבועיים) */
  function nextDay(rep, from){
    let k = from || Plan.today();
    for (let i = 0; i < 14; i++){
      if (due(rep, k)) return k;
      k = Plan.shift(k, 1);
    }
    return '';
  }

  /** רגע המופע הבא, ורגע האיפוס שלו — שש שעות לפניו */
  function nextOccurrence(rep, from){
    const day = nextDay(rep, from);
    if (!day) return null;
    const hm = times(rep)[0] || '00:00';
    const at = Cal.atMs(day, hm);
    return { day, hm, at, resetAt: at - RESET_MIN * 60000 };
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
           nextDay, nextOccurrence, around };
})();
/* -------------------------------- Modal --------------------------------- */
/* גיליון תחתון כללי. משמש לבורר משימות, לסגירת חשבון ולעריכת פריט. */
