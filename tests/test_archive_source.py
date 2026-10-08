import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('archive_source', Path(__file__).resolve().parents[1] / 'tools/archive-source.py')
ARCHIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ARCHIVE)


class PublicArchiveTest(unittest.TestCase):
    def test_public_archive_excludes_signing_configuration_and_linked_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'repo'
            root.mkdir()
            public = ['README.md', 'src/app.js', 'android/app/src/Main.kt', '.env.example']
            private = ['android/signing.properties', 'android/app/google-services.json',
                       'android/local.properties', 'desktop/firebase-config.json',
                       '.env', '.env.production', 'keys/release.jks', 'keys/cert.pem',
                       '.mesima-private/secret.txt', '.mesima-build-tools/cache.txt',
                       'node_modules/dependency.js', 'android/app/build/cache.bin']
            for name in public + private:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic fixture', encoding='utf8')
            outside = Path(temporary) / 'private.txt'
            outside.write_text('synthetic private value')
            try:
                (root / 'linked.txt').symlink_to(outside)
            except OSError:
                pass
            destination = root / 'source.zip'
            ARCHIVE.archive(root, destination, root)
            with zipfile.ZipFile(destination) as output:
                self.assertEqual(set(output.namelist()), set(public))
                self.assertIsNone(output.testzip())
            self.assertFalse(destination.with_suffix('.zip.tmp').exists())


if __name__ == '__main__':
    unittest.main()
