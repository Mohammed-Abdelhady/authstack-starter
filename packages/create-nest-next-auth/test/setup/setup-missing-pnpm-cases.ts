import { EXPECTED_MISSING_PNPM_REASON } from './setup-flow-expectations.js';
import { MISSING_PNPM_MESSAGE } from '../../src/constants/index.js';

export const MISSING_PNPM_FLAG_CASES = [
  {
    name: 'missing pnpm with git and install',
    flags: [],
    fail: '',
    lock: { ok: false, reason: MISSING_PNPM_MESSAGE },
    expected: {
      git: { status: 'created' },
      install: { status: 'blocked', reason: EXPECTED_MISSING_PNPM_REASON },
      exitCode: 1,
      activationCommand:
        'corepack enable && corepack prepare pnpm@12.6.0 --activate && pnpm install',
      checksRun: [
        'template pruning',
        'dangling references',
        'pnpm version',
        'git repository and first commit',
      ],
      skipped: [
        { check: 'lockfile update', reason: EXPECTED_MISSING_PNPM_REASON },
        { check: 'dependency installation', reason: EXPECTED_MISSING_PNPM_REASON },
      ],
    },
  },
  {
    name: 'missing pnpm with git and no install',
    flags: ['--no-install'],
    fail: '',
    lock: { ok: false, reason: MISSING_PNPM_MESSAGE },
    expected: {
      git: { status: 'created' },
      install: { status: 'not-requested' },
      exitCode: 1,
      activationCommand:
        'corepack enable && corepack prepare pnpm@12.6.0 --activate && pnpm install',
      checksRun: [
        'template pruning',
        'dangling references',
        'pnpm version',
        'git repository and first commit',
      ],
      skipped: [
        { check: 'lockfile update', reason: EXPECTED_MISSING_PNPM_REASON },
        { check: 'dependency installation', reason: '--no-install' },
      ],
    },
  },
  {
    name: 'missing pnpm with neither requested',
    flags: ['--no-git', '--no-install'],
    fail: '',
    lock: { ok: false, reason: MISSING_PNPM_MESSAGE },
    expected: {
      git: { status: 'not-requested' },
      install: { status: 'not-requested' },
      exitCode: 1,
      activationCommand:
        'git init && corepack enable && corepack prepare pnpm@12.6.0 --activate && pnpm install',
      checksRun: ['template pruning', 'dangling references', 'pnpm version'],
      skipped: [
        { check: 'lockfile update', reason: EXPECTED_MISSING_PNPM_REASON },
        { check: 'git repository and first commit', reason: '--no-git' },
        { check: 'dependency installation', reason: '--no-install' },
      ],
    },
  },
];
