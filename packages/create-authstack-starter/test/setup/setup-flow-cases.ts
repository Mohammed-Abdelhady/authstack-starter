import { EXPECTED_MISSING_PNPM_REASON } from './setup-flow-expectations.js';
import { LOCK_FAILURE_FLAG_CASES } from './setup-lock-failure-cases.js';
import { MISSING_PNPM_FLAG_CASES } from './setup-missing-pnpm-cases.js';
import { MISSING_PNPM_MESSAGE } from '../../src/constants/index.js';

export const CASES = [
  ...LOCK_FAILURE_FLAG_CASES,
  ...MISSING_PNPM_FLAG_CASES,
  {
    name: 'git and install',
    flags: [],
    fail: '',
    lock: { ok: true },
    expected: {
      git: { status: 'created' },
      install: { status: 'installed' },
      exitCode: 0,
      activationCommand: 'pnpm exec husky',
      checksRun: [
        'template pruning',
        'dangling references',
        'pnpm version',
        'lockfile update',
        'git repository and first commit',
        'dependency installation',
      ],
      skipped: [],
    },
  },
  {
    name: 'no git',
    flags: ['--no-git'],
    fail: '',
    lock: { ok: true },
    expected: {
      git: { status: 'not-requested' },
      install: { status: 'installed' },
      exitCode: 0,
      activationCommand: 'git init && pnpm exec husky',
      checksRun: [
        'template pruning',
        'dangling references',
        'pnpm version',
        'lockfile update',
        'dependency installation',
      ],
      skipped: [{ check: 'git repository and first commit', reason: '--no-git' }],
    },
  },
  {
    name: 'no install',
    flags: ['--no-install'],
    fail: '',
    lock: { ok: true },
    expected: {
      git: { status: 'created' },
      install: { status: 'not-requested' },
      exitCode: 0,
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
    name: 'neither',
    flags: ['--no-install', '--no-git'],
    fail: '',
    lock: { ok: true },
    expected: {
      git: { status: 'not-requested' },
      install: { status: 'not-requested' },
      exitCode: 0,
      activationCommand: 'git init && pnpm install',
      checksRun: ['template pruning', 'dangling references', 'pnpm version', 'lockfile update'],
      skipped: [
        { check: 'git repository and first commit', reason: '--no-git' },
        { check: 'dependency installation', reason: '--no-install' },
      ],
    },
  },
  {
    name: 'lock failure',
    flags: ['--no-git'],
    fail: '',
    lock: { ok: false, reason: 'registry error' },
    expected: {
      git: { status: 'not-requested' },
      install: { status: 'blocked', reason: 'registry error' },
      exitCode: 1,
      activationCommand: 'git init && pnpm install',
      checksRun: ['template pruning', 'dangling references', 'pnpm version', 'lockfile update'],
      skipped: [
        { check: 'git repository and first commit', reason: '--no-git' },
        { check: 'dependency installation', reason: 'registry error' },
      ],
    },
  },
  {
    name: 'missing pnpm',
    flags: ['--no-git'],
    fail: '',
    lock: { ok: false, reason: MISSING_PNPM_MESSAGE },
    expected: {
      git: { status: 'not-requested' },
      install: { status: 'blocked', reason: EXPECTED_MISSING_PNPM_REASON },
      exitCode: 1,
      activationCommand:
        'git init && corepack enable && corepack prepare pnpm@12.6.0 --activate && pnpm install',
      checksRun: ['template pruning', 'dangling references', 'pnpm version'],
      skipped: [
        { check: 'lockfile update', reason: EXPECTED_MISSING_PNPM_REASON },
        { check: 'git repository and first commit', reason: '--no-git' },
        { check: 'dependency installation', reason: EXPECTED_MISSING_PNPM_REASON },
      ],
    },
  },
  {
    name: 'install failure',
    flags: ['--no-git'],
    fail: '--frozen-lockfile',
    lock: { ok: true },
    expected: {
      git: { status: 'not-requested' },
      install: { status: 'failed', reason: 'registry refused the request' },
      exitCode: 1,
      activationCommand: 'git init && pnpm install',
      checksRun: [
        'template pruning',
        'dangling references',
        'pnpm version',
        'lockfile update',
        'dependency installation',
      ],
      skipped: [{ check: 'git repository and first commit', reason: '--no-git' }],
    },
  },
  {
    name: 'install failure with git',
    flags: [],
    fail: '--frozen-lockfile',
    lock: { ok: true },
    expected: {
      git: { status: 'created' },
      install: { status: 'failed', reason: 'registry refused the request' },
      exitCode: 1,
      activationCommand: 'pnpm install',
      checksRun: [
        'template pruning',
        'dangling references',
        'pnpm version',
        'lockfile update',
        'git repository and first commit',
        'dependency installation',
      ],
      skipped: [],
    },
  },
];
