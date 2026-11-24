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
  assert.equal(await plainLeak('1234'),false,'no plaintext in the store or localStorage');
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
  assert.equal(await plainLeak('9876'),false,'secret mode keeps no draft');
  await page.locator('#capInput').press('Enter');
  await page.fill('#vPw',PW);await foot('פתח').click();
  await page.waitForFunction(()=>Store.secrets().length===2);
  assert.equal(await page.locator('#capBar.secret').count(),0);assert.equal(await page.locator('#capInput').inputValue(),'');
  assert.equal(await plainLeak('9876'),false);assert.equal(await page.evaluate(()=>Vault.unlocked()),false,'relocked after use');
  await page.fill('#capInput','פרטי כרטיס 5555');await page.locator('#capInput').press('Enter');
  await page.locator('.cbub').last().locator('.ctime').click();await page.locator('[data-capact="vault"]').click();
  await page.fill('#vPw',PW);await foot('פתח').click();
  await page.waitForFunction(()=>Store.secrets().length===3&&!Store.captures().length);
  assert.equal(await plainLeak('5555'),false);
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
  await page.waitForFunction(()=>Store.secrets().length===4);assert.equal(await plainLeak('777'),false);
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

  await page.reload();await page.evaluate(()=>Engine.stop());
  assert.equal(await page.evaluate(()=>Vault.unlocked()),false);
  await page.evaluate(()=>{UI.screen='vault';UI.render();});await page.locator('#vUnlock').waitFor();
  await page.waitForTimeout(300);await page.screenshot({path:'test-results/vault-locked.png'});
  assert.deepEqual(errors,[]);console.log('PASS reload starts locked; no JavaScript errors');
}finally{await browser.close();server.close();}
