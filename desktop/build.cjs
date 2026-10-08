const fs = require('node:fs');
const path = require('node:path');
const { validConfig } = require('./backup-utils.cjs');
const root = path.resolve(__dirname, '..');
const toolRoot = path.resolve(process.env.MESIMA_TOOLS_DIR || path.join(root, '../.mesima-build-tools'));

function prepare() {
  let config = null;
  const googleFile = process.env.MESIMA_GOOGLE_SERVICES || path.join(root, 'android/app/google-services.json');
  if (process.env.MESIMA_FIREBASE_CONFIG) {
    config = JSON.parse(fs.readFileSync(process.env.MESIMA_FIREBASE_CONFIG, 'utf8'));
  } else if (fs.existsSync(googleFile)) {
    const google = JSON.parse(fs.readFileSync(googleFile, 'utf8'));
    const client = google.client?.find(c => c.client_info?.android_client_info?.package_name === 'il.mesima.app') || google.client?.[0];
    config = { project: google.project_info?.project_id, bucket: google.project_info?.storage_bucket, apiKey: client?.api_key?.[0]?.current_key };
  } else if (process.env.MESIMA_GOOGLE_SERVICES) {
    throw Error('MESIMA_GOOGLE_SERVICES does not point to an existing file');
  }
  if (config !== null && !validConfig(config)) throw Error('Invalid Firebase configuration');
  // Replace generated configuration so a local build cannot inherit a stale project.
  fs.writeFileSync(path.join(__dirname, 'firebase-config.json'), JSON.stringify(config));
  fs.mkdirSync(path.join(__dirname, 'app'), { recursive: true });
  fs.copyFileSync(path.join(root, 'index.html'), path.join(__dirname, 'app/index.html'));
  console.log(config ? 'Desktop assets prepared with Firebase.' : 'Desktop assets prepared for local use (Firebase is not configured).');
}

async function build() {
  prepare();
  if (process.argv.includes('--prepare-only')) return;
  let packager;
  try { ({ packager } = require('@electron/packager')); }
  catch (error) { throw new Error('Install desktop build dependencies first: npm ci --prefix desktop', { cause: error }); }
  const metadata = require('./package.json');
  const cache = path.join(toolRoot, 'electron-cache');
  const cachedZip = path.join(cache, `electron-v${metadata.devDependencies.electron}-win32-x64.zip`);
  const paths = await packager({
    dir: __dirname, electronVersion: metadata.devDependencies.electron,
    ...(fs.existsSync(cachedZip) ? { electronZipDir: cache } : {}),
    name: 'Mesima', platform: 'win32', arch: 'x64', out: path.join(__dirname, 'dist'),
    overwrite: true, asar: true,
    ignore: [/^\/dist(?:\/|$)/, /^\/build\.cjs$/, /^\/node_modules(?:\/|$)/],
    appVersion: metadata.version,
    win32metadata: { CompanyName: 'Mesima', FileDescription: 'משימה', ProductName: 'Mesima' }
  });
  console.log(paths.join('\n'));
}

build().catch(error => { console.error(error.message); process.exitCode = 1; });
