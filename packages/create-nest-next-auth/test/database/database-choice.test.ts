import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { select } from '@clack/prompts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCliOptions } from '../../src/flags/options.js';
import { toPlanRequest } from '../../src/flags/request.js';
import { availableDatabaseIds, defaultDatabaseIds } from '../../src/manifest/dimensions.js';
import { loadManifest } from '../../src/manifest/load.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { CANCELLED } from '../../src/prompts/index.js';
import { askPlan, planPromptNeeds } from '../../src/prompts/plan.js';
import { buildSummary, describePlanErrors } from '../../src/report/summary.js';
import { fixtureRoot, REPO_ROOT, run } from '../support/answers-helpers.js';
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

describe('the databases the manifest offers', () => {
  it('offers MongoDB and PostgreSQL, with MongoDB as the default', async () => {
    const manifest = await loadManifest(REPO_ROOT);

    expect({
      offered: availableDatabaseIds(manifest),
      byDefault: defaultDatabaseIds(manifest),
      labels: availableDatabaseIds(manifest).map((id) => manifest.databases[id].label),
    }).toEqual({
      offered: ['mongodb', 'postgres'],
      byDefault: ['mongodb'],
      labels: ['MongoDB', 'PostgreSQL'],
    });
  });
});

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
    ['an unknown name', 'mysql', '"mysql" is not a known choice.'],
    ['two names', 'mongodb,postgres', 'Choose exactly one database; got: mongodb,postgres.'],
  ])('refuses %s with the message other choices get', (_, value, message) => {
    const plan = resolvePlan(PLAN_MANIFEST, toPlanRequest(parseCliOptions(['--database', value])));

    expect(describePlanErrors(PLAN_MANIFEST, plan.errors)).toEqual([message]);
  });

  it.each([
    ['postgres', 'Database   PostgreSQL'],
    ['mongodb', 'Database   MongoDB'],
  ])('shows %s in the summary', (database, line) => {
    expect(
      buildSummary(PLAN_MANIFEST, resolvePlan(PLAN_MANIFEST, { databases: [database] })),
    ).toContain(line);
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
      message: 'Which database?',
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
  it('takes PostgreSQL from the flag', async () => {
    const { code, output } = await run(manifestRoot, [
      ...ALL_BUT_DATABASE,
      '--database',
      'postgres',
    ]);

    expect({ code, postgres: output.includes('Database   PostgreSQL') }).toEqual({
      code: 0,
      postgres: true,
    });
  });

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
      fromFile: [fromFile.code, fromFile.output.includes('Database   PostgreSQL')],
      flagWins: [flagWins.code, flagWins.output.includes('Database   MongoDB')],
    }).toEqual({ fromFile: [0, true], flagWins: [0, true] });
  });

  it('gives a command line written before the choice MongoDB, without a terminal and with --yes', async () => {
    const withoutTerminal = await run(manifestRoot, ALL_BUT_DATABASE);
    setTerminal(true);
    const accepted = await run(manifestRoot, [...ALL_BUT_DATABASE, '--yes']);

    expect({
      withoutTerminal: [
        withoutTerminal.code,
        withoutTerminal.output.includes('Database   MongoDB'),
      ],
      accepted: [accepted.code, accepted.output.includes('Database   MongoDB')],
      asked: vi.mocked(select).mock.calls.length,
    }).toEqual({ withoutTerminal: [0, true], accepted: [0, true], asked: 0 });
  });

  it('asks in a terminal and builds what was answered', async () => {
    setTerminal(true);
    vi.mocked(select).mockResolvedValue('postgres');

    const { code, output } = await run(manifestRoot, ALL_BUT_DATABASE);

    expect({
      code,
      postgres: output.includes('Database   PostgreSQL'),
      asked: vi.mocked(select).mock.calls.map(([question]) => question.message),
    }).toEqual({ code: 0, postgres: true, asked: ['Which database?'] });
  });

  it('refuses an unknown database with exit 2 and writes nothing', async () => {
    const { code, output } = await run(manifestRoot, [...ALL_BUT_DATABASE, '--database', 'mysql']);

    expect({
      code,
      named: output.includes('"mysql" is not a known choice.'),
      wrote: output.includes('Nothing was written.'),
    }).toEqual({ code: 2, named: true, wrote: true });
  });
});
