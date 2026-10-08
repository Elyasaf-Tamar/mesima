"""Package a verified Android build, then publish its exact artifacts to GitHub."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from android_tools import ROOT


DESTINATION = ROOT / 'dist/android-release'
REPOSITORY = 'Elyasaf-Tamar/mesima'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def package():
    version = json.loads((ROOT / 'package.json').read_text())['version']
    gradle = (ROOT / 'android/app/build.gradle').read_text()
    native = re.search(r'versionName\s+"([0-9.]+)"', gradle).group(1)
    code = int(re.search(r'versionCode\s+(\d+)', gradle).group(1))
    if not re.fullmatch(r'\d+\.\d+(?:\.\d+)?', version):
        raise RuntimeError('Release version must be a numeric Mesima version')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    expected_commit = os.environ.get('MESIMA_RELEASE_COMMIT')
    if expected_commit and commit != expected_commit:
        raise RuntimeError('Checked-out source is not the workflow commit')
    DESTINATION.mkdir(parents=True, exist_ok=True)
    sources = {
        f'Mesima-{version}-Android-{native}-Firebase.apk': ROOT / 'android/app/build/outputs/apk/release/app-release.apk',
        'index.html': ROOT / 'index.html',
        'android-src.zip': ROOT / 'android-src.zip',
        f'Mesima-{version}-source.zip': ROOT / f'Mesima-{version}-source.zip',
    }
    assets = []
    for name, source in sources.items():
        target = DESTINATION / name
        shutil.copyfile(source, target)
        assets.append({'name': name, 'size': target.stat().st_size, 'sha256': sha256(target)})
    checksums = DESTINATION / 'SHA256SUMS.txt'
    checksums.write_text(''.join(f"{asset['sha256']}  {asset['name']}\n" for asset in assets))
    assets.append({'name': checksums.name, 'size': checksums.stat().st_size, 'sha256': sha256(checksums)})
    notes_file = ROOT / f'RELEASE-NOTES-{version}-HE.md'
    if not notes_file.exists():
        notes_file = ROOT / f'CHANGELOG-{version}-HE.md'
    notes = notes_file.read_text(encoding='utf-8')
    notes += (f'\n\nחבילה: **{version} · Android {native}**, קוד גרסה {code}. '
              f'מקור החבילה: [{commit[:12]}](https://github.com/{REPOSITORY}/commit/{commit}).\n')
    (DESTINATION / 'release-notes.md').write_text(notes, encoding='utf-8')
    metadata = {'repository': REPOSITORY, 'tag': 'v' + version, 'commit': commit,
                'title': f'Mesima {version} · Android {native}', 'assets': assets}
    (DESTINATION / 'release.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(f'Packaged {len(assets)} release assets for {metadata["tag"]} at {commit[:12]}')


def gh(*arguments, json_result=False):
    result = subprocess.run(['gh', *arguments], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'GitHub CLI failed')
    return json.loads(result.stdout) if json_result else result.stdout.strip()


def find_release(tag):
    result = subprocess.run(['gh', 'api', f'repos/{REPOSITORY}/releases/tags/{tag}'],
                            cwd=ROOT, capture_output=True, text=True)
    if result.returncode and '404' in result.stderr:
        # GitHub's tag endpoint omits drafts, including immediately after a
        # successful `gh release create --draft` and asset upload.
        page = 1
        while True:
            releases = gh('api', f'repos/{REPOSITORY}/releases?per_page=100&page={page}', json_result=True)
            matches = [release for release in releases if release['tag_name'] == tag]
            if len(matches) > 1:
                raise RuntimeError('Multiple releases have the requested tag')
            if matches:
                return gh('api', f'repos/{REPOSITORY}/releases/{matches[0]["id"]}', json_result=True)
            if len(releases) < 100:
                return None
            page += 1
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Could not inspect the release')
    return json.loads(result.stdout)


def check():
    version = json.loads((ROOT / 'package.json').read_text())['version']
    if not re.fullmatch(r'\d+\.\d+(?:\.\d+)?', version):
        raise RuntimeError('Release version must be a numeric Mesima version')
    release = find_release('v' + version)
    needed = not release or release['draft']
    if release and release['draft'] and release['target_commitish'] != os.environ.get('MESIMA_RELEASE_COMMIT'):
        raise RuntimeError('An unfinished release belongs to another commit; inspect it before continuing')
    if needed:
        print('Signed Android release is needed for v' + version)
    else:
        print('This version is already published: ' + release['html_url'])
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('needed=' + str(needed).lower() + '\n')


def verify_assets(release, metadata):
    if not release:
        raise RuntimeError('The release could not be found after creation or upload')
    remote = {asset['name']: asset for asset in release['assets']}
    for expected in metadata['assets']:
        asset = remote.get(expected['name'])
        if not asset or asset['state'] != 'uploaded' or asset['size'] != expected['size']:
            raise RuntimeError('Missing or incomplete GitHub release asset: ' + expected['name'])
        actual_digest = asset.get('digest')
        if actual_digest:
            if actual_digest != 'sha256:' + expected['sha256']:
                raise RuntimeError('GitHub release asset SHA-256 mismatch: ' + expected['name'])
        else:
            with tempfile.TemporaryDirectory(prefix='mesima-asset-check-') as directory:
                gh('release', 'download', metadata['tag'], '--repo', REPOSITORY,
                   '--dir', directory, '--pattern', expected['name'])
                if sha256(Path(directory) / expected['name']) != expected['sha256']:
                    raise RuntimeError('Downloaded release asset SHA-256 mismatch: ' + expected['name'])


def verify_tag(metadata, create=False):
    # target_commitish does not prove where a pre-existing tag actually points.
    # The commits endpoint dereferences both lightweight and annotated tags.
    reference = subprocess.run(['gh', 'api', f'repos/{REPOSITORY}/git/ref/tags/{metadata["tag"]}'],
                            cwd=ROOT, capture_output=True, text=True)
    if reference.returncode and '404' in reference.stderr and create:
        gh('api', '--method', 'POST', f'repos/{REPOSITORY}/git/refs',
           '--raw-field', 'ref=refs/tags/' + metadata['tag'],
           '--raw-field', 'sha=' + metadata['commit'])
        return verify_tag(metadata)
    if reference.returncode:
        raise RuntimeError(reference.stderr.strip() or 'Could not inspect the release tag')
    result = subprocess.run(['gh', 'api', f'repos/{REPOSITORY}/commits/{metadata["tag"]}'],
                            cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Could not resolve the release tag')
    if json.loads(result.stdout)['sha'] != metadata['commit']:
        raise RuntimeError('The release tag points to another commit; it will not be moved or overwritten')


def publish(resume_only=False):
    metadata = json.loads((DESTINATION / 'release.json').read_text())
    if metadata['repository'] != REPOSITORY:
        raise RuntimeError('Unexpected release repository')
    if metadata['commit'] != os.environ.get('MESIMA_RELEASE_COMMIT'):
        raise RuntimeError('Only the exact verified workflow commit may be published')
    for asset in metadata['assets']:
        path = DESTINATION / asset['name']
        if path.parent != DESTINATION or not path.is_file() or sha256(path) != asset['sha256']:
            raise RuntimeError('Packaged artifact changed before publication')
    release = find_release(metadata['tag'])
    if release:
        if release['target_commitish'] != metadata['commit']:
            raise RuntimeError('This release tag already belongs to another commit; increment the app version')
        if not release['draft']:
            verify_tag(metadata)
            verify_assets(release, metadata)
            print('The same verified release is already published: ' + release['html_url'])
            return
    else:
        if resume_only:
            raise RuntimeError('Resume requires an existing release; no replacement will be created')
        verify_tag(metadata, create=True)
        gh('release', 'create', metadata['tag'], '--repo', REPOSITORY, '--target', metadata['commit'],
           '--title', metadata['title'], '--notes-file', str(DESTINATION / 'release-notes.md'),
           '--verify-tag', '--draft')
    verify_tag(metadata)
    if not resume_only:
        gh('release', 'upload', metadata['tag'], '--repo', REPOSITORY, '--clobber',
           *[str(DESTINATION / asset['name']) for asset in metadata['assets']])
    release = find_release(metadata['tag'])
    verify_assets(release, metadata)
    verify_tag(metadata)
    gh('release', 'edit', metadata['tag'], '--repo', REPOSITORY,
       '--notes-file', str(DESTINATION / 'release-notes.md'), '--draft=false', '--latest')
    release = find_release(metadata['tag'])
    if release['draft']:
        raise RuntimeError('Release remains a draft')
    verify_tag(metadata)
    verify_assets(release, metadata)
    print('Published and verified: ' + release['html_url'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'package', 'publish', 'finish'])
    args = parser.parse_args()
    {'check': check, 'package': package, 'publish': publish,
     'finish': lambda: publish(resume_only=True)}[args.action]()
