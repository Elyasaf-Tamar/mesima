import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const nativeVersion = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8').match(/versionName\s+["']([^"']+)["']/)[1];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const args = new Set(process.argv.slice(2));
for (const arg of args) if (!['--source-only', '--verify-originals'].includes(arg)) throw Error('Unknown option: ' + arg);

// Historical release inputs are optional for a fresh checkout. Verification is
// explicit so missing private archives cannot masquerade as a successful check.
if (args.has('--verify-originals')) {
  const originals = JSON.parse(fs.readFileSync(path.join(root, 'original-sha256.json')));
  const privateRoot = process.env.MESIMA_PRIVATE_DIR || path.join(root, '../.mesima-private');
  for (const [name, hash] of Object.entries(originals)) {
    const file = path.join(privateRoot, 'original-4.4', name);
    if (!fs.existsSync(file)) throw Error('Missing original reference: ' + name);
    if (sha(fs.readFileSync(file)) !== hash) throw Error('Original changed: ' + name);
  }
  console.log('Original 4.4 references verified.');
}

const apkName = `Mesima-${version}-Android-${nativeVersion}-Firebase.apk`;
const releaseApk = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const included = ['index.html', 'android-src.zip', `Mesima-${version}-source.zip`];
if (!args.has('--source-only')) {
  if (!fs.existsSync(releaseApk)) throw Error('Missing signed release APK. Build and verify the release first, or explicitly use --source-only.');
  included.push(`Mesima-${version}-Windows.zip`);
}
const missing = included.filter(name => !fs.existsSync(path.join(root, name)));
if (missing.length) throw Error('Missing release artifacts: ' + missing.join(', '));
if (!args.has('--source-only')) {
  const python = process.env.MESIMA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const verification = spawnSync(python, [path.join(root, 'tools/verify-release.py'), releaseApk], { cwd: root, env: process.env, stdio: 'inherit' });
  if (verification.error || verification.status !== 0) throw Error('Release verification failed; no release manifest was written.');
  fs.copyFileSync(releaseApk, path.join(root, apkName));
  included.push(apkName);
}
const temporary = path.join(root, 'SHA256SUMS.txt.tmp');
fs.writeFileSync(temporary, included.map(name => `${sha(fs.readFileSync(path.join(root, name)))}  ${name}`).join('\n') + '\n');
fs.renameSync(temporary, path.join(root, 'SHA256SUMS.txt'));
console.log(`${args.has('--source-only') ? 'Source-only' : 'Complete'} artifact manifest written (${included.length} files).`);
