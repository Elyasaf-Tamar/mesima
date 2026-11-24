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
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
fs.mkdirSync('test-results',{recursive:true});
const foot=n=>page.locator('#mFoot').getByRole('button',{name:n,exact:true});
const plainLeak=async word=>page.evaluate(w=>JSON.stringify(Store.all).includes(w)||Object.keys(localStorage).some(k=>String(localStorage.getItem(k)).includes(w)),word);
const PW='סיסמה ארוכה 2026',PW2='new pass phrase!';
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>{Engine.stop();Store.setPref('syncEnabled',false);});
  await page.locator('#nav [data-s="library"]').click();await page.locator('[data-lib="vault"]').click();
  await page.locator('#vSetup').waitFor();
  await page.fill('#vNew1',PW);await page.fill('#vNew2','different one');await page.locator('#vSetup button[type=submit]').click();
  assert.match(await page.locator('#vErr').innerText(),/לא זהות/);
  await page.fill('#vNew2',PW);await page.locator('#vSetup button[type=submit]').click();
  await page.locator('.vcode').waitFor();
  const code=(await page.locator('.vcode').innerText()).trim();assert.match(code,/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  await foot('סיום').click();assert.match(await page.locator('#vErr').innerText(),/סמן/);
  await page.locator('#vSaved').check();await foot('סיום').click();
  await page.locator('[data-vact="new"]').waitFor();
  console.log('PASS setup checks the password, shows a recovery code once and requires confirming it was saved');

  await page.locator('[data-vact="new"]').click();await page.fill('#vText','סיסמת בנק 1234\nשורה שנייה');await foot('שמור').click();
  await page.locator('[data-vitem]').first().waitFor();
  assert.match(await page.locator('[data-vitem]').first().innerText(),/סיסמת בנק 1234/);
  assert.equal(await plainLeak('סיסמת בנק'),false,'no plaintext in the store or localStorage');
  assert.equal(await page.evaluate(()=>Store.secrets().length),1);
  await page.waitForTimeout(300);await page.screenshot({path:'test-results/vault-open.png'});
  console.log('PASS a secret note is listed while open and stored only encrypted');

  await page.locator('[data-vact="lock"]').click();await page.locator('#vUnlock').waitFor();
  assert.equal(await page.locator('[data-vitem]').count(),0);
  await page.fill('#vPwMain','wrong password');await page.locator('#vUnlock button[type=submit]').click();
  await page.waitForFunction(()=>/שגויה/.test(document.getElementById('vErr')?.textContent||''));
  await page.fill('#vPwMain',PW);await page.locator('#vUnlock button[type=submit]').click();
  await page.locator('[data-vitem]').first().waitFor();
  await page.locator('[data-vitem]').first().click();assert.match(await page.locator('.vtext').innerText(),/שורה שנייה/);await foot('ערוך').click();
  await page.fill('#vText','סיסמת בנק 4321');await foot('שמור').click();
  await page.waitForFunction(()=>/4321/.test(document.querySelector('[data-vitem]')?.textContent||''));
  console.log('PASS lock hides everything; a wrong password is refused; the right one reopens; edit re-encrypts');

  await page.locator('#nav [data-s="today"]').click();await page.waitForTimeout(1200);
  assert.equal(await page.evaluate(()=>Vault.unlocked()),false,'leaving the vault locks it');
  console.log('PASS leaving the vault screen locks it');

  await page.locator('#nav [data-s="capture"]').click();
  await page.locator('#capLock').click();assert.equal(await page.locator('#capBar.secret').count(),1);
  await page.fill('#capInput','קוד כספומט 9876');
  assert.equal(await plainLeak('כספומט'),false,'secret mode keeps no draft');
  await page.locator('#capInput').press('Enter');
  await page.fill('#vPw',PW);await foot('פתח').click();
  await page.waitForFunction(()=>Store.secrets().length===2);
  assert.equal(await page.locator('#capBar.secret').count(),0);assert.equal(await page.locator('#capInput').inputValue(),'');
  assert.equal(await plainLeak('כספומט'),false);assert.equal(await page.evaluate(()=>Vault.unlocked()),false,'relocked after use');
  await page.fill('#capInput','פרטי כרטיס 5555');await page.locator('#capInput').press('Enter');
  await page.locator('.cbub').last().locator('.ctime').click();await page.locator('[data-capact="vault"]').click();
  await page.fill('#vPw',PW);await foot('פתח').click();
  await page.waitForFunction(()=>Store.secrets().length===3&&!Store.captures().length);
  assert.equal(await plainLeak('פרטי כרטיס'),false);
  console.log('PASS the lock button and "move to vault" store notes encrypted, leave no plain copy and relock');

  await page.locator('#nav [data-s="library"]').click();await page.locator('[data-lib="vault"]').click();
  await page.locator('[data-vact="forgot"]').click();
  await page.fill('#vRc',code.toLowerCase().replace(/-/g,' '));await page.fill('#vN1',PW2);await page.fill('#vN2',PW2);await foot('שחזר').click();
  await page.locator('[data-vitem]').nth(2).waitFor();
  const texts=await page.locator('[data-vitem] .t').allInnerTexts();
  assert.deepEqual(texts.sort(),['סיסמת בנק 4321','פרטי כרטיס 5555','קוד כספומט 9876'].sort());
  await page.locator('[data-vact="lock"]').click();
  await page.fill('#vPwMain',PW);await page.locator('#vUnlock button[type=submit]').click();
  await page.waitForFunction(()=>/שגויה/.test(document.getElementById('vErr')?.textContent||''));
  await page.fill('#vPwMain',PW2);await page.locator('#vUnlock button[type=submit]').click();await page.locator('[data-vitem]').first().waitFor();
  console.log('PASS the recovery code sets a new password; the old password stops working');

  // Review fixes: an open editor is sealed on lock; the recovery dialog survives a lock; a new code applies only after confirming.
  await page.locator('[data-vact="new"]').click();await page.fill('#vText','טיוטה חצי כתובה 777');
  await page.evaluate(()=>Vault.lock());
  await page.waitForFunction(()=>Store.secrets().length===4);assert.equal(await plainLeak('חצי כתובה'),false);
  await page.fill('#vPwMain',PW2);await page.locator('#vUnlock button[type=submit]').click();await page.locator('[data-vitem]').first().waitFor();
  assert.ok((await page.locator('[data-vitem] .t').allInnerTexts()).includes('טיוטה חצי כתובה 777'));
  const rcBefore=await page.evaluate(()=>Store.vaultKeys()[0].rc);
  await page.locator('[data-vact="recovery"]').click();await page.fill('#vOld',PW2);await foot('צור קוד').click();
  await page.locator('.vcode').waitFor();const code2=(await page.locator('.vcode').innerText()).trim();
  assert.equal(await page.evaluate(()=>Store.vaultKeys()[0].rc),rcBefore,'old code still valid until confirmed');
  await page.evaluate(()=>Vault.lock());assert.equal(await page.locator('.vcode').count(),1,'recovery dialog survives a lock');
  await page.locator('#vSaved').check();await foot('סיום').click();
  assert.notEqual(await page.evaluate(()=>Store.vaultKeys()[0].rc),rcBefore);
  await page.locator('[data-vact="forgot"]').click();await page.fill('#vRc',code2);await page.fill('#vN1',PW);await page.fill('#vN2',PW);await foot('שחזר').click();
  await page.locator('[data-vitem]').first().waitFor();
  console.log('PASS lock seals an open editor, keeps the recovery dialog, and a new code applies only after confirming');

  // Fingerprint (APK 1.8.3 bridge), mocked: enable stores the password natively; unlock returns it after a "scan".
  await page.evaluate(()=>{window.__bioLog=[];let stored=null;window.MesimaNative={
    vaultBioAvailable:()=>true,vaultBioEnabled:()=>stored!==null,vaultBioDisable(){stored=null;__bioLog.push('off');},
    vaultBioEnable(pw){stored=pw;setTimeout(()=>window.__vaultBio({op:'enable',ok:true,error:''}),20);},
    vaultBioUnlock(){setTimeout(()=>window.__vaultBio(stored?{op:'unlock',ok:true,password:stored,error:''}:{op:'unlock',ok:false,password:'',error:'off'}),20);},
    setSecure(on){__bioLog.push('secure:'+on);},copySensitive(t){__bioLog.push('copy:'+t.length);return true;}};UI.render();});
  await page.locator('[data-vact="bio-toggle"]').waitFor();await page.locator('[data-vact="bio-toggle"]').click();
  await page.fill('#vOld','wrong one!');await foot('המשך').click();await page.waitForFunction(()=>/שגויה/.test(document.getElementById('vErr')?.textContent||''));
  await page.fill('#vOld',PW);await foot('המשך').click();
  await page.waitForFunction(()=>window.MesimaNative.vaultBioEnabled());
  await page.locator('[data-vact="lock"]').click();await page.locator('#vUnlock').waitFor();
  await page.locator('[data-vact="bio"]').click();await page.locator('[data-vitem]').first().waitFor();
  const log=await page.evaluate(()=>__bioLog);assert.ok(log.includes('secure:true')&&log.includes('secure:false'),'protected screen follows the lock: '+log);
  await page.locator('[data-vitem]').first().click();await foot('העתק').click();
  assert.ok((await page.evaluate(()=>__bioLog)).some(x=>x.startsWith('copy:')),'copy uses the sensitive native clipboard');
  await page.evaluate(()=>Modal.shut());
  await page.locator('#nav [data-s="capture"]').click();await page.locator('#capLock').click();await page.fill('#capInput','דרך טביעת אצבע 31');await page.locator('#capInput').press('Enter');
  await page.waitForFunction(()=>Store.secrets().length===5);assert.equal(await page.evaluate(()=>Vault.unlocked()),false);
  await page.evaluate(()=>window.__vaultLock());
  await page.locator('#nav [data-s="library"]').click();await page.locator('[data-lib="vault"]').click();
  await page.locator('[data-vitem]').first().waitFor(); // auto fingerprint prompt on entering the vault
  await page.locator('[data-vact="password"]').click();await page.fill('#vOld',PW);await page.fill('#vN1',PW2);await page.fill('#vN2',PW2);await foot('שנה').click();
  await page.waitForFunction(()=>!window.MesimaNative.vaultBioEnabled());
  await page.evaluate(()=>{delete window.MesimaNative;});
  console.log('PASS fingerprint enable/unlock, auto prompt, protected screen, sensitive copy; a password change turns it off');

  // 4.9.6: an existing note moves to the vault with its formatting and parts, and can come back.
  await page.evaluate(()=>Vault.lock());
  const ids=await page.evaluate(()=>{
    const a=Store.addNote({title:'הערה מעוצבת',html:'<p><b>מודגש סודי</b> ורגיל</p><ul><li>פריט ברשימה</li></ul><img src="x" onerror="window.__xss=1"><script>window.__xss=2</script>'});
    const b=Store.addNote({title:'הערה בחלקים'});const now=Date.now();
    Store.updateNote(b.id,{multipart:true,parts:{p1:{id:'p1',title:'חלק ראשון',html:'<p>תוכן חלק א</p>',order:0,createdAt:now,updatedAt:now},p2:{id:'p2',title:'חלק שני',html:'<p><i>תוכן חלק ב</i></p>',order:1,createdAt:now+1,updatedAt:now}}});
    UI.screen='notes';UI.openNote=null;UI.render();return [a.id,b.id];});
  const before=await page.evaluate(()=>Store.secrets().length);
  await page.locator(`#notesList [data-id="${ids[0]}"] [data-act="nMenu"]`).click();
  await page.locator('#mBody [data-m="vault"]').click();
  await page.fill('#vPw',PW2);await foot('פתח').click();
  await page.waitForFunction(([id,n])=>!Store.note(id)&&Store.secrets().length===n+1,[ids[0],before]);
  assert.equal(await plainLeak('מודגש סודי'),false,'the moved note leaves no plain copy');
  assert.equal(await page.evaluate(()=>Vault.unlocked()),false,'relocked after moving');
  await page.locator(`#notesList [data-id="${ids[1]}"] [data-act="nMenu"]`).click();
  await page.locator('#mBody [data-m="vault"]').click();
  await page.fill('#vPw',PW2);await foot('פתח').click();
  await page.waitForFunction(([id,n])=>!Store.note(id)&&Store.secrets().length===n+2,[ids[1],before]);
  assert.equal(await plainLeak('תוכן חלק א'),false);
  await page.locator('#nav [data-s="library"]').click();await page.locator('[data-lib="vault"]').click();
  await page.fill('#vPwMain',PW2);await page.locator('#vUnlock button[type=submit]').click();
  await page.locator('[data-vitem]').first().waitFor();
  await page.locator('[data-vitem]',{hasText:'הערה מעוצבת'}).click();
  assert.equal(await page.locator('#mBody .note-reading b').innerText(),'מודגש סודי','bold kept');
  assert.equal(await page.locator('#mBody .note-reading li').count(),1,'list kept');
  assert.equal(await page.locator('#mBody script').count(),0);assert.equal(await page.evaluate(()=>window.__xss),undefined,'html is sanitized');
  await page.waitForTimeout(300);await page.screenshot({path:'test-results/vault-rich-note.png'});
  await foot('ערוך').click();
  await page.locator('[data-vedit] .vbody').click();await page.keyboard.press('End');await page.keyboard.type(' תוספת חדשה');
  await foot('שמור').click();await page.waitForFunction(()=>!document.querySelector('[data-vedit]'));
  await page.locator('[data-vitem]',{hasText:'הערה מעוצבת'}).click();
  assert.match(await page.locator('#mBody .note-reading').innerText(),/תוספת חדשה/);
  assert.equal(await page.locator('#mBody .note-reading b').count(),1,'formatting survives editing');
  await page.evaluate(()=>Modal.shut());
  await page.locator('[data-vact="search"],#vSearch').first().fill('חלק ב');
  await page.waitForFunction(()=>document.querySelectorAll('[data-vitem]').length===1);
  await page.locator('[data-vitem]').first().click();
  assert.equal(await page.locator('#mBody .vpart').count(),2,'both parts shown');
  await page.locator('[data-vact="to-notes"]').click();await foot('החזר להערות').click();
  await page.waitForFunction(()=>Store.notes().some(n=>n.title==='הערה בחלקים'&&n.multipart&&Object.keys(n.parts).length===2));
  assert.equal(await page.evaluate(()=>Store.secrets().length),before+1);
  console.log('PASS an existing note (formatted or in parts) moves to the vault, stays formatted and sanitized, edits, searches and can return to notes');

  await page.reload();await page.evaluate(()=>Engine.stop());
  assert.equal(await page.evaluate(()=>Vault.unlocked()),false);
  await page.evaluate(()=>{UI.screen='vault';UI.render();});await page.locator('#vUnlock').waitFor();
  await page.waitForTimeout(300);await page.screenshot({path:'test-results/vault-locked.png'});
  assert.deepEqual(errors,[]);console.log('PASS reload starts locked; no JavaScript errors');
}finally{await browser.close();server.close();}
