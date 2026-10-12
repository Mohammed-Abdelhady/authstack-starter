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

test('empty gate lists succeed without executing a command', async () => {
  const messages = [];
  assert.equal(await runGates([], { log: (m) => messages.push(m) }), 0);
  assert.deepEqual(messages, []);
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

test('the repository gate list has separate quality, install and installer selections', () => {
  const config = JSON.parse(readFileSync(new URL('./gates.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    selectGates(config).map((g) => g.name),
    [
      'Full-tree hard bans',
      'Package-manager inventory',
      'Workspace dependency check',
      'Colour contrast',
      'Lint',
      'Typecheck',
      'Unit and config tests',
      'Complete config regressions',
      'Build',
      'Backend end-to-end',
      'Backend end-to-end on PostgreSQL',
      'Installer combinations',
      'Installer PostgreSQL projects',
      'Installer MongoDB projects',
      'Browser test frontend build',
      'Frontend browser checks',
      'Complete authentication browser journeys',
    ],
  );
  assert.deepEqual(
    selectGates(config).map((g) => [g.command, g.args]),
    [
      ['node', ['scripts/check-hard-bans.mjs', '--all']],
      ['node', ['scripts/check-package-manager.mjs']],
      ['node', ['scripts/check-workspace-dependencies.mjs']],
      ['node', ['scripts/check-contrast.mjs']],
      ['pnpm', ['run', 'lint']],
      ['pnpm', ['run', 'typecheck']],
      ['pnpm', ['test']],
      ['pnpm', ['run', 'test:config:all']],
      ['pnpm', ['run', 'build']],
      ['pnpm', ['--filter', 'backend', 'run', 'test:e2e']],
      ['pnpm', ['--filter', 'backend', 'run', 'test:e2e:postgres']],
      ['pnpm', ['--filter', 'create-nest-next-auth', 'run', 'test:combinations']],
      ['pnpm', ['--filter', 'create-nest-next-auth', 'run', 'test:combinations:postgres']],
      ['pnpm', ['--filter', 'create-nest-next-auth', 'run', 'test:combinations:mongodb']],
      ['pnpm', ['--filter', 'frontend', 'run', 'build']],
      [
        'pnpm',
        ['--filter', 'frontend', 'run', 'test:e2e', '--config=playwright.frontend.config.ts'],
      ],
      ['pnpm', ['--filter', 'frontend', 'run', 'test:e2e', '--config=playwright.config.ts']],
    ],
  );
  assert.deepEqual(
    selectGates(config, '--installer').map((g) => g.args),
    [['--filter', 'create-nest-next-auth', 'run', 'test:combinations']],
  );
  assert.deepEqual(
    selectGates(config, '--installer-postgres').map((g) => g.args),
    [['--filter', 'create-nest-next-auth', 'run', 'test:combinations:postgres']],
  );
  assert.deepEqual(
    selectGates(config, '--installer-mongodb').map((g) => g.args),
    [['--filter', 'create-nest-next-auth', 'run', 'test:combinations:mongodb']],
  );
  const browser = selectGates(config, '--browser');
  assert.equal(browser.length, 3);
  assert.deepEqual(browser[0].env, { NEXT_PUBLIC_API_URL: 'http://127.0.0.1:5107' });
  assert.equal(
    browser.every((gate) => gate.repositoryOnly === true),
    true,
  );
  assert.deepEqual(
    selectGates(config, '--install').map((g) => [g.command, g.args]),
    [['pnpm', ['install', '--frozen-lockfile']]],
  );
  assert.equal(selectGates(config, '--quality').length, 9);
  assert.deepEqual(
    selectGates(config, '--api').map((g) => g.args),
    [
      ['--filter', 'backend', 'run', 'test:e2e'],
      ['--filter', 'backend', 'run', 'test:e2e:postgres'],
    ],
  );
  // Every gate sits in a listed group, and no listed group is empty.
  assert.deepEqual(config.groups, [
    'quality',
    'api',
    'installer',
    'installer-postgres',
    'installer-mongodb',
    'browser',
  ]);
  assert.deepEqual([...new Set(config.gates.map((g) => g.group))], config.groups);
  assert.throws(() => selectGates(config, '--unknown'), /Unknown CI mode/);
  assert.throws(() => selectGates(config, 'quality'), /Unknown CI mode/);
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
