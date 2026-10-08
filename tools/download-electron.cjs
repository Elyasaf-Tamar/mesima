const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const version = require('../desktop/package.json').devDependencies.electron;
const toolRoot = path.resolve(process.env.MESIMA_TOOLS_DIR || path.join(__dirname, '../../.mesima-build-tools'));
const name = `electron-v${version}-win32-x64.zip`;
const destination = path.join(toolRoot, 'electron-cache', name);
const base = `https://github.com/electron/electron/releases/download/v${version}/`;
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async () => {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const checksums = await fetch(base + 'SHASUMS256.txt', { signal: AbortSignal.timeout(30000) });
  if (!checksums.ok) throw Error('Could not download official Electron checksums: ' + checksums.status);
  const expected = (await checksums.text()).split('\n').map(line => line.trim().split(/\s+/)).find(parts => parts[1]?.replace(/^\*/, '') === name)?.[0];
  if (!/^[0-9a-f]{64}$/i.test(expected || '')) throw Error('Official Electron checksum is missing');
  if (fs.existsSync(destination) && sha256(destination) === expected) { console.log('Verified Electron runtime is already cached.'); return; }
  const partial = destination + '.partial';
  const start = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
  const response = await fetch(base + name, { headers: start ? { Range: 'bytes=' + start + '-' } : {}, signal: AbortSignal.timeout(600000) });
  if (!response.ok) throw Error('Download failed: ' + response.status);
  if (response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${start}-`)) throw Error('Unexpected download range');
  await pipeline(response.body, fs.createWriteStream(partial, { flags: response.status === 206 ? 'a' : 'w' }));
  if (sha256(partial) !== expected) { fs.rmSync(partial, { force: true }); throw Error('Electron checksum mismatch'); }
  fs.renameSync(partial, destination);
  console.log('Electron runtime downloaded; official SHA-256 verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
