import { expect, it } from 'vitest';
import { renderSetupSummary } from '../../src/report/setup-summary.js';
import type { SetupSummary } from '../../src/types/setup.js';

const RESULT: SetupSummary = {
  files: { count: 19, instructions: ['AGENTS.md', 'CLAUDE.md', 'backend/AGENTS.md'] },
  rules: 'standard',
  lockfile: { status: 'removed', reason: 'registry unavailable' },
  git: { status: 'failed', reason: 'first commit rejected' },
  install: { status: 'blocked', reason: 'registry unavailable' },
  hooks: { included: true, active: false, activationCommand: 'pnpm install' },
  checksRun: ['template pruning', 'dangling references', 'pnpm version', 'lockfile update'],
  skipped: [{ check: 'dependency installation', reason: 'registry unavailable' }],
  exitCode: 1,
  nextSteps: ['cd app', 'pnpm install'],
  docs: ['README.md'],
};

it('renders every observed fact and one hook activation command from the result', () => {
  const lines = renderSetupSummary(RESULT);
  const text = lines.join('\n');
  expect({
    count: text.includes('19'),
    instructions: text.includes('AGENTS.md, CLAUDE.md, backend/AGENTS.md'),
    rules: text.includes('standard'),
    lockfile: text.includes('removed'),
    gitFailure: text.includes('first commit rejected'),
    install: text.includes('blocked'),
    checks: text.includes('template pruning, dangling references, pnpm version, lockfile update'),
    skipped: text.includes('dependency installation: registry unavailable'),
    activationLines: lines.filter((line) => line.includes('pnpm install')).length,
  }).toEqual({
    count: true,
    instructions: true,
    rules: true,
    lockfile: true,
    gitFailure: true,
    install: true,
    checks: true,
    skipped: true,
    activationLines: 1,
  });
});

it('omits activation commands when hooks are already active or not shipped', () => {
  expect([
    renderSetupSummary({ ...RESULT, hooks: { included: true, active: true } }).some((line) =>
      line.includes('pnpm install'),
    ),
    renderSetupSummary({ ...RESULT, hooks: { included: false, active: false } }).some((line) =>
      line.includes('pnpm install'),
    ),
  ]).toEqual([false, false]);
});
