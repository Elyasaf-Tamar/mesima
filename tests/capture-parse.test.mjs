import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/js/14-capture-parse.js',import.meta.url),'utf8');
const P=vm.runInNewContext(source+';CaptureParse');
// Monday 23 November 2026, 10:00 local time.
const NOW=new Date(2026,10,23,10,0);
const p=(text,now=NOW)=>{const r=P.parse(text,now);return r&&{date:r.date,time:r.time,uncertain:r.uncertain};};

test('relative days',()=>{
  assert.deepEqual(p('לקנות חלב היום'),{date:'2026-11-23',time:null,uncertain:false});
  assert.deepEqual(p('להתקשר לאמא מחר'),{date:'2026-11-24',time:null,uncertain:false});
  assert.deepEqual(p('מחרתיים לשלם חשבון'),{date:'2026-11-25',time:null,uncertain:false});
  assert.deepEqual(p('הערב לסיים מצגת'),{date:'2026-11-23',time:'20:00',uncertain:false});
});

test('hours, maqaf variants and parts of the day',()=>{
  assert.deepEqual(p('מחר ב-5 להתקשר לרופא'),{date:'2026-11-24',time:'17:00',uncertain:true});
  assert.deepEqual(p('מחר ב־17:30 פגישה'),{date:'2026-11-24',time:'17:30',uncertain:false});
  assert.deepEqual(p('מחר ב 8 בבוקר ריצה'),{date:'2026-11-24',time:'08:00',uncertain:false});
  assert.deepEqual(p('מחר ב-8 בערב'),{date:'2026-11-24',time:'20:00',uncertain:false});
  assert.deepEqual(p('מחר בבוקר לקנות לחם'),{date:'2026-11-24',time:'09:00',uncertain:false});
  assert.deepEqual(p('מחר בצהריים'),{date:'2026-11-24',time:'13:00',uncertain:false});
  assert.deepEqual(p('בשעה 9 ישיבה'),{date:'2026-11-24',time:'09:00',uncertain:false});
});

test('an hour without a day is today when still ahead, otherwise tomorrow',()=>{
  assert.deepEqual(p('ב-11 להוציא כביסה'),{date:'2026-11-23',time:'11:00',uncertain:false});
  assert.deepEqual(p('ב-9 להוציא כביסה'),{date:'2026-11-24',time:'09:00',uncertain:false});
  assert.deepEqual(p('ב-3 לאסוף חבילה'),{date:'2026-11-23',time:'15:00',uncertain:true});
});

test('weekdays move forward and the same weekday means next week',()=>{
  assert.equal(p('ביום רביעי לקבוע תור').date,'2026-11-25');
  assert.equal(p('יום ב׳ להגיש טופס').date,'2026-11-30');
  assert.equal(p("ביום א' ספורט").date,'2026-11-29');
  assert.equal(p('בשבת לנוח').date,'2026-11-28');
  assert.deepEqual(p('ביום חמישי ב-18:00 אימון'),{date:'2026-11-26',time:'18:00',uncertain:false});
});

test('numeric dates and year rollover',()=>{
  assert.equal(p('לחדש דרכון 25/12').date,'2026-12-25');
  assert.equal(p('יום הולדת 3/1').date,'2027-01-03');
  assert.equal(p('פגישה 1/3/2027 ב-10').date,'2027-03-01');
  assert.equal(p('31/2 לא קיים'),null);
});

test('relative offsets',()=>{
  assert.deepEqual(p('בעוד שעה לבדוק תנור'),{date:'2026-11-23',time:'11:00',uncertain:false});
  assert.deepEqual(p('בעוד 3 ימים להחזיר ספר'),{date:'2026-11-26',time:null,uncertain:false});
  assert.deepEqual(p('בעוד שבוע'),{date:'2026-11-30',time:null,uncertain:false});
  assert.deepEqual(p('בעוד חצי שעה'),{date:'2026-11-23',time:'10:30',uncertain:false});
  assert.deepEqual(p('בעוד 20 דקות לצאת',new Date(2026,11,31,23,50)),{date:'2027-01-01',time:'00:10',uncertain:false});
});

test('plain text and numbers that are not times stay untouched',()=>{
  assert.equal(p('סיסמת וויפי 4482'),null);
  assert.equal(p('לקנות 5 עגבניות'),null);
  assert.equal(p('קניתי ב-50 שקל'),null);
  assert.equal(p('מחירון 2.5%'),null);
  assert.equal(p('שם של שיר מהרדיו'),null);
  assert.equal(p('#מידע ראשון בתור'),null);
});

test('strip removes the recognized phrase for a task title',()=>{
  const text='מחר ב-5 להתקשר לרופא שיניים',r=P.parse(text,NOW);
  assert.equal(P.strip(text,r),'להתקשר לרופא שיניים');
  const t2='להחזיר ספר בעוד 3 ימים';assert.equal(P.strip(t2,P.parse(t2,NOW)),'להחזיר ספר');
  assert.match(r.label,/מחר/);assert.match(r.label,/17:00/);
});

test('tags are read from the text',()=>{
  assert.deepEqual([...P.tags('סיסמה #מידע ו-#בסיס_צבאי, עוד #מידע')],['מידע','בסיס_צבאי']);
});

test('night hours and mixed phrases',()=>{
  assert.deepEqual(p('מחר ב-10 בלילה'),{date:'2026-11-24',time:'22:00',uncertain:false});
  assert.deepEqual(p('מחר ב-1 בלילה'),{date:'2026-11-24',time:'01:00',uncertain:false});
  assert.deepEqual(p("ביום ג' ב-7 בבוקר"),{date:'2026-11-24',time:'07:00',uncertain:false});
  assert.equal(p('להתקשר לבנק'),null);
  assert.equal(p('לבדוק את הבוקר'),null);
});

test('review fixes: units, dotted numbers, scores and "עוד" without ב are not dates',()=>{
  assert.equal(p('לשלם ארנונה ב-10 לחודש'),null);
  assert.equal(p('לסיים ב-3 ימים'),null);
  assert.equal(p('ב-2 שעות'),null);
  assert.equal(p('גרסה 1.2'),null);
  assert.equal(p('3.5 כוכבים'),null);
  assert.equal(p('ציון 9/10'),null);
  assert.equal(p('עוד יום הולדת לאחי'),null);
  assert.equal(p('פגישה ב-3.1').date,'2027-01-03');
  assert.equal(p('פגישה 3.1.2027').date,'2027-01-03');
  assert.deepEqual(p('מחר בערב ב-12'),{date:'2026-11-24',time:'00:00',uncertain:false});
});

test('labels are relative to the viewing day and strip keeps line breaks',()=>{
  const r=P.parse('להתקשר לאמא מחר',new Date(2026,10,20,9,0));
  assert.equal(r.date,'2026-11-21');
  assert.equal(P.label(r.date,r.time,NOW),'21/11');
  assert.equal(P.label('2026-11-24',null,NOW),'מחר');
  const t='מחר ב-5\nלהתקשר לרופא\nולקבוע תור';assert.equal(P.strip(t,P.parse(t,NOW)),'להתקשר לרופא\nולקבוע תור');
});
