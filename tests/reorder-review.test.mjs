import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('reordering a visible child of a completed task preserves root peers and saved hierarchy', () => {
  const saved = new Map();
  const context = vm.createContext({ Date, Math, JSON, Map, Set, console,
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) } });
  for (const name of ['01-store', '14-reorder']) vm.runInContext(fs.readFileSync(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8'), context);
  const { Store, Reorder } = vm.runInContext('({Store,Reorder})', context);
  const parent = Store.addTask({ title: 'completed parent', kind: 'short' });
  const child = Store.addTask({ title: 'unfinished child', parentId: parent.id });
  const other = Store.addTask({ title: 'other root' });
  Store.finishTask(parent.id);
  const before = Array.from(Store.allRoots(), task => task.id);
  assert.ok(before.includes(child.id) && before.includes(other.id));
  assert.equal(Reorder.move(before, before[0], before[1]), true);
  assert.deepEqual(Array.from(Store.allRoots(), task => task.id), before.toReversed());
  assert.equal(child.parentId, parent.id);
  assert.equal(child.done, false);
  Store.undoCompletion(parent.id);
  assert.ok(!Store.allRoots().some(task => task.id === child.id));
});
