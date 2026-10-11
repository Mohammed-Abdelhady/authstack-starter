import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { isRunning, stopProcessTree } from './round8-hook-fixture.mjs';

for (const leader of [0, 1, -5, 1.5, Number.NaN, process.pid]) {
  test(`${leader} is refused as the leader of a tree to stop`, () => {
    assert.throws(() => stopProcessTree(leader), RangeError);
  });
}

test('a process that holds the number without leading its group is left running', (t) => {
  // Stands in for a number reused after the push exited: alive, in another group.
  const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  t.after(() => bystander.kill('SIGKILL'));
  stopProcessTree(bystander.pid);
  assert.deepEqual(
    { started: bystander.pid > 1, running: isRunning(bystander.pid) },
    { started: true, running: true },
  );
});
