from pathlib import Path
import os,re,subprocess,zipfile,hashlib
r=Path(__file__).resolve().parents[1]
apk=r/'android/app/build/outputs/apk/release/app-release.apk'
with zipfile.ZipFile(apk) as z:
    assert z.read('assets/index.html')==(r/'index.html').read_bytes(),'APK contains stale HTML'
with zipfile.ZipFile(r.parent/'App Version 4.4/android-src.zip') as z:
    old=z.read('android/app/build.gradle').decode('utf8')
    assert z.read('android/app/mesima.jks')==(r/'android/app/mesima.jks').read_bytes(),'Signing key changed'
def setting(name):
    line=next(x for x in old.splitlines() if x.strip().startswith(name))
    return re.findall(r'''['"]([^'"]+)['"]''',line)[-1]
env=os.environ.copy();jdk=next((r.parent/'App Version 4.5/.build-tools/jdk').iterdir())
env.update(JAVA_HOME=str(jdk),MESIMA_STORE_PASSWORD=setting('storePassword'))
cert=subprocess.run([str(jdk/'bin/keytool.exe'),'-exportcert','-keystore',str(r/'android/app/mesima.jks'),
    '-alias',setting('keyAlias'),'-storepass:env','MESIMA_STORE_PASSWORD'],env=env,check=True,capture_output=True).stdout
check=subprocess.run([str(r.parent/'App Version 4.5/.build-tools/sdk/build-tools/35.0.0/apksigner.bat'),'verify','--verbose','--print-certs',str(apk)],env=env,check=True,capture_output=True,text=True)
digest=hashlib.sha256(cert).hexdigest()
assert digest in check.stdout.lower(),'APK signed with unexpected certificate'
print('PASS release signature matches original 4.4 key; APK contains exact current index.html')
print('Certificate SHA-256:',digest)
badging=subprocess.run([str(r.parent/'App Version 4.5/.build-tools/sdk/build-tools/35.0.0/aapt.exe'),'dump','badging',str(apk)],check=True,capture_output=True,text=True,encoding='utf8').stdout
print(badging.splitlines()[0])

