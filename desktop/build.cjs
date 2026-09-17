const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const c=JSON.parse(fs.readFileSync(path.join(root,'android/app/google-services.json'),'utf8'));
fs.writeFileSync(path.join(__dirname,'firebase-config.json'),JSON.stringify({project:c.project_info.project_id,bucket:c.project_info.storage_bucket,apiKey:c.client[0].api_key[0].current_key}));
fs.mkdirSync(path.join(__dirname,'app'),{recursive:true});fs.copyFileSync(path.join(root,'index.html'),path.join(__dirname,'app/index.html'));
async function build(){const {packager}=require('@electron/packager');const paths=await packager({dir:__dirname,electronZipDir:path.join(root,'../App Version 4.6/.build-tools'),name:'Mesima',platform:'win32',arch:'x64',out:path.join(__dirname,'dist'),overwrite:true,asar:true,ignore:[/^\/dist/,/^\/build.cjs/,/^\/node_modules/],appVersion:'4.8',win32metadata:{CompanyName:'Mesima',FileDescription:'משימה',ProductName:'Mesima'}});console.log(paths.join('\n'));}
build().catch(e=>{console.error(e.message);process.exit(1);});
