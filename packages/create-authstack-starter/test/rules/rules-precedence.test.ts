import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigFileError, parseConfigFile } from '../../src/flags/config-file.js';
import { parseCliOptions } from '../../src/flags/options.js';
import { toPlanRequest } from '../../src/flags/request.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { planPromptNeeds } from '../../src/prompts/plan.js';
import { fixtureRoot, run } from '../support/answers-helpers.js';
import { PLAN_MANIFEST } from '../support/plan-fixture.js';

const roots: string[] = [];
const manifestRoot = fixtureRoot();
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
/** Every dimension but the rules level is fixed, so only that could prompt. */
const ALL_BUT_RULES = [
  '--dry-run',
  '--targets',
  'web',
  '--features',
  'email-password',
  '--no-production',
];

function setTerminal(present: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: present });
}

function configFile(content: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'cna-rules-config-'));
  roots.push(root);
  const path = join(root, 'config.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

beforeEach(() => setTerminal(false));

afterEach(() => {
  if (ttyDescriptor) Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

afterAll(() => rmSync(manifestRoot, { recursive: true, force: true }));

describe('rules level in the config file', () => {
  it.each(['strict', 'standard'] as const)('reads %s', (rules) => {
    expect(parseConfigFile({ rules })).toEqual({ rules });
  });

  it.each([
    { value: 'loose', shown: '"loose"' },
    { value: 'STRICT', shown: '"STRICT"' },
    { value: '', shown: '""' },
    { value: 5, shown: '5' },
    { value: ['strict'], shown: '["strict"]' },
    { value: null, shown: 'null' },
  ])('refuses $shown and names the accepted levels', ({ value, shown }) => {
    const parse = (): unknown => parseConfigFile({ rules: value });

    expect(parse).toThrow(ConfigFileError);
    expect(parse).toThrow(`rules must be one of strict, standard, got ${shown}`);
  });
});

describe('rules level precedence', () => {
  it('takes the flag over the file', () => {
    const request = toPlanRequest(parseCliOptions(['--rules', 'standard']), { rules: 'strict' });

    expect(request.rules).toBe('standard');
  });

  it('takes the file when no flag is given, and does not prompt', () => {
    const request = toPlanRequest(parseCliOptions([]), { rules: 'standard' });

    expect({
      rules: resolvePlan(PLAN_MANIFEST, request).rules,
      prompts: planPromptNeeds(PLAN_MANIFEST, request, true).rules,
    }).toEqual({ rules: 'standard', prompts: false });
  });

  it('asks in a terminal when neither names a level', () => {
    const request = toPlanRequest(parseCliOptions([]), {});

    expect(planPromptNeeds(PLAN_MANIFEST, request, true).rules).toBe(true);
  });

  it('falls back to strict without asking when there is no terminal', () => {
    const request = toPlanRequest(parseCliOptions([]), {});

    expect({
      rules: resolvePlan(PLAN_MANIFEST, request).rules,
      prompts: planPromptNeeds(PLAN_MANIFEST, request, false).rules,
    }).toEqual({ rules: 'strict', prompts: false });
  });
});

describe('rules level from the command line without a terminal', () => {
  it('defaults to strict instead of refusing to run', async () => {
    const { code, output } = await run(manifestRoot, ALL_BUT_RULES);

    expect({ code, strict: output.includes('Rules      strict') }).toEqual({
      code: 0,
      strict: true,
    });
  });

  it('takes the level from the config file', async () => {
    const config = configFile({ rules: 'standard' });

    const { code, output } = await run(manifestRoot, [...ALL_BUT_RULES, '--config', config]);

    expect({ code, standard: output.includes('Rules      standard') }).toEqual({
      code: 0,
      standard: true,
    });
  });

  it('takes the flag over the config file', async () => {
    const config = configFile({ rules: 'standard' });

    const { code, output } = await run(manifestRoot, [
      ...ALL_BUT_RULES,
      '--config',
      config,
      '--rules',
      'strict',
    ]);

    expect({ code, strict: output.includes('Rules      strict') }).toEqual({
      code: 0,
      strict: true,
    });
  });

  it('refuses an invalid level in the config file with exit 2', async () => {
    const config = configFile({ rules: 'loose' });

    const { code, output } = await run(manifestRoot, [...ALL_BUT_RULES, '--config', config]);

    expect({
      code,
      reason: output.includes('rules must be one of strict, standard, got "loose"'),
    }).toEqual({ code: 2, reason: true });
  });

  it('still refuses to run when another answer would need a prompt', async () => {
    const { code, output } = await run(manifestRoot, ['--dry-run']);

    expect({ code, reason: output.includes('No terminal to prompt in.') }).toEqual({
      code: 2,
      reason: true,
    });
  });
});
