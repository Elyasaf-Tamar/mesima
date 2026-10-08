"""Finish the verified 4.9.2 release whose draft lookup interrupted publication.

This recovery does not build, upload, or retag anything. Its immutable inputs
identify the already successful verification, signed build and saved package.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

from android_tools import ROOT


REPOSITORY = 'Elyasaf-Tamar/mesima'
REPOSITORY_ID = 1339692633
COMMIT = 'a3148190df47ec1cac8b88e81268664012726001'
TAG = 'v4.9.2'
VERIFY_RUN = 37815634493
RELEASE_RUN = 37816065870
RELEASE_JOB = 113444948680
ARTIFACT = 11566908324
ARTIFACT_SHA256 = '197278b7d8a7e32ae96243b219cd42d1026c8a9dce29c5fffac7ff7c0d47910b'


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', f'repos/{REPOSITORY}/{path}'], text=True))


def verify_run(run, name):
    if (run['head_sha'] != COMMIT or run['head_branch'] != 'main'
            or run['repository']['id'] != REPOSITORY_ID
            or run['head_repository']['id'] != REPOSITORY_ID or run['name'] != name):
        raise RuntimeError('The recovery run does not match the verified original source')


def recover_package(archive, destination):
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARTIFACT_SHA256:
        raise RuntimeError('The downloaded artifact SHA-256 does not match the verified release package')
    with zipfile.ZipFile(archive) as source:
        metadata = json.loads(source.read('release.json'))
        if (metadata['repository'] != REPOSITORY or metadata['commit'] != COMMIT
                or metadata['tag'] != TAG):
            raise RuntimeError('Artifact release metadata does not match the verified original source')
        expected = {asset['name'] for asset in metadata['assets']} | {'release.json', 'release-notes.md'}
        if (len(expected) != len(metadata['assets']) + 2 or set(source.namelist()) != expected
                or len(source.namelist()) != len(expected)):
            raise RuntimeError('The release artifact contains unexpected or duplicate files')
        destination.mkdir(parents=True, exist_ok=True)
        for info in source.infolist():
            if (Path(info.filename).name != info.filename or info.is_dir()
                    or info.file_size > 32 * 1024 * 1024):
                raise RuntimeError('Unsafe or oversized release artifact entry')
            (destination / info.filename).write_bytes(source.read(info))
    for asset in metadata['assets']:
        path = destination / asset['name']
        if path.stat().st_size != asset['size'] or hashlib.sha256(path.read_bytes()).hexdigest() != asset['sha256']:
            raise RuntimeError('An extracted release asset does not match its verified manifest')


def main():
    verification = api(f'actions/runs/{VERIFY_RUN}')
    verify_run(verification, 'Verify web and Android')
    if verification['status'] != 'completed' or verification['conclusion'] != 'success':
        raise RuntimeError('The original source verification did not succeed')
    signed_run = api(f'actions/runs/{RELEASE_RUN}')
    verify_run(signed_run, 'Publish signed Android release')
    job = api(f'actions/jobs/{RELEASE_JOB}')
    if job['run_id'] != RELEASE_RUN or job['head_sha'] != COMMIT:
        raise RuntimeError('The signed build job does not belong to the pinned release run')
    steps = {step['name']: step['conclusion'] for step in job['steps']}
    for name in ['Build and verify the compatible signed APK', 'Package public release assets',
                 'Save the verified release package']:
        if steps.get(name) != 'success':
            raise RuntimeError('The original signed release package was not successfully verified and saved')
    artifact = api(f'actions/artifacts/{ARTIFACT}')
    if (artifact['expired'] or artifact['name'] != 'mesima-signed-release'
            or artifact['digest'] != 'sha256:' + ARTIFACT_SHA256
            or artifact['workflow_run']['id'] != RELEASE_RUN
            or artifact['workflow_run']['head_sha'] != COMMIT):
        raise RuntimeError('The recovery artifact does not belong to the verified signed build')
    with tempfile.TemporaryDirectory(prefix='mesima-release-resume-') as directory:
        archive = Path(directory) / 'release.zip'
        with archive.open('wb') as output:
            subprocess.run(['gh', 'api', f'repos/{REPOSITORY}/actions/artifacts/{ARTIFACT}/zip'],
                           stdout=output, check=True)
        recover_package(archive, ROOT / 'dist/android-release')
    print('PASS original successful gate, original signed build, artifact SHA-256 and all release assets')
    env = dict(os.environ, MESIMA_RELEASE_COMMIT=COMMIT)
    subprocess.run([sys.executable, str(ROOT / 'tools/publish-android-release.py'), 'finish'], env=env, check=True)


if __name__ == '__main__':
    main()
