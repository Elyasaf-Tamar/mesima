const Modal = (() => {
  const $ = x => document.querySelector(x);
  let onClose = null;
  function open({ title, body, buttons, close }){
    $('#mTitle').textContent = title || '';
    /* מחליפים את הגוף באלמנט חדש כדי להרוג מאזינים ישנים.
       בלי זה כל פתיחה מוסיפה מאזין נוסף לאותו אלמנט, וקליק אחד היה מפעיל
       גם את המאזינים של כל המודאלים הקודמים — כולל מחיקות של משימות אחרות. */
    const oldBody = $('#mBody');
    const fresh = oldBody.cloneNode(false);
    oldBody.replaceWith(fresh);
    fresh.innerHTML = body || '';
    $('#mFoot').innerHTML = (buttons||[]).map((b,i)=>
      `<button class="btn ${b.kind||'s'}" data-mb="${i}">${b.label}</button>`).join('');
    $('#mFoot').querySelectorAll('[data-mb]').forEach(el=>{
      el.addEventListener('click', ()=> buttons[+el.dataset.mb].act?.());
    });
    onClose = close || null;
    guard = null;
    $('#modal').classList.add('on');
  }
  function shut(){ $('#modal').classList.remove('on'); $('#mBody').innerHTML='';
                   guard = null; onClose?.(); onClose=null; }
  /** ניסיון סגירה "מבחוץ" — ה-×, כפתור החזרה, לחיצה על הרקע.
      עורך שמחזיק עבודה שלא נשמרה יכול לעצור את זה ולשאול. */
  let guard = null;
  function tryShut(){ if (guard && guard() === false) return false; shut(); return true; }
  return { open, shut, tryShut, get body(){ return $('#mBody'); },
           set closeGuard(fn){ guard = fn; } };
})();

/* --------------------------- בוחר תאריך פנימי ---------------------------
   שדה תאריך של הדפדפן קטן ומבלבל. במקומו נפתח כאן אותו לוח חודשי
   שהמשתמש כבר מכיר מהמסך "חודש", עם נקודות על ימים תפוסים. */
