import { before, beforeEach, after, test } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';

setLogLevel('silent');

const projectId = 'demo-mesima';
const id = '00000000-0000-4000-8000-000000000001';
const backupPath = `users/alice/backups/${id}`;
const objectPath = `${backupPath}.json`;
const limit = 20 * 1024 * 1024;
const metadata = overrides => ({
  createdAt: Date.now(), path: objectPath, bytes: 12, sha256: 'a'.repeat(64),
  taskCount: 0, appVersion: '4.9.2', schema: 13, ...overrides
});
let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: fs.readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') }
  });
});
beforeEach(async () => { await environment.clearFirestore(); await environment.clearStorage(); });
after(async () => { await environment?.cleanup(); });

test('current and historical clients can create immutable backup metadata', async () => {
  const db = environment.authenticatedContext('alice').firestore();
  for (const version of ['4.5', '4.6', '4.9.1', '4.9.2', '10.12.345']) {
    await assertSucceeds(db.doc(backupPath).set(metadata({ appVersion: version })));
    await assertFails(db.doc(backupPath).update({ taskCount: 1 }));
    await assertSucceeds(db.doc(backupPath).get());
    await assertSucceeds(db.doc(backupPath).delete());
  }
});

test('backup metadata remains private to its owner', async () => {
  const alice = environment.authenticatedContext('alice').firestore();
  const bob = environment.authenticatedContext('bob').firestore();
  const guest = environment.unauthenticatedContext().firestore();
  await assertFails(bob.doc(backupPath).set(metadata()));
  await assertFails(guest.doc(backupPath).set(metadata()));
  await assertSucceeds(alice.doc(backupPath).set(metadata()));
  for (const db of [bob, guest]) {
    await assertFails(db.doc(backupPath).get());
    await assertFails(db.doc(backupPath).delete());
  }
});

test('version repair preserves metadata type, path, size and field restrictions', async () => {
  const db = environment.authenticatedContext('alice').firestore();
  for (const invalid of [
    { appVersion: 492 }, { appVersion: '' }, { appVersion: '4.9.2-preview' },
    { appVersion: '1'.repeat(33) }, { bytes: limit + 1 }, { bytes: 0 },
    { bytes: '12' }, { taskCount: -1 }, { createdAt: 0 }, { sha256: 'bad' },
    { path: `users/bob/backups/${id}.json` }, { unexpected: true }
  ]) await assertFails(db.doc(backupPath).set(metadata(invalid)));
  await assertSucceeds(db.doc(backupPath).set(metadata({ bytes: limit })));
});

test('sync pointer keeps schema1 and can only point to the same owner sync namespace', async () => {
  const db = environment.authenticatedContext('alice').firestore();
  const ref = db.doc('users/alice/sync/state');
  await assertSucceeds(ref.set({ path: `users/alice/sync/${id}.json`, schema: 1 }));
  for (const value of [
    { path: objectPath, schema: 1 },
    { path: `users/bob/sync/${id}.json`, schema: 1 },
    { path: `users/alice/sync/${id}.json`, schema: 2 }
  ]) await assertFails(ref.set(value));
  await assertFails(environment.authenticatedContext('bob').firestore().doc('users/alice/sync/state').get());
});

test('storage backups and sync objects are private, immutable JSON objects', async () => {
  const alice = environment.authenticatedContext('alice').storage();
  const bob = environment.authenticatedContext('bob').storage();
  const guest = environment.unauthenticatedContext().storage();
  for (const namespace of ['backups', 'sync']) {
    const filename = `users/alice/${namespace}/${id}.json`;
    const ref = alice.ref(filename);
    await assertSucceeds(ref.put(new Uint8Array([123, 125]), { contentType: 'application/json' }));
    await assertSucceeds(ref.getMetadata());
    await assertFails(ref.put(new Uint8Array([123, 125]), { contentType: 'application/json' }));
    await assertFails(bob.ref(filename).getMetadata());
    await assertFails(guest.ref(filename).getMetadata());
    await assertFails(bob.ref(filename).delete());
    await assertSucceeds(ref.delete());
    await assertFails(ref.put(new Uint8Array([1]), { contentType: 'text/plain' }));
  }
});

test('storage enforces the same 20MiB byte limit as imports and snapshots', async () => {
  const ref = environment.authenticatedContext('alice').storage().ref(objectPath);
  await assertFails(ref.put(new Uint8Array(limit + 1), { contentType: 'application/json' }));
  await assertSucceeds(ref.put(new Uint8Array(limit), { contentType: 'application/json' }));
});
