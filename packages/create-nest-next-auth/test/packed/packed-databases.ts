import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { ANSWERS_FILE_NAME } from '../../src/constants/index.js';
import { isRecord } from '../../src/manifest/read.js';
import {
  findForbiddenContent,
  findForbiddenLines,
  SKIPPED_SCAN_DIRS,
  SKIPPED_SCAN_FILES,
} from '../support/reference-content.js';
import { type Packed, scaffold } from './packed-cli.js';
import { MONGO_SURVIVING_LINES, MONGO_WORDS } from './packed-database-survivors.js';

const EVERY_FEATURE =
  'email-password,magic-link,totp,passkeys,google,github,facebook,microsoft,apple,discord,linkedin,gitlab,x,slack,twitch,oidc';

/** Words a MongoDB project has no use for, whatever else was picked. */
const POSTGRES_WORDS = [/postgres/i, /kysely/i, /\bpg\b/, /uuidv7/i, /DATABASE_TYPE/, /sqlstate/i];
// `// feature:x`, `{/* feature:x */}`, `<!-- feature:x -->` or `# feature:x`.
const ANY_MARKER = /(?:\/\/|\{\/\*|<!--|#)\s*feature:[a-z0-9-]/;

const MONGO_PACKAGES = [
  '@nestjs/mongoose',
  'mongoose',
  'mongodb',
  'migrate-mongo',
  'mongodb-memory-server',
];
const POSTGRES_PACKAGES = ['pg', 'kysely', 'embedded-postgres', '@types/pg'];
const CORE_MIGRATIONS = [
  '0001_browser_issuance.sql',
  '0002_roles.sql',
  '0003_pending_codes.sql',
  '0004_browser_proofs_security_events.sql',
  '0005_accounts.sql',
  '0006_session_authority_revocation.sql',
  '0007_applications_grants.sql',
  '0010_native_sign_in.sql',
  '0011_session_listing.sql',
  '0012_retention_indexes.sql',
  '0014_code_guess_locks.sql',
];
const MIGRATIONS = 'backend/src/common/persistence/postgres/migrations';

function everyFile(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_SCAN_DIRS.has(entry.name) ? [] : everyFile(root, full);
    return entry.isFile() ? [relative(root, full).split('\\').join('/')] : [];
  });
}

function json(project: string, path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(project, path), 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed;
}

function names(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function declaredPackages(project: string): string[] {
  const manifests = everyFile(project).filter((file) => /(?:^|\/)package\.json$/.test(file));
  return manifests.flatMap((file) => {
    const manifest = json(project, file);
    return [
      ...names(manifest.dependencies),
      ...names(manifest.devDependencies),
      ...names(manifest.optionalDependencies),
      ...names(manifest.peerDependencies),
    ];
  });
}

function markedFiles(project: string): string[] {
  return everyFile(project).filter((file) => {
    if (SKIPPED_SCAN_FILES.has(file.split('/').pop() ?? '')) return false;
    const content = readFileSync(join(project, file), 'utf8');
    return !content.includes('\u0000') && ANY_MARKER.test(content);
  });
}

function generate(packed: Packed, name: string, flags: string[], features?: string): string {
  const result = scaffold(packed, name, features, { flags });
  expect(result.status, `${String(result.stdout)}\n${String(result.stderr)}`).toBe(0);
  return join(packed.workspace, name);
}

/** The bytes of every file of a project. */
function contents(project: string): Record<string, string> {
  return Object.fromEntries(
    everyFile(project).map((file) => [file, readFileSync(join(project, file)).toString('base64')]),
  );
}

export function databaseCases(getPacked: () => Packed): void {
  it('leaves nothing of PostgreSQL in a MongoDB project', () => {
    const project = generate(getPacked(), 'database-mongodb', [], EVERY_FEATURE);
    const backend = json(project, 'backend/package.json');
    const workspace = readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8');

    expect({
      paths: everyFile(project).filter((file) => /postgres/i.test(file)),
      words: findForbiddenContent(project, POSTGRES_WORDS),
      packages: declaredPackages(project).filter((name) => POSTGRES_PACKAGES.includes(name)),
      scripts: names(backend.scripts).filter((name) => name.includes('postgres')),
      buildApprovals: workspace.includes('@embedded-postgres'),
      markers: markedFiles(project),
      database: json(project, ANSWERS_FILE_NAME).answers,
    }).toEqual({
      paths: [],
      words: [],
      packages: [],
      scripts: [],
      buildApprovals: false,
      markers: [],
      database: expect.objectContaining({ database: 'mongodb' }),
    });
  });

  it('leaves nothing of MongoDB in a PostgreSQL project but the failure shapes the filter reads', () => {
    const project = generate(
      getPacked(),
      'database-postgres',
      ['--database', 'postgres'],
      EVERY_FEATURE,
    );
    const backend = json(project, 'backend/package.json');
    const scripts = isRecord(backend.scripts) ? backend.scripts : {};
    const e2e = json(project, 'backend/test/jest-e2e.json');
    const compose = readFileSync(join(project, 'docker-compose.yml'), 'utf8');
    const example = readFileSync(join(project, 'backend/.env.example'), 'utf8');

    expect({
      paths: everyFile(project).filter((file) => /mongo(?!-errors\.ts$)/i.test(file)),
      words: findForbiddenLines(project, MONGO_WORDS),
      packages: declaredPackages(project).filter((name) => MONGO_PACKAGES.includes(name)),
      choiceWords: findForbiddenContent(project, [/DATABASE_TYPE/, /prototype\b.*postgres/i]),
      markers: markedFiles(project),
      database: json(project, ANSWERS_FILE_NAME).answers,
    }).toEqual({
      paths: [],
      words: MONGO_SURVIVING_LINES,
      packages: [],
      choiceWords: [],
      markers: [],
      database: expect.objectContaining({ database: 'postgres' }),
    });
    // The documented commands are the plain ones, on PostgreSQL.
    expect({
      scripts: Object.keys(scripts).filter((name) => /e2e|migration/.test(name)),
      e2e: scripts['test:e2e'],
      migrate: scripts['migration:up'],
      globalSetup: e2e.globalSetup,
      unitSetup: names(backend.jest).filter((key) => key.startsWith('global')),
      composeDatabase: [/^ {2}postgres:$/m.test(compose), /image: postgres:18$/m.test(compose)],
      migrateBeforeBackend: /migrate:\n\s+condition: service_completed_successfully/.test(compose),
      address: /^POSTGRES_URL=postgres:\/\//m.test(example),
    }).toEqual({
      scripts: ['test:e2e', 'migration:up', 'migration:status'],
      e2e: 'node ./test/run-jest.mjs --config ./test/jest-e2e.json --runInBand',
      migrate:
        'ts-node -r tsconfig-paths/register src/common/persistence/postgres/postgres-migrate.cli.ts up',
      globalSetup: '<rootDir>/postgres/e2e/postgres-global-setup.ts',
      unitSetup: [],
      composeDatabase: [true, true],
      migrateBeforeBackend: true,
      address: true,
    });
  });

  it('carries no table, migration or retention rule of a sign-in method a PostgreSQL project left out', () => {
    const project = generate(
      getPacked(),
      'database-postgres-minimal',
      ['--database', 'postgres'],
      'email-password',
    );
    const optionalTables = [
      /user_two_factor/,
      /user_recovery_codes/,
      /two_factor_challenges/,
      /passkey_challenges/,
      /pending_magic_links/,
      /['"`]passkeys['"`]|\bpasskeys: (?:true|PasskeysTable)/,
    ];

    expect({
      migrations: readdirSync(join(project, MIGRATIONS)).sort(),
      naming: findForbiddenContent(join(project, 'backend'), optionalTables).filter((file) =>
        /\/persistence\/postgres\/|^test\/postgres\//.test(file),
      ),
      searched: findForbiddenContent(join(project, 'backend'), [/\bsessions\b/]).some((file) =>
        /\/persistence\/postgres\//.test(file),
      ),
      harnesses: readdirSync(join(project, 'backend/test/postgres')).filter((file) =>
        /two-factor|passkeys|magic-link|linked-accounts/.test(file),
      ),
    }).toEqual({ migrations: CORE_MIGRATIONS, naming: [], searched: true, harnesses: [] });
  });

  it('carries every migration, in order, when a PostgreSQL project picks every method', () => {
    const project = generate(
      getPacked(),
      'database-postgres-migrations',
      ['--database', 'postgres'],
      EVERY_FEATURE,
    );

    expect(readdirSync(join(project, MIGRATIONS)).sort()).toEqual([
      ...CORE_MIGRATIONS.slice(0, 7),
      '0008_two_factor.sql',
      '0009_passkeys.sql',
      ...CORE_MIGRATIONS.slice(7, 10),
      '0013_magic_links.sql',
      ...CORE_MIGRATIONS.slice(10),
    ]);
  });

  it('builds the same project for a command line or a config file written before the choice', () => {
    const packed = getPacked();
    const config = join(packed.workspace, 'before-the-choice.json');
    writeFileSync(config, JSON.stringify({ targets: ['web'], features: ['email-password'] }));

    const named = generate(
      packed,
      'database-named/app',
      ['--database', 'mongodb'],
      'email-password',
    );
    const unnamed = generate(packed, 'database-unnamed/app', [], 'email-password');
    const fromFile = generate(packed, 'database-from-file/app', ['--config', config]);
    const expected = contents(named);
    const withoutFlag = contents(unnamed);
    const withFile = contents(fromFile);

    expect({
      files: Object.keys(expected).length > 500,
      unnamed: Object.keys(expected).filter((file) => withoutFlag[file] !== expected[file]),
      fromFile: Object.keys(expected).filter((file) => withFile[file] !== expected[file]),
      extra: [
        ...Object.keys(withoutFlag).filter((file) => !(file in expected)),
        ...Object.keys(withFile).filter((file) => !(file in expected)),
      ],
    }).toEqual({ files: true, unnamed: [], fromFile: [], extra: [] });
  });
}
