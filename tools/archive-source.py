"""Create public source archives without local configuration, credentials or caches."""
from pathlib import Path
import json
import os
import zipfile

EXCLUDED_DIRS = {'.build-tools', '.mesima-build-tools', '.mesima-private', 'build',
                 '.gradle', '.kotlin', '.git', 'node_modules', 'test-results',
                 'dist', 'app-dist', '_site', '__pycache__'}
EXCLUDED_NAMES = {'local.properties', 'signing.properties', 'google-services.json',
                  'firebase-config.json', '.firebaserc', 'SHA256SUMS.txt',
                  'test-results-store.html', 'test-results-stores.html', 'account.bin'}
EXCLUDED_SUFFIXES = {'.jks', '.keystore', '.pem', '.p12', '.pfx', '.key', '.apk',
                     '.aab', '.zip', '.docx', '.log', '.tmp', '.pyc'}


def allowed(path, root):
    relative = path.relative_to(root)
    return (not path.is_symlink()
            and not any(part in EXCLUDED_DIRS for part in relative.parts)
            and path.suffix.lower() not in EXCLUDED_SUFFIXES
            and path.name not in EXCLUDED_NAMES
            and path.name != '.env'
            and (not path.name.startswith('.env.') or path.name == '.env.example'))


def archive(folder, destination, root):
    files = []
    for directory, dirs, names in os.walk(folder, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS
                         and not (Path(directory) / d).is_symlink())
        files.extend(Path(directory) / name for name in sorted(names)
                     if allowed(Path(directory) / name, root))
    temporary = destination.with_suffix(destination.suffix + '.tmp')
    try:
        with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as output:
            for path in files:
                output.write(path, path.relative_to(root))
        with zipfile.ZipFile(temporary) as output:
            assert output.testzip() is None, 'Source archive is corrupt'
            assert all(allowed(root / name, root) for name in output.namelist())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / 'package.json').read_text(encoding='utf8'))['version']
    for filename, folder in [('android-src.zip', root / 'android'),
                             (f'Mesima-{version}-source.zip', root)]:
        destination = root / filename
        archive(folder, destination, root)
        print(filename, destination.stat().st_size, 'bytes; local configuration, credentials and caches excluded')


if __name__ == '__main__':
    main()
