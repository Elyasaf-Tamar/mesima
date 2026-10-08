import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { MAX_BYTES, validateSnapshot, readBoundedText, loadConfig, commitBackup } from '../desktop/backup-utils.cjs';
import { blocked, reconcileAlarms } from '../desktop/reminder-state.cjs';

test('rescheduling an already-fired reminder arms the new time or cycle', () => {
  const previous = [{ id: 'co_task_list', at: 1000, occurrence: '2026-10-08', fired: true }];
  assert.equal(reconcileAlarms([{ ...previous[0] }], previous)[0].fired, true);
  assert.equal(reconcileAlarms([{ ...previous[0], at: 2000 }], previous)[0].fired, false);
  assert.equal(reconcileAlarms([{ ...previous[0], occurrence: '2026-10-09' }], previous)[0].fired, false);
});

test('desktop suppresses a completed checklist followup after the next cycle opens', () => {
  const state = { tasks: [{ id: 'task', checklists: [{ id: 'list', cycle: '2026-10-09', complete: false, completedCycles: ['2026-10-08'] }] }] };
  const reminder = { taskId: 'task', checklistId: 'list', occurrence: '2026-10-08' };
  assert.equal(blocked(state, reminder), true);
  assert.equal(blocked(state, { ...reminder, occurrence: '2026-10-09' }), false);
  state.tasks[0].checklists[0].completedCycles = [];
  assert.equal(blocked(state, reminder), false);
});

test('local desktop mode does not require Firebase configuration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesima-config-'));
  const file = path.join(dir, 'firebase-config.json');
  try {
    assert.equal(loadConfig(file), null);
    for (const invalid of ['null', '{}', 'broken JSON', '{"project":"../other"}']) {
      fs.writeFileSync(file, invalid);
      assert.equal(loadConfig(file), null);
    }
    const config = { project: 'test-project', bucket: 'test-project.appspot.com', apiKey: 'synthetic-key' };
    fs.writeFileSync(file, JSON.stringify(config));
    assert.deepEqual(loadConfig(file), config);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('snapshot size is bounded in UTF-8 bytes, including Hebrew text', () => {
  const prefix = '{"tasks":[],"note":"', suffix = '"}';
  const room = MAX_BYTES - Buffer.byteLength(prefix + suffix);
  const text = prefix + 'א'.repeat(Math.floor(room / 2)) + (room % 2 ? 'a' : '') + suffix;
  assert.equal(Buffer.byteLength(text), MAX_BYTES);
  assert.deepEqual(validateSnapshot(text).tasks, []);
  assert.throws(() => validateSnapshot(text.replace('"note":"', '"note":"א')), /20MB/);
  for (const invalid of ['null', '[]', '{}']) assert.throws(() => validateSnapshot(invalid));
});

test('remote files stop at the byte limit even without Content-Length', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(6)); },
    cancel() { cancelled = true; }
  }));
  await assert.rejects(readBoundedText(response, 10), /גדול מדי/);
  assert.equal(cancelled, true);
  await assert.rejects(readBoundedText(new Response('test', { headers: { 'content-length': '99' } }), 10), /גדול מדי/);
  const bytes = new TextEncoder().encode('בדיקה');
  const split = new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 3)); c.enqueue(bytes.slice(3)); c.close(); } }));
  assert.equal(await readBoundedText(split, bytes.length), 'בדיקה');
});

test('failed backup metadata removes only its uncommitted object', async () => {
  const calls = [];
  await assert.rejects(commitBackup({
    upload: async () => calls.push('upload'),
    commit: async () => { calls.push('metadata'); throw Object.assign(Error('permission denied'), { status: 403 }); },
    isCommitted: async () => { calls.push('check'); return false; },
    remove: async () => calls.push('remove')
  }), /permission denied/);
  assert.deepEqual(calls, ['upload', 'metadata', 'check', 'remove']);
});

test('lost commit response preserves an acknowledged cloud backup', async () => {
  await commitBackup({
    upload: async () => {},
    commit: async () => { throw Error('timeout'); },
    isCommitted: async () => true,
    remove: async () => assert.fail('Committed backup must survive')
  });
});

test('uncertain commit preserves data and reports uncertainty instead of deleting it', async () => {
  await assert.rejects(commitBackup({
    upload: async () => {},
    commit: async () => { throw Error('timeout'); },
    isCommitted: async () => { throw Error('offline'); },
    remove: async () => assert.fail('Potentially committed backup must survive')
  }), /לא ניתן לאמת/);
});

test('failed upload never creates metadata or deletes an existing object', async () => {
  await assert.rejects(commitBackup({
    upload: async () => { throw Error('upload denied'); },
    commit: async () => assert.fail('No metadata without object'),
    isCommitted: async () => assert.fail('No commit attempted'),
    remove: async () => assert.fail('No uploaded object')
  }), /upload denied/);
});


test('a timed-out commit can finish after a missing-entry lookup without losing its object', async () => {
  for (const status of [undefined, 408, 409, 500, 502, 503, 504]) {
    let objectExists = false, metadataExists = false;
    await assert.rejects(commitBackup({
      upload: async () => { objectExists = true; },
      commit: async () => { throw Object.assign(Error('commit response unavailable'), { status }); },
      isCommitted: async () => metadataExists,
      remove: async () => { objectExists = false; }
    }), /תוצאת הרישום עדיין אינה ודאית/);
    // The original POST was not cancelled at the server; it can finish later.
    metadataExists = true;
    assert.equal(metadataExists && objectExists, true, `status ${status} must preserve a late commit`);
  }
});

test('desktop preload acknowledges snooze success and makes rejected IPC explicit', async () => {
  let bridge, response = true;
  const calls = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
    ipcRenderer: {
      sendSync: () => ({ cloud: { configured: false } }),
      invoke: async (channel, value) => {
        calls.push({ channel, value });
        if (response instanceof Error) throw response;
        return response;
      },
      on: () => {}
    }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return electron; }
  });
  const reminder = { id: 'co_task_list', occurrence: 'once:2' };
  assert.equal(await bridge.snooze(reminder), true);
  response = false;
  assert.equal(await bridge.snooze(reminder), false);
  response = Error('disk full');
  assert.equal(await bridge.snooze(reminder), false);
  assert.equal(await bridge.snapshot('{"tasks":[]}'), false);
  assert.deepEqual(calls.slice(0, 3), Array.from({ length: 3 }, () => ({ channel: 'snooze', value: reminder })));
});
