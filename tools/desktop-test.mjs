import path from 'node:path';import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {_electron}=await import(pathToFileURL(process.env.MESIMA_PLAYWRIGHT));
const profile=path.resolve('test-results/desktop-profile-'+Date.now()),exe=path.resolve('desktop/dist/Mesima-win32-x64/Mesima.exe');
let app;const errors=[];
async function launch(){const instance=await _electron.launch({executablePath:exe,env:{...process.env,MESIMA_TEST_DATA:profile},timeout:20000});instance.process().stderr.on('data',d=>{const s=d.toString();if(s.includes('Error:'))errors.push(s.slice(0,1000));});return instance;}
try{
 app=await launch();let p=await app.firstWindow({timeout:20000});await p.waitForFunction(()=>typeof Store!=='undefined'&&!!window.DesktopBackup,{},{timeout:20000});
 const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
 assert.equal(await app.evaluate(({app})=>app.getVersion()),version);
 assert.equal(await p.evaluate(()=>BUILD.split(' · ')[0]),version);
 await p.evaluate(()=>{Engine.stop();Store.setPref('syncEnabled',false);Store.addTask({title:'desktop persisted',kind:'long',mission:'army',note:'local'});UI.section='tasks';UI.render();});
 assert.equal(await p.evaluate(()=>typeof require),'undefined');assert.equal(await p.evaluate(()=>DataCare.status().cloud.configured),true);
 assert.equal(await p.evaluate(()=>typeof window.MesimaDesktop.syncRequest),'function');
 await p.evaluate(async()=>{
  const task=Store.addTask({title:'completed on desktop',mission:'free'});Store.finishTask(task.id);Store.setReflection('day',Plan.today(),'desktop reflection persists');
  const habit=Store.addTask({title:'cancel snooze test',repeat:{days:[0,1,2,3,4,5,6],times:['23:59']}}),alarm=Native.alarmList().find(a=>a.taskId===habit.id);
  await window.MesimaDesktop.snooze(alarm);Store.tickHabit(habit.id,alarm.day);await window.MesimaDesktop.schedule(Native.alarmList(),NativeState.projection());
 });
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile,'snoozes.json'),'utf8')),[]);
 assert.equal((await p.evaluate(()=>window.MesimaDesktop.syncRequest({url:'https://example.invalid',expectedUid:'test'}))).error,'AUTH');
 await p.evaluate(()=>{
  const past=Plan.shift(Plan.today(),-1),t=Store.addTask({title:'Yesterday on Windows'});
  Store.finishTask(t.id,new Date(past+'T14:30:00').getTime());
  UI.section='today';UI.tview='month';UI.selDate=past;UI.render();
 });
 assert.equal(await p.locator('#mDay .reflection-head').count(),1);
 await p.locator('#mDay .reflection-head').first().click();
 assert.match(await p.locator('#mDay .reflection-items').innerText(),/Yesterday on Windows/);
 // Hidden native windows need not paint; screenshots are optional, not a persistence check.
 if(process.env.MESIMA_CAPTURE_DESKTOP)await p.screenshot({path:'test-results/desktop.png'});
 await p.evaluate(()=>{UI.screen='settings';Settings.open('cloud');});assert.equal(await p.locator('[data-care="login"]').count(),1);
 await app.close();app=null;
 app=await launch();p=await app.firstWindow();await p.waitForFunction(()=>typeof Store!=='undefined');assert.ok(await p.evaluate(()=>Store.all.tasks.some(t=>t.title==='desktop persisted')));
 assert.equal(await p.evaluate(()=>Store.reflection('day',Plan.today())),'desktop reflection persists');assert.ok(await p.evaluate(()=>Store.completionsFor(Plan.today()).some(x=>x.title==='completed on desktop')));
 assert.ok(fs.existsSync(path.join(profile,'snapshot.json')));assert.deepEqual(errors,[]);
 console.log('PASS packaged Windows app launch, isolated renderer, cloud UI, local snapshot and persistence after restart');
}finally{if(app)await app.close();}
