"""Check the native version contract in a built APK, not merely in its source."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('apk', type=Path)
parser.add_argument('--build-tools', type=Path)
args = parser.parse_args()
build_tools = args.build_tools
if build_tools is None:
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not sdk:
        parser.error('Supply --build-tools or ANDROID_HOME')
    build_tools = Path(sdk) / 'build-tools' / '35.0.0'
suffix = '.exe' if os.name == 'nt' else ''
badging = subprocess.check_output([str(build_tools / ('aapt' + suffix)), 'dump', 'badging', str(args.apk)], text=True, encoding='utf8')
package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
if not package:
    raise SystemExit('FAIL: APK package metadata is missing')
package_id, code, manifest_version = package.groups()
bridge_version = None
with zipfile.ZipFile(args.apk) as archive, tempfile.TemporaryDirectory() as temporary:
    html = archive.read('assets/index.html').decode('utf8')
    needed = re.search(r"const NEED_APK = '([^']+)'", html).group(1)
    for name in archive.namelist():
        if not re.fullmatch(r'classes\d*\.dex', name):
            continue
        data = archive.read(name)
        if b'Lil/mesima/app/WebBridge;' not in data:
            continue
        dex = Path(temporary) / name
        dex.write_bytes(data)
        process = subprocess.Popen([str(build_tools / ('dexdump' + suffix)), '-d', str(dex)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding='utf8', errors='replace')
        in_class = in_method = False
        try:
            for line in process.stdout:
                if 'Class descriptor' in line:
                    in_class = 'Lil/mesima/app/WebBridge;' in line
                    in_method = False
                if in_class and re.search(r"name\s+: 'version'", line):
                    in_method = True
                if in_method:
                    constant = re.search(r'const-string(?:/jumbo)?\s+v\d+, "([^"]+)"', line)
                    if constant:
                        bridge_version = constant.group(1)
                    if 'return-object' in line:
                        break
        finally:
            if process.poll() is None:
                process.terminate()
            process.wait()
            process.stdout.close()
        if bridge_version is not None:
            break
if bridge_version != manifest_version:
    raise SystemExit(f'FAIL: packaged bridge reports {bridge_version!r}, APK manifest reports {manifest_version!r}')
def version(value):
    return tuple(int(part) for part in value.split('.'))
if version(bridge_version) < version(needed):
    raise SystemExit(f'FAIL: embedded web requires APK {needed}, bridge reports {bridge_version}')
print(f'PASS: {package_id}, versionCode={code}, manifest={manifest_version}, packaged bridge={bridge_version}, web minimum={needed}')
