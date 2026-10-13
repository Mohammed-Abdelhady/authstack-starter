import { CommanderError } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { select } from '@clack/prompts';
import { parseCliOptions } from '../../src/flags/options.js';
import { toPlanRequest } from '../../src/flags/request.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { askPlan, planPromptNeeds } from '../../src/prompts/plan.js';
import { CANCELLED } from '../../src/prompts/index.js';
import { buildSummary } from '../../src/report/summary.js';
import { PLAN_MANIFEST } from '../support/plan-fixture.js';
vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  multiselect: vi.fn(),
  isCancel: (value: unknown) => typeof value === 'symbol',
}));
afterEach(() => vi.resetAllMocks());
const ONLY_RULES = {
  targets: false,
  database: false,
  features: false,
  options: false,
  mobile: false,
  rules: true,
};
describe('rules selection', () => {
  it('leaves absent flags promptable and resolves --yes to strict', () => {
    const request = toPlanRequest(parseCliOptions(['--yes']));
    expect(request.rules).toBeUndefined();
    expect(resolvePlan(PLAN_MANIFEST, request).rules).toBe('strict');
    expect(planPromptNeeds(PLAN_MANIFEST, request).rules).toBe(true);
  });
  it.each(['strict', 'standard'] as const)('passes explicit %s through the plan', (policy) => {
    const request = toPlanRequest(parseCliOptions(['--rules', policy]));
    expect(request.rules).toBe(policy);
    expect(resolvePlan(PLAN_MANIFEST, request).rules).toBe(policy);
    expect(planPromptNeeds(PLAN_MANIFEST, request).rules).toBe(false);
  });
  it.each([{ values: ['loose'] }, { values: [''] }, { values: [] }])(
    'rejects invalid or missing rules %j',
    ({ values }) => {
      try {
        parseCliOptions(['--rules', ...values]);
        throw new Error('accepted invalid rules');
      } catch (error) {
        expect(error).toBeInstanceOf(CommanderError);
        if (!(error instanceof CommanderError)) throw error;
        expect(error.exitCode).toBe(1);
      }
    },
  );
  it('defaults the one rules question to strict and records standard', async () => {
    vi.mocked(select).mockResolvedValue('standard');
    expect(await askPlan(PLAN_MANIFEST, {}, ONLY_RULES)).toEqual({ rules: 'standard' });
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith({
      message: 'Rules: strict (recommended) or standard',
      initialValue: 'strict',
      options: [
        { value: 'strict', label: 'strict (recommended)' },
        { value: 'standard', label: 'standard' },
      ],
    });
  });
  it('propagates cancellation', async () => {
    vi.mocked(select).mockResolvedValue(Symbol('cancel'));
    expect(await askPlan(PLAN_MANIFEST, {}, ONLY_RULES)).toBe(CANCELLED);
  });
  it.each(['strict', 'standard'] as const)('shows %s in the summary', (rules) => {
    expect(buildSummary(PLAN_MANIFEST, resolvePlan(PLAN_MANIFEST, { rules }))).toContain(
      `Rules      ${rules}`,
    );
  });
});
