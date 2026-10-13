export const LOCK_FAILURE_FLAG_CASES = [
  {
    name: 'lock failure with git and install',
    flags: [],
    fail: '',
    lock: { ok: false, reason: 'registry error' },
    expected: {
      git: { status: 'created' },
      install: { status: 'blocked', reason: 'registry error' },
      exitCode: 1,
      activationCommand: 'pnpm install',
      checksRun: [
        'template pruning',
        'dangling references',
        'pnpm version',
        'lockfile update',
        'git repository and first commit',
      ],
      skipped: [{ check: 'dependency installation', reason: 'registry error' }],
    },
  },
  {
    name: 'lock failure with git and no install',
    flags: ['--no-install'],
    fail: '',
    lock: { ok: false, reason: 'registry error' },
    expected: {
      git: { status: 'created' },
      install: { status: 'not-requested' },
      exitCode: 1,
      activationCommand: 'pnpm install',
      checksRun: [
        'template pruning',
        'dangling references',
        'pnpm version',
        'lockfile update',
        'git repository and first commit',
      ],
      skipped: [{ check: 'dependency installation', reason: '--no-install' }],
    },
  },
  {
    name: 'lock failure with neither requested',
    flags: ['--no-git', '--no-install'],
    fail: '',
    lock: { ok: false, reason: 'registry error' },
    expected: {
      git: { status: 'not-requested' },
      install: { status: 'not-requested' },
      exitCode: 1,
      activationCommand: 'git init && pnpm install',
      checksRun: ['template pruning', 'dangling references', 'pnpm version', 'lockfile update'],
      skipped: [
        { check: 'git repository and first commit', reason: '--no-git' },
        { check: 'dependency installation', reason: '--no-install' },
      ],
    },
  },
];
