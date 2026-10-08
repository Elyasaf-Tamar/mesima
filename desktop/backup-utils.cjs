const fs = require('node:fs');

const MAX_BYTES = 20 * 1024 * 1024;

function validateSnapshot(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    throw Error('הגיבוי גדול מ־20MB');
  }
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) {
    throw Error('קובץ גיבוי לא תקין');
  }
  return data;
}

async function readBoundedText(response, limit = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw Error('הקובץ גדול מדי');
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error('הקובץ גדול מדי');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function validConfig(config) {
  return !!config && /^[a-z0-9-]{1,100}$/.test(config.project || '') &&
    /^[a-z0-9._-]{1,253}$/.test(config.bucket || '') &&
    typeof config.apiKey === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(config.apiKey);
}

function loadConfig(filename) {
  try {
    const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return validConfig(config) ? config : null;
  } catch {
    return null;
  }
}

// A timed-out metadata request may still commit after a lookup reports absence.
// Only a definite client-error rejection permits cleanup of an absent entry.
// Network failures, timeouts and server failures preserve the immutable object.
async function commitBackup({ upload, commit, isCommitted, remove }) {
  await upload();
  try {
    await commit();
  } catch (error) {
    let committed;
    try { committed = await isCommitted(); }
    catch { throw new Error(error.message + ' — לא ניתן לאמת את הרישום; קובץ הגיבוי נשמר לבדיקה', { cause: error }); }
    if (committed) return;
    const rejected = [400, 401, 403, 404, 405, 412, 413, 415, 422, 429].includes(error.status);
    if (!rejected) {
      throw new Error(error.message + ' — תוצאת הרישום עדיין אינה ודאית; קובץ הגיבוי נשמר לבדיקה', { cause: error });
    }
    try { await remove(); }
    catch { throw new Error(error.message + ' — ניקוי קובץ הגיבוי שלא נרשם נכשל', { cause: error }); }
    throw error;
  }
}

module.exports = { MAX_BYTES, validateSnapshot, readBoundedText, validConfig, loadConfig, commitBackup };
