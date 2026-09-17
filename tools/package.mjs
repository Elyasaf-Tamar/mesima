import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const original=JSON.parse(fs.readFileSync(path.join(root,'original-sha256.json')));
for(const [name,hash] of Object.entries(original)){
  if(sha(fs.readFileSync(path.join(root,'../App Version 4.4',name)))!==hash)throw Error(`Original changed: ${name}`);
}
const apk=path.join(root,'android/app/build/outputs/apk/release/app-release.apk');
if(fs.existsSync(apk)) fs.copyFileSync(apk,path.join(root,'Mesima-4.8-Android-1.7-Firebase.apk'));
const included=['index.html','Mesima-4.8-Android-1.7-Firebase.apk','Mesima-4.8-Windows.zip','android-src.zip','Mesima-4.8-source.zip','Mesima-4.8-GitHub.zip'].filter(f=>fs.existsSync(path.join(root,f)));
fs.writeFileSync(path.join(root,'SHA256SUMS.txt'),included.map(f=>`${sha(fs.readFileSync(path.join(root,f)))}  ${f}`).join('\n')+'\n');
console.log('Original 4.4 files unchanged; release files checksummed.');
