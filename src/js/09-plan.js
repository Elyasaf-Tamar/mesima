const Plan = (() => {
  const p2 = n => String(n).padStart(2,'0');
  const key = d => d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
  const shift = (k, days) => {
    const [y,m,d] = k.split('-').map(Number);
    const dt = new Date(y, m-1, d); dt.setDate(dt.getDate()+days); return key(dt);
  };
  const today = () => key(new Date());
  const label = k => {
    if (k === today()) return 'היום';
    if (k === shift(today(), 1)) return 'מחר';
    if (k === shift(today(), -1)) return 'אתמול';
    const [y,m,d] = k.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('he-IL',{weekday:'long'});
  };
  const longDate = k => {
    const [y,m,d] = k.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long'});
  };
  /** כל מה שמתוכנן ליום, ממוין: אירועים לפי שעה, אחריהם משימות ללא שעה. */
  function agenda(date){
    const rows = [];
    Store.events(date).forEach(e => rows.push({ kind:'event', at:e.time, ref:e }));
    Store.plannedFor(date).forEach(t => {
      const at = (t.reminder && t.reminder.type === 'time') ? t.reminder.at : null;
      rows.push({ kind:'task', at, ref:t });
    });
    /* הרגלים יומיים נכנסים לבד — בלי לתכנן אותם ידנית כל יום */
    Store.habitsFor(date).forEach(t => {
      const now = new Date().toTimeString().slice(0,5);
      /* מוצג בשעת התזכורת הבאה שעוד לא עברה; אחרת בראשונה */
      const at = t.repeat.times.find(x => x >= now) || t.repeat.times[0];
      rows.push({ kind:'habit', at, ref:t });
    });
    rows.sort((a,b) => {
      if (a.at && b.at) return a.at.localeCompare(b.at);
      if (a.at) return -1;
      if (b.at) return 1;
      return 0;
    });
    return rows;
  }
  return { key, shift, today, label, longDate, agenda };
})();

/* -------------------------------- Track --------------------------------- */
/* בדיקת מצב יציאה לפריטי "משאלות".
   ספרים: Google Books פתוח וללא מפתח. משחקים: אין API חינמי ויציב שעובד
   מהדפדפן, ולכן שם זו בדיקה ידנית דרך קישור — ואומרים את זה במפורש. */
