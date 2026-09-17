from pathlib import Path
import zipfile
r=Path(__file__).resolve().parents[1]
folder=r/'desktop/dist/Mesima-win32-x64'
assert (folder/'Mesima.exe').exists()
with zipfile.ZipFile(r/'Mesima-4.8-Windows.zip','w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(folder.rglob('*')):
  if p.is_file():z.write(p,Path('Mesima-win32-x64')/p.relative_to(folder))
 for name in ['Install-Mesima.ps1','README-4.8-HE.md','CHANGELOG-4.8-HE.md']:z.write(r/name,name)
print('Windows distribution archived', (r/'Mesima-4.8-Windows.zip').stat().st_size, 'bytes')
