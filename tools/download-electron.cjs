const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
(async()=>{const name='electron-v44.2.0-win32-x64.zip',dest=path.resolve('.build-tools',name);fs.mkdirSync(path.dirname(dest),{recursive:true});
 const start=fs.existsSync(dest)?fs.statSync(dest).size:0;
 const r=await fetch('https://github.com/electron/electron/releases/download/v44.2.0/'+name,{headers:start?{Range:'bytes='+start+'-'}:{},signal:AbortSignal.timeout(600000)});if(!r.ok)throw Error('Download failed '+r.status);
 await pipeline(r.body,fs.createWriteStream(dest,{flags:r.status===206?'a':'w'}));const hash=crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
 const expected=require('../desktop/node_modules/electron/checksums.json')[name];if(hash!==expected)throw Error('Checksum mismatch');console.log('Electron runtime downloaded; official SHA-256 verified');
})().catch(e=>{console.error(e.message);process.exit(1);});
