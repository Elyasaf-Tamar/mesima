from pathlib import Path
import zipfile,os,json
r=Path(__file__).resolve().parents[1]
version=json.loads((r/'package.json').read_text(encoding='utf8'))['version']
def allowed(p):
    rel=p.relative_to(r)
    return not any(x in {'.build-tools','build','.gradle','.git','node_modules','test-results','dist','app-dist'} for x in rel.parts) and p.suffix not in {'.jks','.keystore','.apk','.zip','.docx'} and p.name not in {'local.properties','google-services.json','SHA256SUMS.txt','firebase-config.json','test-results-store.html','test-results-stores.html'}
for filename,folder in [('android-src.zip',r/'android'),(f'Mesima-{version}-source.zip',r)]:
    with zipfile.ZipFile(r/filename,'w',zipfile.ZIP_DEFLATED) as z:
        for directory,dirs,files in os.walk(folder):
            dirs[:]=sorted(d for d in dirs if d not in {'.build-tools','build','.gradle','.git','node_modules','test-results','dist','app-dist'})
            for name in sorted(files):
                p=Path(directory)/name
                if allowed(p):z.write(p,p.relative_to(r))
    with zipfile.ZipFile(r/filename) as z:
        assert not any(n.endswith(('.jks','.keystore','google-services.json')) for n in z.namelist())
    print(filename, (r/filename).stat().st_size, 'bytes; private keys and build caches excluded')

