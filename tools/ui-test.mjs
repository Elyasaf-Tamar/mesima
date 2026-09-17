import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.MESIMA_PLAYWRIGHT?pathToFileURL(process.env.MESIMA_PLAYWRIGHT):'playwright');
const html=fs.readFileSync(path.join(root,'index.html'));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.MESIMA_CHROME?{executablePath:process.env.MESIMA_CHROME}:{})});
const ctx=await browser.newContext({viewport:{width:412,height:915},permissions:['clipboard-read','clipboard-write']});
const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(5000);
const out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>Engine.stop());
  const foot=name=>page.locator('#mFoot').getByRole('button',{name,exact:true});
  const lists=()=>page.evaluate(()=>Store.all.tasks.flatMap(t=>t.checklists||[]));
  const openParent=async()=>{
    await page.evaluate(()=>{Modal.shut();UI.screen=null;UI.section='tasks';UI.render();});
    await page.locator('#tasksBody .tcard').filter({hasText:'בדיקת גרסה'}).first().locator('[data-act="detail"]').first().click();
  };
  const newList=async name=>{await page.locator('#clNew').fill(name);await foot('צור').click();};
  await page.locator('#nav [data-s="tasks"]').click();
  await page.locator('#fab').click();await page.locator('[data-f="new"]').click();
  await page.locator('#etTitle').fill('בדיקת גרסה');
  await page.locator('#etKind [data-k="long"]').click();
  await page.locator('#etAddList').click();await page.locator('#clNew').fill('לא לשמור');
  await page.evaluate(()=>Modal.tryShut());
  assert.equal(await page.locator('#etTitle').inputValue(),'בדיקת גרסה');
  assert.equal((await lists()).length,0);
  await page.locator('#etAddList').click();await newList('טיוטה');
  await page.locator('[data-clremove]').click();await foot('הוסף').click();
  assert.equal((await lists()).length,0);console.log('PASS new-parent cancel and explicit draft removal');

  await openParent();await foot('ערוך משימה').click();
  await page.locator('#etAddList').click();await newList('צ׳קליסט ממתין');
  await page.locator('.newit').fill('דרכון');await page.locator('.newit').press('Enter');
  assert.equal((await lists()).length,0);
  await page.evaluate(()=>Modal.tryShut());await foot('זרוק').click();
  assert.equal((await lists()).length,0);console.log('PASS abandoned checklist in existing-parent editor leaves no data');

  await openParent();await page.locator('[data-d="addlist"]').click();
  assert.equal(await page.locator('#clOnceBox').count(),1);
  await newList('דרך המסך המאוחד');await page.locator('#draftClInput').fill('פריט');
  await page.locator('#draftClAdd').click();await foot('בטל צ׳קליסט').click();
  assert.equal((await lists()).length,0);console.log('PASS shared standalone checklist UI and cancellation');

  await openParent();await page.locator('[data-d="addlist"]').click();
  await page.locator('#clKind [data-ck="rep"]').click();
  await newList('רשימה חוזרת');await page.locator('#draftClInput').fill('דרכון');
  await foot('שמור צ׳קליסט').click();
  assert.equal((await lists())[0].items[0].title,'דרכון');
  assert.ok((await lists())[0].repeat.days.length);
  await page.reload();await page.evaluate(()=>Engine.stop());
  assert.ok((await lists())[0].repeat.days.length);console.log('PASS create recurring checklist and reload');

  await openParent();await foot('ערוך משימה').click();
  await page.locator('[data-etcl]').first().click();await page.locator('.newit').fill('מטען');
  await foot('שמור').click();
  assert.ok((await lists())[0].items.some(x=>x.title==='מטען'));console.log('PASS save includes focused pending item');
  await openParent();await foot('ערוך משימה').click();
  await page.locator('[data-iedit]').first().click();
  await page.locator('.ie[data-fld="title"]').fill('דרכון בתוקף');
  await foot('שמור').click();assert.equal((await lists())[0].items[0].title,'דרכון בתוקף');
  console.log('PASS save includes focused checklist-item edit');

  const child=await page.evaluate(()=>Store.addTask({title:'ילד',note:'תיאור להעתקה בלי עריכה',kind:'short',mission:'army',parentId:Store.all.tasks.find(t=>t.title==='בדיקת גרסה').id}).id);
  await page.evaluate(()=>{Modal.shut();UI.render();});
  await page.locator(`[data-copy-note-id="${child}"]`).first().click();
  assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'תיאור להעתקה בלי עריכה');
  assert.equal(await page.locator('#etTitle').count(),0);console.log('PASS copy description without opening editor');
  await page.screenshot({path:path.join(out,'tasks.png'),fullPage:true});

  await page.locator('#fab').click();await page.locator('[data-f="new"]').click();
  await page.locator('#etTitle').fill('משימה פשוטה');
  await page.locator('#etToCheck').click();
  await page.locator('#etUnCheck').click();await foot('הוסף').click();
  assert.equal(await page.evaluate(()=>Store.all.tasks.find(t=>t.title==='משימה פשוטה').checklists.length),0);
  console.log('PASS revert checklist conversion restores simple task');

  await page.locator('#topMenu').click();await page.locator('[data-go="settings"]').click();
  await page.locator('[data-settings-page="data"]').click();
  await page.evaluate(()=>Settings.open('archive'));
  assert.equal(await page.locator('#archiveDays').inputValue(),'0');
  await page.locator('#archiveDays').selectOption('30');await foot('ביטול').click();
  await page.evaluate(()=>Settings.open('archive'));
  assert.equal(await page.locator('#archiveDays').inputValue(),'0');
  await page.locator('#archiveDays').selectOption('30');await foot('הפעל').click();
  assert.equal(await page.locator('#archiveDays').inputValue(),'30');
  await page.screenshot({path:path.join(out,'settings.png'),fullPage:true});
  console.log('PASS opt-in archive retention confirmation');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('UI tests complete; no browser errors.');
}catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.error('Browser errors:',errors);throw e;}
finally{await browser.close();await new Promise(r=>server.close(r));}
