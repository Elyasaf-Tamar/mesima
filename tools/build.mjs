import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const files=JSON.parse(read('build-manifest.json'));
for(const file of files) new vm.Script(read(file),{filename:file});
const js=files.map(f=>read(f)).join('\n');
new vm.Script(js,{filename:'mesima.js'});
const html=read('src/shell.html').replace('/* BUILD_STYLES */',()=>read('src/styles.css')).replace('/* BUILD_SCRIPTS */',()=>js);
for(const file of ['index.html','android/app/src/main/assets/index.html']){
  const dest=path.join(root,file); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,html);
}
console.log(`Built ${files.length} source parts → index.html + Android asset (${Buffer.byteLength(html)} bytes)`);
