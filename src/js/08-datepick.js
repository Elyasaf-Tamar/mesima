const DatePick = (() => {
  const $ = x => document.querySelector(x);
  let y, m, val, cb = null, allowClear = false;

  function grid(){
    const today = Plan.today();
    const cells = Cal.monthGrid(y, m);
    const wd = ['א','ב','ג','ד','ה','ו','ש'];
    return `<div class="calnav">
        <button class="hbtn" data-dm="-1" aria-label="חודש קודם">&#8249;</button>
        <div class="ttl">${Cal.MONTHS[m]} ${y}</div>
        <button class="hbtn" data-dm="1" aria-label="חודש הבא">&#8250;</button>
      </div>
      <div class="dgrid">
        <div class="mgrid">${wd.map(d=>`<div class="wd">${d}</div>`).join('')}</div>
        <div class="mgrid" style="margin-top:4px">${cells.map(c => {
          const busy = Store.events(c.key).length + Store.plannedFor(c.key).length;
          return `<button class="dpday${c.out?' out':''}${c.key===today?' today':''}"
            data-dp="${c.key}" aria-selected="${c.key===val}">
            <span>${c.date.getDate()}</span>
            ${busy ? '<span class="dot"></span>' : ''}</button>`;
        }).join('')}</div>
      </div>
      <div class="rule" style="margin:14px 0 10px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn s" data-dq="0">היום</button>
        <button class="btn s" data-dq="1">מחר</button>
        <button class="btn s" data-dq="7">בעוד שבוע</button>
      </div>`;
  }

  function paint(){
    $('#dpBody').innerHTML = grid();
    $('#dpTitle').textContent = val ? Plan.longDate(val) : 'בחירת תאריך';
  }

  function open(initial, onPick, opts){
    opts = opts || {};
    allowClear = !!opts.clear;
    val = initial || Plan.today();
    const [yy,mm] = val.split('-').map(Number);
    y = yy; m = mm - 1;
    cb = onPick;
    const body = $('#dpBody');
    const fresh = body.cloneNode(false);
    body.replaceWith(fresh);
    paint();
    $('#dpFoot').innerHTML =
      (allowClear ? '<button class="btn s" data-df="clear">נקה</button>' : '') +
      '<button class="btn s" data-df="x">ביטול</button>' +
      '<button class="btn p" data-df="ok">בחר</button>';
    $('#dpick').classList.add('on');
    fresh.addEventListener('click', e => {
      const nav = e.target.closest('[data-dm]');
      if (nav){ m += +nav.dataset.dm;
        if (m < 0){ m = 11; y--; } if (m > 11){ m = 0; y++; }
        paint(); return; }
      const q = e.target.closest('[data-dq]');
      if (q){ val = Plan.shift(Plan.today(), +q.dataset.dq);
        const [a,b] = val.split('-').map(Number); y=a; m=b-1; paint(); return; }
      const d = e.target.closest('[data-dp]');
      if (d){ val = d.dataset.dp; paint(); }
    });
    $('#dpFoot').querySelectorAll('[data-df]').forEach(el => {
      el.addEventListener('click', () => {
        const k = el.dataset.df;
        /* שומרים את הקריאה החוזרת לפני הסגירה — shut מאפס אותה */
        const done = cb;
        if (k === 'ok'){ shut(); done?.(val); return; }
        if (k === 'clear'){ shut(); done?.(''); return; }
        shut();
      });
    });
  }
  function shut(){ $('#dpick').classList.remove('on'); cb = null; }
  function isOpen(){ return $('#dpick').classList.contains('on'); }
  return { open, shut, isOpen };
})();

/* --------------------------------- Plan --------------------------------- */
/* עוזרי תכנון יומי: מיזוג אירועי יומן עם משימות שתוכננו ליום. */
