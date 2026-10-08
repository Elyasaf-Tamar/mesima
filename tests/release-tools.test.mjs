import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesima-release-'));
  fs.mkdirSync(path.join(root, 'tools'));
  fs.mkdirSync(path.join(root, 'android/app'), { recursive: true });
  fs.copyFileSync(new URL('../tools/package.mjs', import.meta.url), path.join(root, 'tools/package.mjs'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"4.9.2"}');
  fs.writeFileSync(path.join(root, 'android/app/build.gradle'), 'versionName "1.8.2"');
  fs.writeFileSync(path.join(root, 'index.html'), 'synthetic application');
  return root;
}

test('release packaging fails clearly when required artifacts are missing', () => {
  const root = fixture();
  try {
    const result = spawnSync(process.execPath, ['tools/package.mjs'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing signed release APK/);
    assert.equal(fs.existsSync(path.join(root, 'SHA256SUMS.txt')), false);
    const sources = spawnSync(process.execPath, ['tools/package.mjs', '--source-only'], { cwd: root, encoding: 'utf8' });
    assert.notEqual(sources.status, 0);
    assert.match(sources.stderr, /Missing release artifacts/);
    assert.equal(fs.existsSync(path.join(root, 'SHA256SUMS.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('source-only packaging is explicit and independent of private original archives', () => {
  const root = fixture();
  try {
    for (const name of ['android-src.zip', 'Mesima-4.9.2-source.zip']) fs.writeFileSync(path.join(root, name), 'synthetic archive');
    const result = spawnSync(process.execPath, ['tools/package.mjs', '--source-only'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Source-only/);
    const manifest = fs.readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    assert.equal(manifest.length, 3);
    assert.ok(manifest.every(line => /^[0-9a-f]{64}  /.test(line)));
    assert.ok(manifest.every(line => !line.includes('.apk') && !line.includes('Windows')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
