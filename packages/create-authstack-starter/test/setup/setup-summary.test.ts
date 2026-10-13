import { expect, it } from 'vitest';
import { buildSetupSummary } from '../../src/scaffold/setup-summary.js';
import { renderSetupSummary } from '../../src/report/setup-summary.js';
import type { SetupFacts } from '../../src/types/setup.js';

const BASE: SetupFacts = {
  files: { count: 12, instructions: ['AGENTS.md', 'CLAUDE.md', 'backend/AGENTS.md'] },
  rules: 'strict',
  lockfile: { status: 'updated' },
  git: { status: 'created' },
  install: { status: 'installed' },
  ownRepository: true,
  hooksIncluded: true,
  hooksActive: true,
  checksRun: [
    'template pruning',
    'dangling references',
    'pnpm version',
    'lockfile update',
    'git repository and first commit',
    'dependency installation',
  ],
  skipped: [{ check: 'lint', reason: 'Not run by the installer.' }],
  nextSteps: ['cd app'],
  docs: ['README.md'],
};

it.each<{ name: string; skipped: SetupFacts['skipped']; expected: string[] }>([
  { name: 'empty', skipped: [], expected: [] },
  {
    name: 'populated',
    skipped: [{ check: 'lint', reason: 'Not run by the installer.' }],
    expected: ['Skipped:', '  lint: Not run by the installer.'],
  },
])('prints the skipped section only for a $name list with entries', ({ skipped, expected }) => {
  const lines = renderSetupSummary(buildSetupSummary({ ...BASE, skipped }));
  expect(lines.filter((line) => line === 'Skipped:' || line.startsWith('  '))).toEqual(expected);
});

const CASES: {
  name: string;
  facts: Partial<SetupFacts>;
  expected: {
    exitCode: number;
    hooks: { included: boolean; active: boolean; activationCommand?: string };
  };
}[] = [
  {
    name: 'active strict',
    facts: {},
    expected: { exitCode: 0, hooks: { included: true, active: true } },
  },
  {
    name: 'active standard',
    facts: { rules: 'standard' },
    expected: { exitCode: 0, hooks: { included: true, active: true } },
  },
  {
    name: 'no install',
    facts: { hooksActive: false, install: { status: 'not-requested' } },
    expected: {
      exitCode: 0,
      hooks: { included: true, active: false, activationCommand: 'pnpm install' },
    },
  },
  {
    name: 'no git',
    facts: { hooksActive: false, ownRepository: false, git: { status: 'not-requested' } },
    expected: {
      exitCode: 0,
      hooks: { included: true, active: false, activationCommand: 'git init && pnpm exec husky' },
    },
  },
  {
    name: 'neither requested',
    facts: {
      hooksActive: false,
      ownRepository: false,
      git: { status: 'not-requested' },
      install: { status: 'not-requested' },
    },
    expected: {
      exitCode: 0,
      hooks: { included: true, active: false, activationCommand: 'git init && pnpm install' },
    },
  },
  {
    name: 'missing pnpm',
    facts: {
      hooksActive: false,
      lockfile: { status: 'removed', reason: 'missing pnpm' },
      install: { status: 'blocked', reason: 'missing pnpm' },
    },
    expected: {
      exitCode: 1,
      hooks: { included: true, active: false, activationCommand: 'pnpm install' },
    },
  },
  {
    name: 'lock failure without git',
    facts: {
      ownRepository: false,
      hooksActive: false,
      lockfile: { status: 'removed', reason: 'registry error' },
      install: { status: 'blocked', reason: 'registry error' },
    },
    expected: {
      exitCode: 1,
      hooks: { included: true, active: false, activationCommand: 'git init && pnpm install' },
    },
  },
  {
    name: 'lock failure no install',
    facts: {
      hooksActive: false,
      lockfile: { status: 'removed', reason: 'registry error' },
      install: { status: 'not-requested' },
    },
    expected: {
      exitCode: 1,
      hooks: { included: true, active: false, activationCommand: 'pnpm install' },
    },
  },
  {
    name: 'install failed',
    facts: { hooksActive: false, install: { status: 'failed', reason: 'install error' } },
    expected: {
      exitCode: 1,
      hooks: { included: true, active: false, activationCommand: 'pnpm install' },
    },
  },
  {
    name: 'git init failed',
    facts: {
      hooksActive: false,
      ownRepository: false,
      git: { status: 'failed', reason: 'git error' },
    },
    expected: {
      exitCode: 1,
      hooks: { included: true, active: false, activationCommand: 'git init && pnpm exec husky' },
    },
  },
  {
    name: 'first commit failed hooks active',
    facts: { git: { status: 'failed', reason: 'commit error' } },
    expected: { exitCode: 1, hooks: { included: true, active: true } },
  },
  {
    name: 'install did not activate hooks',
    facts: { hooksActive: false },
    expected: {
      exitCode: 0,
      hooks: { included: true, active: false, activationCommand: 'pnpm exec husky' },
    },
  },
  {
    name: 'hooks not included',
    facts: { hooksIncluded: false, hooksActive: false },
    expected: { exitCode: 0, hooks: { included: false, active: false } },
  },
];

it.each(CASES)('returns honest hook and exit states for $name', ({ facts, expected }) => {
  const result = buildSetupSummary({ ...BASE, ...facts });
  expect({ exitCode: result.exitCode, hooks: result.hooks }).toEqual(expected);
});

it('returns all observed facts without losing rules, failures, commands or checks', () => {
  expect(
    buildSetupSummary({
      ...BASE,
      rules: 'standard',
      lockfile: { status: 'removed', reason: 'registry error' },
      install: { status: 'blocked', reason: 'registry error' },
      hooksActive: false,
    }),
  ).toEqual({
    files: { count: 12, instructions: ['AGENTS.md', 'CLAUDE.md', 'backend/AGENTS.md'] },
    rules: 'standard',
    lockfile: { status: 'removed', reason: 'registry error' },
    git: { status: 'created' },
    install: { status: 'blocked', reason: 'registry error' },
    checksRun: [
      'template pruning',
      'dangling references',
      'pnpm version',
      'lockfile update',
      'git repository and first commit',
      'dependency installation',
    ],
    skipped: [{ check: 'lint', reason: 'Not run by the installer.' }],
    nextSteps: ['cd app'],
    docs: ['README.md'],
    exitCode: 1,
    hooks: { included: true, active: false, activationCommand: 'pnpm install' },
  });
});
