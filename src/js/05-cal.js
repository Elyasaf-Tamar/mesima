const Cal = (() => {
  const p2 = n => String(n).padStart(2,'0');
  const key = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
  const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

  /* שלושה סוגים בלבד, מקבילים למשימות-העל. "כללי" היה סתם ברירת מחדל ריקה. */
  /** סוג האירוע — צבע ושם מגיעים ממאגר סוגי האירוע שהמשתמש בונה */
  const type = e => {
    const t = Store.eventType(e && e.typeId);
    return t || { id:'?', name:'ללא סוג', color:'#8a94a6' };
  };

  function atMs(dateKey, hm){
    const [y,m,d] = dateKey.split('-').map(Number);
    const [hh,mi] = (hm||'00:00').split(':').map(Number);
    return new Date(y, m-1, d, hh, mi, 0, 0).getTime();
  }
  function startMs(ev){ return atMs(ev.date, ev.allDay ? '00:00' : ev.time); }
  /** סיום האירוע.
      שעת סיום קטנה משעת ההתחלה = האירוע חוצה חצות (שמירה 22:00–02:00),
      ואז הסיום הוא למחרת. בלי זה משמרת לילה נספרה כשעה אחת. */
  function endMs(ev){
    const s = startMs(ev);
    /* אירוע של יום שלם נגמר בסוף היום האחרון שלו, לא בשעה כלשהי */
    if (ev.allDay) return atMs(ev.endDate || ev.date, '00:00') + 864e5 - 60000;
    let e = atMs(ev.endDate || ev.date, ev.end || ev.time);
    if (e <= s && !ev.endDate) e += 864e5;
    if (e <= s) e = s + 60*60000;
    return e;
  }
  function durLabel(ev){
    const mins = Math.round((endMs(ev) - startMs(ev)) / 60000);
    if (ev.allDay && (!ev.endDate || ev.endDate === ev.date)) return 'כל היום';
    if (ev.endDate && ev.endDate !== ev.date){
      const days = Math.round((atMs(ev.endDate,'00:00') - atMs(ev.date,'00:00')) / 864e5) + 1;
      return days + ' ימים';
    }
    if (mins < 60) return mins + ' דק׳';
    const h = Math.floor(mins/60), m = mins%60;
    return h + ' שע׳' + (m ? ' ' + m : '');
  }
  function stamp(ms){
    const d = new Date(ms);
    return d.getFullYear()+p2(d.getMonth()+1)+p2(d.getDate())+'T'+p2(d.getHours())+p2(d.getMinutes())+'00';
  }
  /* קובץ ICS – אנדרואיד מציע לפתוח אותו ביומן של הטלפון */
  function ics(events){
    const esc = s => String(s||'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
    const L = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//mesima//HE','CALSCALE:GREGORIAN'];
    events.forEach(ev => {
      const s = startMs(ev), e = endMs(ev);
      L.push('BEGIN:VEVENT', 'UID:'+ev.id+'@mesima', 'DTSTAMP:'+stamp(Date.now()),
             'DTSTART:'+stamp(s), 'DTEND:'+stamp(e), 'SUMMARY:'+esc(ev.title));
      if (ev.note) L.push('DESCRIPTION:'+esc(ev.note));
      if (ev.remindMin >= 0)
        L.push('BEGIN:VALARM','TRIGGER:-PT'+(ev.remindMin||0)+'M','ACTION:DISPLAY',
               'DESCRIPTION:'+esc(ev.title),'END:VALARM');
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.join('\r\n');
  }
  function gcal(ev){
    const s = startMs(ev), e = endMs(ev);
    const q = new URLSearchParams({ action:'TEMPLATE', text:ev.title,
      dates: stamp(s)+'/'+stamp(e), details: ev.note||'', ctz:'Asia/Jerusalem' });
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }
  function monthGrid(year, month){
    const first = new Date(year, month, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());  /* ראשון */
    const cells = [];
    for (let i=0;i<42;i++){
      const d = new Date(start); d.setDate(start.getDate()+i);
      cells.push({ date:d, key:key(d), out:d.getMonth()!==month });
      if (i>=34 && d.getMonth()!==month && d.getDay()===6) break;
    }
    return cells;
  }
  /** ראשון עד שבת של השבוע שבו נמצא התאריך */
  function weekOf(k){
    const [y,m,d] = k.split('-').map(Number);
    const dt = new Date(y, m-1, d);
    dt.setDate(dt.getDate() - dt.getDay());
    return Array.from({length:7}, (_,i)=>{
      const x = new Date(dt); x.setDate(dt.getDate()+i); return key(x);
    });
  }
  /**
   * מתי האירוע מזכיר. לאירוע רגיל — שעת ההתחלה פחות ההקדמה.
   * לאירוע של יום שלם אין שעת התחלה, וחצות זו שעה חסרת תועלת להתראה,
   * ולכן הבסיס הוא 09:00 של היום הראשון.
   */
  const ALLDAY_HOUR = '09:00';
  function remindAt(ev){
    if (ev.remindMin == null || ev.remindMin < 0) return 0;
    const base = ev.allDay ? atMs(ev.date, ALLDAY_HOUR) : startMs(ev);
    return base - ev.remindMin * 60000;
  }
  /** כמה ימים האירוע תופס, ובאיזה יום מתוכם נמצא התאריך */
  function dayCount(ev){
    if (!ev.endDate || ev.endDate === ev.date) return 1;
    return Math.round((atMs(ev.endDate,'00:00') - atMs(ev.date,'00:00')) / 864e5) + 1;
  }
  /**
   * האירוע שעוטף רגע מסוים. משמש ל"התאמה סביב אירועים": אם התזכורת
   * החוזרת נופלת בתוך אירוע, היא לא מצלצלת באמצע — היא מוקדמת ומאוחרת.
   * מוחזר הראשון בלבד; אירועים חופפים הם מקרה קצה שלא שווה מנגנון.
   */
  function covering(events, at){
    for (const ev of (events || [])){
      if (!ev || ev.allDay) continue;
      if (at >= startMs(ev) && at <= endMs(ev)) return ev;
    }
    return null;
  }
  return { key, MONTHS, type, atMs, startMs, endMs, durLabel, dayCount, remindAt,
           covering, ics, gcal, monthGrid, weekOf };
})();

/* -------------------------------- Recur ---------------------------------
   מנוע חזרתיות אחד, ויחיד, לשני המושגים החוזרים באפליקציה:
   הרגל (פעולה חוזרת אחת) וצ׳קליסט חוזר (קבוצת פריטים חוזרת).
   שניהם מושגים נפרדים למשתמש — אבל התזמון, הימים הפעילים, מצב המחזור,
   נקודת האיפוס, חריגי סוג אירוע וההתאמה סביב אירועים מגיעים מכאן בלבד.
   קיומן של שתי מערכות חזרתיות היה בדיוק הכפילות שהמוצר הזה נמנע ממנה.

   צורת ההגדרה המשותפת:
     { days:[0..6], times:['08:00', …] | time:'23:00',
       skipTypes:[מזהי סוג אירוע], skipScope:'day'|'week', around:bool }
--------------------------------------------------------------------------- */
