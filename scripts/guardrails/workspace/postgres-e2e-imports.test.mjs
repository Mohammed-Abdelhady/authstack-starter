import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The API suite on PostgreSQL loads no MongoDB test code. The walk starts at
// every file the PostgreSQL Jest configuration matches or names, follows the
// test code those files import, and reports a MongoDB driver or adapter import.
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const BACKEND = resolve(ROOT, 'backend');
const TEST_ROOT = resolve(BACKEND, 'test');
const CONFIG_FILE = resolve(TEST_ROOT, 'jest-e2e-postgres.json');

const MONGO_PACKAGES = ['mongoose', 'mongodb', '@nestjs/mongoose', 'mongodb-memory-server'];
const MONGO_ADAPTER_FOLDER = '/persistence/mongo/';
const MONGO_E2E_FILE = /^e2e-mongo-/;
/** The one file that names the MongoDB storage, as the default of a run that names none. */
const STORAGE_SELECTION = 'test/utils/e2e-storage.ts';
/** Test support that lives beside the product code. Other files under `src` are the product. */
const SOURCE_TEST_SUPPORT = /(?:\.harness-spec\.ts|\/testing\/[^/]+\.ts)$/;
const SOURCE_FOLDER = 'src/';
const RESOLVED_ENDINGS = ['', '.ts', '.mts', '.js', '.mjs', '.json', '/index.ts'];
/**
 * Imports the rule lets through, each with the reason. An entry no file needs
 * any more fails the last test below.
 */
const ALLOWED = [
  {
    file: 'test/postgres/e2e/storage-choice.e2e-spec.ts',
    imports: ['mongoose', '@nestjs/mongoose'],
    why: 'the case proves a server on PostgreSQL opens no MongoDB connection, by watching the driver',
  },
];

const FROM_CLAUSE = /\b(?:import|export)\s+(?!type\b)[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT = /\bimport\s*['"]([^'"]+)['"]/g;
const CALLED_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Every module a file loads when it runs. A statement that is `import type` loads nothing. */
export function loadedModules(source) {
  const found = [];
  for (const pattern of [FROM_CLAUSE, BARE_IMPORT, CALLED_IMPORT]) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

function isMongoPackage(specifier) {
  return MONGO_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function resolveFile(from, specifier, exists) {
  const base = resolve(dirname(from), specifier);
  for (const ending of RESOLVED_ENDINGS) {
    if (exists(base + ending)) return base + ending;
  }
  return undefined;
}

function isAllowed(file, specifier, allowed) {
  return allowed.some((entry) => entry.file === file && entry.imports.includes(specifier));
}

/**
 * Walks from `entries` and answers `{ file, imports, through }` for each
 * MongoDB import found. `read` answers a file's text, `exists` whether a path
 * is a file, both by absolute path, so the rule runs on a made-up tree too.
 */
export function mongoImportsReachedFrom(entries, { backend, read, exists, allowed = [] }) {
  const problems = [];
  const used = new Set();
  const seen = new Set();
  const queue = entries.map((file) => ({ file, through: [] }));
  const name = (file) => relative(backend, file).split(sep).join('/');
  while (queue.length > 0) {
    const { file, through } = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const here = name(file);
    const report = (specifier) => {
      if (isAllowed(here, specifier, allowed)) {
        used.add(`${here} ${specifier}`);
      } else {
        problems.push({ file: here, imports: specifier, through });
      }
    };
    for (const specifier of loadedModules(read(file))) {
      if (!specifier.startsWith('.')) {
        if (isMongoPackage(specifier)) report(specifier);
        continue;
      }
      const target = resolveFile(file, specifier, exists);
      if (target === undefined) continue;
      const there = name(target);
      if (`/${there}`.includes(MONGO_ADAPTER_FOLDER)) {
        report(there);
      } else if (MONGO_E2E_FILE.test(basename(target))) {
        if (here !== STORAGE_SELECTION) report(there);
      } else if (!there.startsWith(SOURCE_FOLDER) || SOURCE_TEST_SUPPORT.test(there)) {
        queue.push({ file: target, through: [...through, here] });
      }
    }
  }
  const unused = allowed.flatMap((entry) =>
    entry.imports.filter((specifier) => !used.has(`${entry.file} ${specifier}`))
      .map((specifier) => `${entry.file} ${specifier}`));
  return { problems, unused, walked: [...seen].map(name).sort() };
}

function filesUnder(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesUnder(path);
    return [path];
  });
}

/** What the PostgreSQL configuration runs: the suites it matches and the files it names. */
export function postgresRunEntries() {
  const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  const inRoot = (pattern) => pattern.replace('<rootDir>', TEST_ROOT);
  const matched = new RegExp(config.testRegex);
  const ignored = config.testPathIgnorePatterns.map((pattern) => new RegExp(inRoot(pattern)));
  const suites = filesUnder(TEST_ROOT).filter(
    (file) => matched.test(file) && !ignored.some((pattern) => pattern.test(file)),
  );
  const named = [config.globalSetup, config.globalTeardown, ...config.setupFiles].map(inRoot);
  return { suites, named };
}

const onDisk = {
  backend: BACKEND,
  read: (file) => readFileSync(file, 'utf8'),
  exists: (file) => existsSync(file) && statSync(file).isFile(),
};

/** A made-up backend: paths relative to it, each with its text. */
function madeUp(files) {
  const backend = resolve('/made-up/backend');
  const at = (file) => resolve(backend, file);
  const tree = new Map(Object.entries(files).map(([file, text]) => [at(file), text]));
  return {
    entries: [at('test/a.e2e-spec.ts')],
    tree: { backend, read: (file) => tree.get(file), exists: (file) => tree.has(file) },
  };
}

function problemsIn(files, allowed) {
  const { entries, tree } = madeUp(files);
  return mongoImportsReachedFrom(entries, { ...tree, allowed }).problems.map(
    ({ file, imports }) => `${file} -> ${imports}`,
  );
}

test('a suite that loads a driver or an adapter file is reported, however it loads it', () => {
  assert.deepEqual(
    problemsIn({
      'test/a.e2e-spec.ts': [
        "import { Model } from 'mongoose';",
        "import {\n  getModelToken,\n} from '@nestjs/mongoose';",
        "import 'mongodb';",
        "const later = () => import('mongodb-memory-server');",
        "const lazy = require('mongoose/lib/error');",
        "export { User } from '../src/user/persistence/mongo/schemas/user.schema';",
        "import { mongoAuthState } from './utils/e2e-mongo-state-auth';",
      ].join('\n'),
      'src/user/persistence/mongo/schemas/user.schema.ts': '',
      'test/utils/e2e-mongo-state-auth.ts': '',
    }),
    [
      'test/a.e2e-spec.ts -> mongoose',
      'test/a.e2e-spec.ts -> @nestjs/mongoose',
      'test/a.e2e-spec.ts -> src/user/persistence/mongo/schemas/user.schema.ts',
      'test/a.e2e-spec.ts -> test/utils/e2e-mongo-state-auth.ts',
      'test/a.e2e-spec.ts -> mongodb',
      'test/a.e2e-spec.ts -> mongodb-memory-server',
      'test/a.e2e-spec.ts -> mongoose/lib/error',
    ],
  );
});

test('a driver behind a helper, and behind test support under src, is reported at the file that loads it', () => {
  assert.deepEqual(
    problemsIn({
      'test/a.e2e-spec.ts':
        "import { BOOT } from './utils/harness';\nimport { ID } from '../src/native/harness/ids.harness-spec';",
      'test/utils/harness.ts': "import { deep } from './deeper';",
      'test/utils/deeper.ts': "import mongoose from 'mongoose';",
      'src/native/harness/ids.harness-spec.ts': "import { Types } from 'mongoose';",
    }),
    ['src/native/harness/ids.harness-spec.ts -> mongoose', 'test/utils/deeper.ts -> mongoose'],
  );
});

test('what loads nothing, and what the product loads for itself, is not reported', () => {
  assert.deepEqual(
    problemsIn({
      'test/a.e2e-spec.ts': [
        "import type { Model } from 'mongoose';",
        "import type {\n  UserDocument,\n} from '../src/user/persistence/mongo/schemas/user.schema';",
        "import { AppModule } from '../src/app.module';",
        "import { startE2eStorage } from './utils/e2e-storage';",
        "import format from 'mongoose-lean-virtuals';",
      ].join('\n'),
      'src/app.module.ts': "import { MongooseModule } from '@nestjs/mongoose';",
      'src/user/persistence/mongo/schemas/user.schema.ts': "import { Schema } from 'mongoose';",
      'test/utils/e2e-storage.ts': "import { startMongoE2eStorage } from './e2e-mongo-storage';",
      'test/utils/e2e-mongo-storage.ts': "import mongoose from 'mongoose';",
    }),
    [],
  );
});

test('an allowed import is let through for its own file only', () => {
  const files = {
    'test/a.e2e-spec.ts': "import mongoose from 'mongoose';\nimport './b';",
    'test/b.ts': "import mongoose from 'mongoose';",
  };
  const allowed = [{ file: 'test/a.e2e-spec.ts', imports: ['mongoose'], why: 'a made-up reason' }];

  assert.deepEqual(problemsIn(files, allowed), ['test/b.ts -> mongoose']);
});

test('the PostgreSQL configuration leaves out the MongoDB-only suites by their name alone', () => {
  const { suites, named } = postgresRunEntries();
  const names = suites.map((file) => relative(TEST_ROOT, file).split(sep).join('/'));

  assert.equal(named.length, 4);
  assert.ok(names.includes('auth/activation-contract.e2e-spec.ts'));
  assert.ok(names.includes('postgres/e2e/storage-choice.e2e-spec.ts'));
  assert.deepEqual(names.filter((file) => /\.mongo\.e2e-spec\.ts$/.test(file)), []);
  assert.deepEqual(
    filesUnder(TEST_ROOT)
      .map((file) => relative(TEST_ROOT, file).split(sep).join('/'))
      .filter((file) => file.endsWith('.e2e-spec.ts') && !names.includes(file))
      .sort(),
    [
      'app/app.startup-indexes.mongo.e2e-spec.ts',
      'auth/activation-contract-legacy.mongo.e2e-spec.ts',
      'auth/registration-limits-legacy.mongo.e2e-spec.ts',
      'migrations/mail-counter-expiry.mongo.e2e-spec.ts',
      'migrations/registration-binding.mongo.e2e-spec.ts',
      'migrations/rollback-ownership.mongo.e2e-spec.ts',
    ],
  );
});

test('no file of the PostgreSQL API run loads MongoDB test code', () => {
  const { suites, named } = postgresRunEntries();
  const { problems, unused, walked } = mongoImportsReachedFrom([...named, ...suites], {
    ...onDisk,
    allowed: ALLOWED,
  });

  assert.deepEqual(
    problems.map(({ file, imports, through }) => `${file} -> ${imports} (reached through ${through.join(' -> ') || 'the configuration'})`),
    [],
  );
  assert.deepEqual(unused, [], 'an allowed import nothing needs any more');
  assert.ok(walked.includes('test/utils/e2e-app.ts'), 'the walk reached the shared fixture');
  assert.ok(walked.includes('test/postgres/e2e/e2e-postgres-storage.ts'));
});
