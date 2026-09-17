import path from 'node:path';import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const {_electron}=await import(pathToFileURL(process.env.MESIMA_PLAYWRIGHT));
const app=await _electron.launch({executablePath:path.resolve('desktop/dist/Mesima-win32-x64/Mesima.exe'),env:{...process.env,MESIMA_TEST_DATA:path.resolve('test-results/search-live-'+Date.now())},timeout:20000});
try{const p=await app.firstWindow();await p.waitForFunction(()=>typeof Search!=='undefined');await p.evaluate(()=>{Engine.stop();Store.setPref('syncEnabled',false);});
 for(const [q,area] of [['סטימצקי','גן שמואל'],['דיזנגוף סנטר','תל אביב']]){
  const r=await p.evaluate(async([q,area])=>Search.run(q,area),[q,area]);assert.ok(r.results.length,'No results for '+q);console.log(JSON.stringify({q,count:r.results.length,first:r.results.slice(0,3)},null,2));
 }
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setSize(1920,1080);});await p.evaluate(()=>{UI.section='tasks';UI.screen=null;Store.addTask({title:'תכנון השבוע',kind:'long',mission:'free',note:'כל הפרויקטים והצעדים הבאים, במקום אחד'});UI.render();});await p.waitForTimeout(300);await p.screenshot({path:'test-results/windows-47-live.png'});
}finally{await app.close();}
