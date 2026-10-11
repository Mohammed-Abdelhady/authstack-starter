import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { isRunning, stopProcessTree } from '../support/process-tree.js';

const IDLE = ['-e', 'setInterval(() => {}, 1000)'];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
});

it.each([0, 1, -5, 1.5, Number.NaN, process.pid])(
  'refuses %s as the leader of a tree to stop',
  (leader) => {
    expect(() => stopProcessTree(leader)).toThrow(RangeError);
  },
);

it('leaves a process that holds the number without leading its group', () => {
  // Stands in for a number reused after the push exited: alive, in another group.
  const bystander = spawn(process.execPath, IDLE, { stdio: 'ignore' });
  children.push(bystander);
  const pid = bystander.pid ?? 0;
  stopProcessTree(pid);
  expect({ started: pid > 1, running: isRunning(pid) }).toEqual({ started: true, running: true });
});
