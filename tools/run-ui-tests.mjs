import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, MESIMA_PLAYWRIGHT: process.env.MESIMA_PLAYWRIGHT || path.join(root, 'node_modules/playwright/index.mjs') };
if (!fs.existsSync(env.MESIMA_PLAYWRIGHT)) throw Error('Run npm ci and npx playwright install chromium first.');
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
// These suites use isolated browser profiles and mock all account/transport data.
// Live-account diagnostics and historical UI 4.6 selectors are intentionally separate.
const suites = [
  'ui-test.mjs', 'bridge-ui-test.mjs', 'ui-47-test.mjs', 'mobile-47-test.mjs',
  'ui-48-test.mjs', 'ui-49-test.mjs', 'ui-491-test.mjs',
  'sync-transport-test.mjs', 'sync-native-transport-test.mjs', 'ui-review-test.mjs'
];
const failed = [];
for (const name of suites) {
  console.log(`\nUI regression: ${name}`);
  const result = spawnSync(process.execPath, [path.join(root, 'tools', name)], {
    cwd: root, env, stdio: 'inherit', timeout: 180000
  });
  if (result.error || result.status !== 0) {
    failed.push(name);
    if (result.error) console.error(result.error.message);
  }
}
if (failed.length) { console.error('Failed UI suites: ' + failed.join(', ')); process.exitCode = 1; }
else console.log(`\nAll ${suites.length} UI and transport suites passed.`);
