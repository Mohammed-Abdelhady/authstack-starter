import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { select } from '@clack/prompts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCliOptions } from '../../src/flags/options.js';
import { toPlanRequest } from '../../src/flags/request.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { CANCELLED } from '../../src/prompts/index.js';
import type { PlanError } from '../../src/manifest/plan-types.js';
import { askPlan, DATABASE_QUESTION, planPromptNeeds } from '../../src/prompts/plan.js';
import { describePlanErrors } from '../../src/report/summary.js';
import { fixtureRoot, run } from '../support/answers-helpers.js';
import { PLAN_MANIFEST } from '../support/plan-fixture.js';

vi.mock('@clack/prompts', async (original) => ({
  ...(await original<typeof import('@clack/prompts')>()),
  select: vi.fn(),
}));

const ONLY_DATABASE = {
  targets: false,
  database: true,
  features: false,
  options: false,
  mobile: false,
  rules: false,
};
/** Every other choice is fixed, so the database is the one thing left open. */
const ALL_BUT_DATABASE = [
  '--dry-run',
  '--targets',
  'web',
  '--features',
  'email-password',
  '--no-production',
  '--rules',
  'strict',
];

const manifestRoot = fixtureRoot();

/** The database a printed summary names, as the id whose label the line carries. */
function databaseShown(output: string | string[]): string | undefined {
  const text = typeof output === 'string' ? output : output.join('\n');
  const label = /^.*\bDatabase\s+(\S.*?)\s*$/m.exec(text)?.[1];
  return Object.entries(PLAN_MANIFEST.databases).find(([, entry]) => entry.label === label)?.[0];
}

/** The line the CLI prints for one plan error, read from where it is written. */
function sentenceFor(error: PlanError): string {
  return describePlanErrors(PLAN_MANIFEST, [error])[0];
}
const roots: string[] = [];
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

function setTerminal(present: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: present });
}

function configFile(content: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'cna-database-config-'));
  roots.push(root);
  const path = join(root, 'config.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

beforeEach(() => setTerminal(false));

afterEach(() => {
  if (ttyDescriptor) Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  vi.resetAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

afterAll(() => rmSync(manifestRoot, { recursive: true, force: true }));

describe('the database flag', () => {
  it.each([
    [['--database', 'postgres'], 'postgres'],
    [['--database', 'mongodb'], 'mongodb'],
    [['--database', ' PostgreS '], 'postgres'],
    [[], 'mongodb'],
  ])('resolves %j to %s', (argv, expected) => {
    const plan = resolvePlan(PLAN_MANIFEST, toPlanRequest(parseCliOptions(argv)));

    expect({ database: plan.database, errors: plan.errors }).toEqual({
      database: expected,
      errors: [],
    });
  });

  it.each([
    ['an unknown name', 'mysql', '', { id: 'mysql', reason: 'unknown' }],
    // The first name stays in the plan, and the error stops the run before it is used.
    [
      'two names',
      'mongodb,postgres',
      'mongodb',
      { id: 'mongodb,postgres', reason: 'database-conflict' },
    ],
  ])('refuses %s and names what was asked for', (_, value, database, error) => {
    const plan = resolvePlan(PLAN_MANIFEST, toPlanRequest(parseCliOptions(['--database', value])));

    expect({ database: plan.database, errors: plan.errors }).toEqual({ database, errors: [error] });
  });
});

describe('the database question', () => {
  it('is asked in a terminal when no flag or file named one, and not otherwise', () => {
    expect({
      open: planPromptNeeds(PLAN_MANIFEST, {}, true).database,
      named: planPromptNeeds(PLAN_MANIFEST, { databases: ['postgres'] }, true).database,
      withPreset: planPromptNeeds(PLAN_MANIFEST, { preset: 'minimal' }, true).database,
      withoutTerminal: planPromptNeeds(PLAN_MANIFEST, {}, false).database,
    }).toEqual({ open: true, named: false, withPreset: true, withoutTerminal: false });
  });

  it('offers every available database, starts on the default and records the answer', async () => {
    vi.mocked(select).mockResolvedValue('postgres');

    expect(await askPlan(PLAN_MANIFEST, {}, ONLY_DATABASE)).toEqual({ databases: ['postgres'] });
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith({
      message: DATABASE_QUESTION,
      initialValue: 'mongodb',
      options: [
        { value: 'mongodb', label: 'MongoDB' },
        { value: 'postgres', label: 'PostgreSQL' },
      ],
    });
  });

  it('propagates cancellation', async () => {
    vi.mocked(select).mockResolvedValue(Symbol('cancel'));

    expect(await askPlan(PLAN_MANIFEST, {}, ONLY_DATABASE)).toBe(CANCELLED);
  });
});

describe('a command line with the real manifest', () => {
  it('takes PostgreSQL from the config file, and the flag over the file', async () => {
    const config = configFile({ database: 'postgres' });

    const fromFile = await run(manifestRoot, [...ALL_BUT_DATABASE, '--config', config]);
    const flagWins = await run(manifestRoot, [
      ...ALL_BUT_DATABASE,
      '--config',
      config,
      '--database',
      'mongodb',
    ]);

    expect({
      fromFile: [fromFile.code, databaseShown(fromFile.output)],
      flagWins: [flagWins.code, databaseShown(flagWins.output)],
    }).toEqual({ fromFile: [0, 'postgres'], flagWins: [0, 'mongodb'] });
  });

  it('gives a command line written before the choice MongoDB, without a terminal and with --yes', async () => {
    const withoutTerminal = await run(manifestRoot, ALL_BUT_DATABASE);
    setTerminal(true);
    const accepted = await run(manifestRoot, [...ALL_BUT_DATABASE, '--yes']);

    expect({
      withoutTerminal: [withoutTerminal.code, databaseShown(withoutTerminal.output)],
      accepted: [accepted.code, databaseShown(accepted.output)],
      asked: vi.mocked(select).mock.calls.length,
    }).toEqual({ withoutTerminal: [0, 'mongodb'], accepted: [0, 'mongodb'], asked: 0 });
  });

  it('asks in a terminal and builds what was answered', async () => {
    setTerminal(true);
    vi.mocked(select).mockResolvedValue('postgres');

    const { code, output } = await run(manifestRoot, ALL_BUT_DATABASE);

    expect({
      code,
      database: databaseShown(output),
      asked: vi.mocked(select).mock.calls.map(([question]) => question.message),
    }).toEqual({ code: 0, database: 'postgres', asked: [DATABASE_QUESTION] });
  });

  it('refuses an unknown database with exit 2 and writes nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cna-database-target-'));
    roots.push(root);
    const target = join(root, 'my-app');

    // No --dry-run: a run that got past the refusal would write the project.
    const { code, output } = await run(manifestRoot, [
      target,
      ...ALL_BUT_DATABASE.filter((flag) => flag !== '--dry-run'),
      '--yes',
      '--no-install',
      '--no-git',
      '--database',
      'mysql',
    ]);

    expect({
      code,
      named: output.includes(sentenceFor({ id: 'mysql', reason: 'unknown' })),
      written: existsSync(target),
      left: readdirSync(root),
    }).toEqual({ code: 2, named: true, written: false, left: [] });
  });
});
