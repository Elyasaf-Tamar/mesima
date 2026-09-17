import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const nativeVersion=fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8').match(/versionName\s+["']([^"']+)["']/)[1];
const apkName=`Mesima-${version}-Android-${nativeVersion}-Firebase.apk`;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const original=JSON.parse(fs.readFileSync(path.join(root,'original-sha256.json')));
for(const [name,hash] of Object.entries(original)){
  if(sha(fs.readFileSync(path.join(root,'../App Version 4.4',name)))!==hash)throw Error(`Original changed: ${name}`);
}
const apk=path.join(root,'android/app/build/outputs/apk/release/app-release.apk');
if(fs.existsSync(apk)) fs.copyFileSync(apk,path.join(root,apkName));
const included=['index.html',apkName,`Mesima-${version}-Windows.zip`,'android-src.zip',`Mesima-${version}-source.zip`,`Mesima-${version}-GitHub.zip`].filter(f=>fs.existsSync(path.join(root,f)));
fs.writeFileSync(path.join(root,'SHA256SUMS.txt'),included.map(f=>`${sha(fs.readFileSync(path.join(root,f)))}  ${f}`).join('\n')+'\n');
console.log('Original 4.4 files unchanged; release files checksummed.');
