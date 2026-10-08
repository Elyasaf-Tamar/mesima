"""Rebuild the personal Android release with its existing signing identity.

The fixed legacy inputs were published by the owner before signing material was
removed from the current source tree. They are recovered only in a temporary
directory. Neither those inputs nor Firebase client configuration are artifacts.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

from android_tools import ROOT, environment, sdk_tool


ORIGINAL_COMMIT = '3fdcec718f65582bb8b2e5af737e7df71bc0a47a'
ORIGINAL_ARCHIVE_SHA256 = '87562bf0121528c1cf00f2dd8d89f88849c66cc16db6bd4c1443282e36b5c771'
KEY_SHA256 = 'b5079c44d71b1c63b560f25ec6f475ba37646045ef69aeb61fbbc29a875b35e1'
CERT_SHA256 = '5e94ddd181cb9f72fd89f6911db2059c986a85db9abd14d1da19b6efee727d42'
REFERENCE_URL = ('https://github.com/Elyasaf-Tamar/mesima/releases/download/'
                 'v4.9/Mesima-4.9-Android-1.8-Firebase.apk')
REFERENCE_SHA256 = 'dea34bcf9b110db05eb9df9bae0198b89e3894b3e3ff8533488daabad35f6ac3'
PACKAGE = 'il.mesima.app'
RESOURCE_NAMES = {'google_app_id', 'google_api_key', 'google_crash_reporting_api_key',
                  'gcm_defaultSenderId', 'project_id', 'google_storage_bucket'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_write(path, data):
    path.write_bytes(data)
    path.chmod(0o600)


def original_signing_env(directory, env):
    archive = subprocess.check_output(['git', 'show', ORIGINAL_COMMIT + ':android-src.zip'], cwd=ROOT)
    if digest(archive) != ORIGINAL_ARCHIVE_SHA256:
        raise RuntimeError('The historical signing archive does not match its pinned SHA-256')
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        key = source.read('android/app/mesima.jks')
        gradle = source.read('android/app/build.gradle').decode('utf-8')
    if digest(key) != KEY_SHA256:
        raise RuntimeError('The original signing key does not match its pinned SHA-256')
    key_path = directory / 'mesima.jks'
    private_write(key_path, key)
    env = dict(env, MESIMA_KEYSTORE=str(key_path), MESIMA_SIGNING_CERT_SHA256=CERT_SHA256)
    for name, variable in [('storePassword', 'MESIMA_STORE_PASSWORD'),
                           ('keyAlias', 'MESIMA_KEY_ALIAS'), ('keyPassword', 'MESIMA_KEY_PASSWORD')]:
        default = re.search(r'\b' + name + r'''\s+project\.findProperty\([^)]*\)\s*\?:\s*(['"])(.*?)\1''', gradle)
        literal = re.search(r'\b' + name + r'''\s+(['"])(.*?)\1''', gradle)
        match = default or literal
        if not match:
            raise RuntimeError('The original signing settings could not be recovered: ' + name)
        env[variable] = match.group(2)
    keytool = str(Path(env['JAVA_HOME']) / 'bin/keytool') if env.get('JAVA_HOME') else 'keytool'
    certificate = subprocess.run([keytool, '-exportcert', '-keystore', str(key_path),
                                  '-alias', env['MESIMA_KEY_ALIAS'], '-storepass:env', 'MESIMA_STORE_PASSWORD'],
                                 env=env, capture_output=True, check=True).stdout
    if digest(certificate) != CERT_SHA256:
        raise RuntimeError('The recovered signing certificate does not match the installed-app lineage')
    return env


def verify_reference(apk, env):
    if digest(apk.read_bytes()) != REFERENCE_SHA256:
        raise RuntimeError('The reference APK does not match its pinned SHA-256')
    verify_certificate(apk, env)


def verify_certificate(apk, env):
    result = subprocess.run([sdk_tool('apksigner', env), 'verify', '--print-certs', str(apk)],
                            env=env, capture_output=True, check=True, text=True)
    found = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)', result.stdout, re.I)
    if [value.lower() for value in found] != [CERT_SHA256]:
        raise RuntimeError('APK certificate does not match the original Mesima certificate')
    badging = subprocess.check_output([sdk_tool('aapt', env), 'dump', 'badging', str(apk)], env=env, text=True)
    if not re.search(r"^package: name='" + re.escape(PACKAGE) + r"'", badging):
        raise RuntimeError('APK application ID is not the existing Mesima application ID')


def firebase_resources(apk, env):
    dump = subprocess.check_output([sdk_tool('aapt', env), 'dump', '--values', 'resources', str(apk)],
                                   env=env, text=True, encoding='utf-8')
    pattern = (r'^\s+resource \S+ ' + re.escape(PACKAGE)
               + r':string/([^:]+):[^\n]*\n\s+\(string8?\)\s+("(?:[^"\\]|\\.)*")')
    result = {}
    for name, quoted in re.findall(pattern, dump, re.M):
        if name in RESOURCE_NAMES:
            value = json.loads(quoted)
            if name in result and result[name] != value:
                raise RuntimeError('Localized Firebase configuration is not supported')
            result[name] = value
    if set(result) != RESOURCE_NAMES or not all(result.values()):
        raise RuntimeError('The APK is missing the expected Firebase client resources')
    if result['google_crash_reporting_api_key'] != result['google_api_key']:
        raise RuntimeError('The reference APK has different client API keys')
    if not result['google_app_id'].startswith('1:' + result['gcm_defaultSenderId'] + ':android:'):
        raise RuntimeError('Firebase application ID and sender ID are inconsistent')
    return result


def firebase_configuration(resources):
    return {
        'project_info': {'project_number': resources['gcm_defaultSenderId'],
                         'project_id': resources['project_id'],
                         'storage_bucket': resources['google_storage_bucket']},
        'client': [{'client_info': {'mobilesdk_app_id': resources['google_app_id'],
                                    'android_client_info': {'package_name': PACKAGE}},
                    'oauth_client': [], 'api_key': [{'current_key': resources['google_api_key']}],
                    'services': {}}],
        'configuration_version': '1',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-apk', type=Path, help='Use the identical local reference APK instead of downloading it')
    parser.add_argument('--offline', action='store_true', help='Use cached Gradle dependencies')
    parser.add_argument('--verify-only', type=Path, metavar='APK', help='Verify an already built release without rebuilding')
    args = parser.parse_args()
    env = environment()
    with tempfile.TemporaryDirectory(prefix='mesima-release-', dir=os.environ.get('RUNNER_TEMP')) as temporary:
        directory = Path(temporary)
        env = original_signing_env(directory, env)
        reference = args.reference_apk
        if reference is None:
            reference = directory / 'reference.apk'
            with urllib.request.urlopen(REFERENCE_URL, timeout=60) as response:
                data = response.read(32 * 1024 * 1024 + 1)
            if len(data) > 32 * 1024 * 1024:
                raise RuntimeError('Reference APK exceeds the expected download size')
            private_write(reference, data)
        verify_reference(reference, env)
        expected_resources = firebase_resources(reference, env)
        apk = args.verify_only or ROOT / 'android/app/build/outputs/apk/release/app-release.apk'
        if not args.verify_only:
            config = ROOT / 'android/app/google-services.json'
            original = config.read_bytes() if config.exists() else None
            try:
                private_write(config, (json.dumps(firebase_configuration(expected_resources), indent=2) + '\n').encode())
                command = [sys.executable, str(ROOT / 'tools/sign-release.py')]
                if args.offline:
                    command.append('--offline')
                subprocess.run(command, env=env, check=True)
            finally:
                if original is None:
                    config.unlink(missing_ok=True)
                else:
                    private_write(config, original)
        subprocess.run([sys.executable, str(ROOT / 'tools/verify-release.py'), str(apk)], env=env, check=True)
        verify_certificate(apk, env)
        if firebase_resources(apk, env) != expected_resources:
            raise RuntimeError('The release APK does not preserve the original Firebase client configuration')
        print('PASS original signing identity, application ID and all six original Firebase resources')


if __name__ == '__main__':
    main()
