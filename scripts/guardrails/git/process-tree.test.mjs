import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stopProcessTree } from '../../lib/process-tree.mjs';

for (const leader of [0, 1, -5, 1.5, Number.NaN, process.pid]) {
  test(`${leader} is refused as the leader of a tree to stop`, () => {
    assert.throws(() => stopProcessTree(leader), RangeError);
  });
}

test(
  'a process that holds the number without leading its group is left running',
  { timeout: 5000 },
  async (t) => {
    const bystander = spawn(
      process.execPath,
      ['-e', "process.on('message', () => process.send('alive'));"],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    );
    const closed = new Promise((resolve) => bystander.once('close', resolve));
    t.after(async () => {
      bystander.kill('SIGKILL');
      await closed;
    });
    await new Promise((resolve) => bystander.once('spawn', resolve));
    const reply = new Promise((resolve, reject) => {
      bystander.once('message', resolve);
      bystander.once('error', reject);
      bystander.once('exit', () => reject(new Error('The bystander was stopped.')));
    });
    stopProcessTree(bystander.pid);
    bystander.send('probe');
    assert.deepEqual(
      { started: bystander.pid > 1, response: await reply },
      {
        started: true,
        response: 'alive',
      },
    );
  },
);

for (const status of [0, 1]) {
  test(
    `stops its group when ps returns no rows with status ${status}`,
    { timeout: 5000 },
    async (t) => {
      const root = mkdtempSync(join(tmpdir(), 'cna-empty-ps-'));
      const fakePs = join(root, 'ps');
      writeFileSync(fakePs, `#!${process.execPath}\nprocess.exit(${status});\n`);
      chmodSync(fakePs, 0o755);
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60_000);'], {
        detached: true,
        stdio: 'ignore',
      });
      const closed = new Promise((resolve) => child.once('close', resolve));
      const previousPath = process.env.PATH;
      t.after(async () => {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        child.kill('SIGKILL');
        await closed;
        rmSync(root, { recursive: true, force: true });
      });
      await new Promise((resolve) => child.once('spawn', resolve));
      process.env.PATH = root;
      stopProcessTree(child.pid);
      await closed;
      assert.equal(child.signalCode, 'SIGKILL');
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    },
  );
}
