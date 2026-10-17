import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runGates, selectGates } from './runner.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ci-gates-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function gate(name, status = 0) {
  return {
    name,
    group: 'quality',
    command: 'node',
    args: [
      '-e',
      `require('node:fs').appendFileSync('order.txt', '${name}\\n'); process.exitCode = ${status};`,
    ],
  };
}

test('runs gates in order and reports their statuses', async (t) => {
  const cwd = fixture(t);
  const messages = [];
  const result = await runGates([gate('first'), gate('second')], {
    cwd,
    log: (m) => messages.push(m),
  });
  assert.equal(result, 0);
  assert.equal(readFileSync(join(cwd, 'order.txt'), 'utf8'), 'first\nsecond\n');
  assert.deepEqual(messages, [
    '[ci] first',
    '[ci] first: exit 0',
    '[ci] second',
    '[ci] second: exit 0',
  ]);
});

test('stops on failure and propagates the child exit code', async (t) => {
  const cwd = fixture(t);
  const messages = [];
  const result = await runGates([gate('first'), gate('broken', 7), gate('last')], {
    cwd,
    log: (m) => messages.push(m),
  });
  assert.equal(result, 7);
  assert.equal(readFileSync(join(cwd, 'order.txt'), 'utf8'), 'first\nbroken\n');
  assert.equal(messages.at(-1), '[ci] broken: exit 7');
});

test('launch errors and signal termination fail closed', async (t) => {
  const cwd = fixture(t);
  for (const command of [
    { name: 'missing', command: join(cwd, 'missing'), args: [] },
    { name: 'signal', command: 'node', args: ['-e', "process.kill(process.pid, 'SIGTERM')"] },
  ]) {
    const messages = [];
    assert.equal(await runGates([command, gate('last')], { cwd, log: (m) => messages.push(m) }), 2);
    assert.equal(messages.at(-1), `[ci] ${command.name}: exit 2`);
  }
});

test('a mode that names no group and a group with no gate are told apart', () => {
  const config = {
    groups: ['quality', 'empty'],
    gates: [{ name: 'Lint', group: 'quality', command: 'pnpm', args: ['run', 'lint'] }],
  };

  assert.throws(() => selectGates(config, '--missing'), {
    message: 'Unknown CI mode: --missing. The gate list has the groups: quality, empty',
  });
  assert.throws(() => selectGates(config, '--empty'), {
    message: 'No gates for CI mode: --empty. The group "empty" is listed with no gate',
  });
  // A list written before groups were named: its groups are the ones its gates use.
  const older = { gates: config.gates };
  assert.deepEqual(selectGates(older, '--quality'), config.gates);
  assert.throws(() => selectGates(older, '--empty'), /^Error: Unknown CI mode: --empty\./);
});

test('gate-specific environment reaches the real subprocess', async (t) => {
  const cwd = fixture(t);
  const result = await runGates(
    [
      {
        name: 'install environment',
        command: 'node',
        env: { MONGOMS_DISABLE_POSTINSTALL: '1' },
        args: [
          '-e',
          "require('node:fs').writeFileSync('environment.txt', process.env.MONGOMS_DISABLE_POSTINSTALL + ':' + process.env.KEEP)",
        ],
      },
    ],
    { cwd, env: { KEEP: 'kept' }, log: () => {} },
  );
  assert.equal(result, 0);
  assert.equal(readFileSync(join(cwd, 'environment.txt'), 'utf8'), '1:kept');
});
