import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.MESIMA_PLAYWRIGHT).href);
const server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html; charset=utf-8');r.end(fs.readFileSync('index.html'));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.MESIMA_CHROME});
const context=await browser.newContext({viewport:{width:412,height:915},timezoneId:'Asia/Jerusalem'});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
fs.mkdirSync('test-results',{recursive:true});
const foot=n=>page.locator('#mFoot').getByRole('button',{name:n,exact:true});
const input=page.locator('#capInput');
try{
  await page.clock.setFixedTime(new Date('2026-11-23T10:00:00+02:00'));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>{Engine.stop();Store.setPref('syncEnabled',false);});
  assert.equal(await page.locator('#s-capture.on').count(),1,'cold start opens quick notes');
  assert.equal(await page.locator('#capBar').isVisible(),true);
  assert.equal(await page.locator('#fab').isVisible(),false);
  console.log('PASS cold start opens the notes screen with the composer and no add button');

  await input.fill('מחר ב-5 להתקשר לרופא');await input.press('Enter');
  await page.locator('.cbub').first().waitFor();
  assert.equal(await input.inputValue(),'');
  assert.match(await page.locator('.cbub .cchip').innerText(),/מחר 17:00/);
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'capInput','focus stays in the composer');
  await input.fill('סיסמת וויפי 4482 #מידע');await page.locator('#capSend').click();
  assert.equal(await page.locator('.cbub').count(),2);
  assert.equal(await page.locator('#capBadge').innerText(),'2');
  assert.equal(await page.locator('.cday').first().innerText(),'היום');
  await page.waitForTimeout(300);await page.screenshot({path:'test-results/capture-stream.png'});
  console.log('PASS Enter and the send button add bubbles, keep focus, show the date chip, day separator and badge');

  await page.locator('.cbub').nth(1).locator('.ctime').click();
  await page.locator('[data-capact="info"]').click();
  assert.equal(await page.locator('#capBadge').innerText(),'1');
  await page.locator('[data-capf="info"]').click();assert.equal(await page.locator('.cbub').count(),1);
  await page.locator('[data-capf="all"]').click();await page.locator('[data-captag="מידע"]').click();
  assert.equal(await page.locator('.cbub').count(),1);assert.match(await page.locator('.ctagbar').innerText(),/מידע/);
  await page.locator('[data-capclear]').click();assert.equal(await page.locator('.cbub').count(),2);
  await page.locator('[data-capsearch]').click();await page.locator('#capSearch').fill('רופא');assert.equal(await page.locator('.cbub').count(),1);
  await page.locator('[data-capsearch]').click();assert.equal(await page.locator('.cbub').count(),2);
  console.log('PASS mark as info, filters, tag filter and search');

  await page.locator('#nav [data-s="today"]').click();
  await page.locator('.ccard').waitFor();assert.match(await page.locator('.ccard').innerText(),/פתק אחד לסדר/);
  await page.locator('.ccard').click();
  assert.match(await page.locator('#mTitle').innerText(),/מיון פתקים/);
  await page.locator('[data-rev="task"]').click();
  assert.equal(await page.locator('#etTitle').inputValue(),'להתקשר לרופא');
  assert.equal(await page.evaluate(()=>document.getElementById('etTime')?.value),'17:00');
  await foot('הוסף').click();
  const linked=await page.evaluate(()=>{const c=Store.captures()[0],t=Store.task(c.taskId);return {state:c.state,title:t?.title,planned:t?.planned,at:t?.reminder?.at};});
  assert.deepEqual(linked,{state:'task',title:'להתקשר לרופא',planned:'2026-11-24',at:'17:00'});
  assert.equal(await page.locator('.ccard').count(),0);assert.equal(await page.locator('#capBadge').isVisible(),false);
  console.log('PASS Today card opens review; a note becomes a dated task with reminder in one save and leaves the count');

  await page.locator('#nav [data-s="capture"]').click();
  assert.match(await page.locator('.cbub.st-task').innerText(),/משימה/);
  await page.locator('.cbub.st-info .ctime').click();await page.locator('[data-capact="delete"]').click();
  assert.equal(await page.locator('.cbub').count(),1);
  await page.locator('#toast .un').click();assert.equal(await page.locator('.cbub').count(),2);
  console.log('PASS delete offers undo and restores the note');

  await input.fill('ב-3 לאסוף חבילה');await input.press('Enter');
  const alarms=await page.evaluate(()=>Native.alarmList(undefined,null).filter(a=>a.id.startsWith('cap_')).map(a=>a.id));
  assert.deepEqual(alarms,['cap_2026-11-23','cap_2026-11-24']);
  assert.match(await page.locator('.cbub').last().locator('.cchip').innerText(),/15:00 \?/);
  await page.evaluate(()=>window.__alarm('cap_2026-11-23'));assert.match(await page.locator('#mTitle').innerText(),/מיון פתקים/);
  await foot('סיום').click();
  console.log('PASS review alarm is scheduled with unsorted notes and opens review; an uncertain hour is marked');

  await page.locator('#nav [data-s="capture"]').click();
  await input.fill('תיעוד https://site.com/docs/#install וגם #תג "https://a.com"');await input.press('Enter');
  const last=page.locator('.cbub').last();
  assert.deepEqual(await last.locator('a').evaluateAll(a=>a.map(x=>x.getAttribute('href'))),['https://site.com/docs/#install','https://a.com/']);
  assert.deepEqual(await last.locator('.ctag').allInnerTexts(),['#תג']);
  await page.evaluate(()=>{const c=Store.addCapture('להתקשר לאמא מחר');c.createdAt=new Date('2026-11-22T09:00:00+02:00').getTime();
    const d=Store.addCapture('לשלם חשבון מחר');d.createdAt=new Date('2026-11-20T09:00:00+02:00').getTime();Store.commit();});
  const chips=await page.locator('.cbub .cchip').allInnerTexts();
  assert.ok(chips.includes('היום'),'yesterday\'s "tomorrow" is today: '+chips);assert.ok(chips.some(x=>/21\/11 · עבר/.test(x)),'past date is marked: '+chips);
  await page.locator('.cbub',{hasText:'לשלם חשבון'}).locator('.ctime').click();await page.locator('[data-capact="task"]').click();
  assert.equal(await page.evaluate(()=>document.getElementById('etDate')?.value||''),'');assert.equal(await page.evaluate(()=>document.getElementById('etTime')?.value||''),'');
  await page.locator('#mFoot').getByRole('button',{name:'ביטול',exact:true}).click();
  if(await page.locator('#modal.on').count())await page.locator('#mFoot button').last().click();
  await page.evaluate(()=>{for(const c of Store.captures().slice(-3))Store.delCapture(c.id);});
  console.log('PASS links with # and quotes stay intact; dates are labelled from today and passed dates are not preset');

  await page.locator('#nav [data-s="capture"]').click();
  await input.fill('טיוטה שלא נשלחה');await page.reload();await page.evaluate(()=>Engine.stop());
  assert.equal(await page.locator('#s-capture.on').count(),1);assert.equal(await input.inputValue(),'טיוטה שלא נשלחה');
  assert.equal(await page.locator('.cbub').count(),3);
  console.log('PASS draft and notes survive a reload, which opens on notes again');

  await page.evaluate(()=>{Settings.open('capture');UI.screen='settings';UI.render();});
  await page.locator('#capStartSw').click();assert.equal(await page.evaluate(()=>Store.all.prefs.captureStart),false);
  await page.locator('#capReviewSw').click();assert.equal(await page.evaluate(()=>Store.all.prefs.captureReview),'');
  await page.reload();assert.equal(await page.locator('#s-today.on').count(),1,'start screen setting is honoured');
  console.log('PASS settings turn off the start screen and the review reminder');

  await page.setViewportSize({width:1280,height:900});await page.locator('#nav [data-s="capture"]').click();
  await page.waitForTimeout(400);await page.screenshot({path:'test-results/capture-desktop.png'});
  assert.deepEqual(errors,[]);console.log('PASS no JavaScript errors');
}finally{await browser.close();server.close();}
