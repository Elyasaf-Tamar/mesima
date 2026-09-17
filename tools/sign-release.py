from pathlib import Path
import os,re,subprocess,zipfile
r=Path(__file__).resolve().parents[1]
cache=r.parent/'App Version 4.5/.build-tools'
with zipfile.ZipFile(r.parent/'App Version 4.4/android-src.zip') as z:
    old=z.read('android/app/build.gradle').decode('utf8')
def setting(name):
    line=next((line for line in old.splitlines() if line.strip().startswith(name)),None)
    values=re.findall(r'''['"]([^'"]+)['"]''',line or '')
    if not values: raise RuntimeError('Original signing configuration missing: '+name)
    return values[-1]
env=os.environ.copy()
env.update(MESIMA_KEYSTORE=str(r/'android/app/mesima.jks'),
           MESIMA_STORE_PASSWORD=setting('storePassword'),MESIMA_KEY_ALIAS=setting('keyAlias'),
           MESIMA_KEY_PASSWORD=setting('keyPassword'),
           JAVA_HOME=str(next((cache/'jdk').iterdir())),
           ANDROID_HOME=str(cache/'sdk'),GRADLE_USER_HOME=str(cache/'gradle-cache'))
result=subprocess.run([str(cache/'gradle-8.9/bin/gradle.bat'),'-p',str(r/'android'),
                       '--offline','--no-daemon','assembleRelease','testDebugUnitTest'],env=env)
raise SystemExit(result.returncode)

