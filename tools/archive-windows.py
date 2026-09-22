from pathlib import Path
import zipfile,json
r=Path(__file__).resolve().parents[1]
version=json.loads((r/'package.json').read_text())['version']
folder=r/'desktop/dist/Mesima-win32-x64'
assert (folder/'Mesima.exe').exists()
archive=r/f'Mesima-{version}-Windows.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(folder.rglob('*')):
  if p.is_file():z.write(p,Path('Mesima-win32-x64')/p.relative_to(folder))
 for name in ['Install-Mesima.ps1',f'README-{version}-HE.md',f'CHANGELOG-{version}-HE.md']:z.write(r/name,name)
print('Windows distribution archived', archive.stat().st_size, 'bytes')
