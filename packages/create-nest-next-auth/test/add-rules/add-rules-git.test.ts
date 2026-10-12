import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { planRules } from '../../src/add-rules/plan.js';
import {
  cleanRulesFixtures,
  fixtureGit,
  rulesFixture,
  TRUSTED_RULES_ROOT,
} from './add-rules-fixture.js';

const boundary = vi.hoisted(() => ({
  calls: [] as {
    command: string;
    args: string[];
    cwd: string | undefined;
    shell: boolean;
    repositoryEnv: boolean;
  }[],
}));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (
      command: string,
      args: string[],
      options: import('node:child_process').SpawnOptions,
    ) => {
      boundary.calls.push({
        command,
        args: args.map((arg) =>
          arg.startsWith('core.hooksPath=') ? 'core.hooksPath=<empty>' : arg,
        ),
        cwd: typeof options.cwd === 'string' ? options.cwd : undefined,
        shell: options.shell !== undefined && options.shell !== false,
        repositoryEnv: Object.keys(options.env ?? {}).some((key) =>
          [
            'GIT_DIR',
            'GIT_WORK_TREE',
            'GIT_INDEX_FILE',
            'GIT_CONFIG_COUNT',
            'GIT_QUARANTINE_PATH',
          ].includes(key),
        ),
      });
      return actual.spawn(command, args, options);
    },
  };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  boundary.calls = [];
  await cleanRulesFixtures();
});
it('only calls real Git for safe hooks inspection, with no project values in argv', async () => {
  const root = await rulesFixture({
    name: '$(touch marker)',
    packageManager: 'npm@10.9.9',
    scripts: { 'lint; touch marker': 'touch marker' },
  });
  fixtureGit(root, ['init', '--quiet']);
  vi.stubEnv('GIT_QUARANTINE_PATH', join(root, 'wrong-quarantine'));
  vi.stubEnv('GIT_DIR', join(root, 'wrong'));
  vi.stubEnv('GIT_CONFIG_COUNT', '1');
  vi.stubEnv('GIT_CONFIG_KEY_0', 'core.fsmonitor');
  vi.stubEnv('GIT_CONFIG_VALUE_0', 'touch marker');
  await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  expect(boundary.calls.map(({ cwd, ...call }) => ({ ...call, ownCwd: cwd === root }))).toEqual([
    {
      command: '/usr/bin/git',
      args: [
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=<empty>',
        'config',
        '-z',
        '--local',
        '--get-all',
        'core.hooksPath',
      ],
      shell: false,
      repositoryEnv: false,
      ownCwd: true,
    },
    {
      command: '/usr/bin/git',
      args: [
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=<empty>',
        'config',
        '-z',
        '--get-all',
        'core.hooksPath',
      ],
      shell: false,
      repositoryEnv: false,
      ownCwd: true,
    },
  ]);
});
