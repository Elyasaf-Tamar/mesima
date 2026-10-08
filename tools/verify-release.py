"""Verify the current HTML, native version and the expected release certificate."""
from pathlib import Path
import argparse
import hashlib
import re
import shutil
import subprocess
import sys
import zipfile
from android_tools import ROOT, environment, sdk_tool


def expected_certificate(env):
    expected = re.sub(r'[:\s]', '', env.get('MESIMA_SIGNING_CERT_SHA256', '')).lower()
    if expected:
        if not re.fullmatch('[0-9a-f]{64}', expected):
            raise RuntimeError('MESIMA_SIGNING_CERT_SHA256 must be the expected 64-digit SHA-256 fingerprint')
        return expected
    if not all(env.get(key) for key in ['MESIMA_KEYSTORE', 'MESIMA_STORE_PASSWORD', 'MESIMA_KEY_ALIAS']):
        raise RuntimeError('Supply MESIMA_SIGNING_CERT_SHA256, or the existing MESIMA_KEYSTORE, MESIMA_STORE_PASSWORD and MESIMA_KEY_ALIAS.')
    tool = Path(env['JAVA_HOME']) / 'bin' / ('keytool.exe' if sys.platform == 'win32' else 'keytool') if env.get('JAVA_HOME') else shutil.which('keytool')
    if not tool:
        raise RuntimeError('JDK keytool is missing; set JAVA_HOME')
    result = subprocess.run([str(tool), '-exportcert', '-keystore', env['MESIMA_KEYSTORE'],
                             '-alias', env['MESIMA_KEY_ALIAS'], '-storepass:env', 'MESIMA_STORE_PASSWORD'],
                            env=env, check=True, capture_output=True)
    return hashlib.sha256(result.stdout).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('apk', nargs='?', type=Path, default=ROOT / 'android/app/build/outputs/apk/release/app-release.apk')
    args = parser.parse_args()
    env = environment()
    with zipfile.ZipFile(args.apk) as apk:
        if apk.read('assets/index.html') != (ROOT / 'index.html').read_bytes():
            raise RuntimeError('APK contains stale HTML')
    subprocess.run([sys.executable, str(ROOT / 'tools/verify-apk-version.py'), str(args.apk)], env=env, check=True)
    expected = expected_certificate(env)
    check = subprocess.run([sdk_tool('apksigner', env), 'verify', '--verbose', '--print-certs', str(args.apk)],
                           env=env, check=True, capture_output=True, text=True)
    found = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)', check.stdout, re.I)
    if expected not in [value.lower() for value in found]:
        raise RuntimeError('APK is not signed with the expected release certificate')
    print('PASS release certificate, current HTML and packaged native version')
    print('Certificate SHA-256:', expected)
    badging = subprocess.run([sdk_tool('aapt', env), 'dump', 'badging', str(args.apk)],
                             env=env, check=True, capture_output=True, text=True, encoding='utf8')
    print(badging.stdout.splitlines()[0])


if __name__ == '__main__':
    main()
