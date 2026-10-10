import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Only a persistence adapter folder of the backend may import a database
// driver. The backend's own lint configuration is read for each path below, so
// a rule that is loosened or scoped away from a folder fails here.
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const BACKEND = resolve(ROOT, 'backend');
const RULES = ['@typescript-eslint/no-restricted-imports', 'no-restricted-syntax'];
const MONGO_DRIVERS = ['mongoose', 'mongodb', '@nestjs/mongoose'];
const POSTGRES_DRIVERS = ['kysely', 'pg'];
const EVERY_DRIVER = [...MONGO_DRIVERS, ...POSTGRES_DRIVERS];

const SERVICE = 'src/auth/auth.service.ts';
const SPEC_OUTSIDE = 'src/auth/guards/auth.guard.spec.ts';
const MODULE = 'src/session/session.module.ts';
const MONGO_ADAPTER = 'src/session/persistence/mongo/mongo-browser-issuance.store.ts';
const MONGO_ADAPTER_SPEC = 'src/user/persistence/mongo/services/account-linking.service.spec.ts';
const MONGO_SCHEMA = 'src/user/persistence/mongo/schemas/user.schema.ts';
const POSTGRES_ADAPTER = 'src/session/persistence/postgres/postgres-browser-issuance.store.ts';
const TEST_SUPPORT = 'test/utils/session-authority-harness.ts';
const POSTGRES_TEST_SUPPORT = 'test/postgres/postgres-connection.ts';

let ESLint;
let tseslint;
let configured;
before(() => {
  const backendRequire = createRequire(resolve(BACKEND, 'package.json'));
  ({ ESLint } = backendRequire('eslint'));
  tseslint = backendRequire('typescript-eslint');
  configured = new ESLint({ cwd: BACKEND });
});

/** The driver rules the backend configures for this path, and nothing else. */
async function linterFor(file) {
  const config = await configured.calculateConfigForFile(resolve(BACKEND, file));
  const rules = Object.fromEntries(
    RULES.filter((rule) => config.rules?.[rule]).map((rule) => [rule, config.rules[rule]]),
  );
  return new ESLint({
    cwd: BACKEND,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser }, plugins: { '@typescript-eslint': tseslint.plugin } },
      { files: ['**/*.ts'], rules },
    ],
  });
}

/** The lines of `source` the backend's driver rules report at this path. */
async function reportedLines(file, source) {
  const linter = await linterFor(file);
  const [result] = await linter.lintText(source, { filePath: resolve(BACKEND, file) });
  assert.deepEqual(
    result.messages.filter(({ ruleId }) => !RULES.includes(ruleId)),
    [],
    'the fixture must parse and trip no other rule',
  );
  return result.messages.map(({ line }) => line).sort((a, b) => a - b);
}

const valueImport = (name) => `import { thing } from '${name}';\nvoid thing;\n`;

for (const driver of EVERY_DRIVER) {
  test(`a service, a module and a spec outside an adapter may not import ${driver}`, async () => {
    for (const file of [SERVICE, MODULE, SPEC_OUTSIDE]) {
      assert.deepEqual(await reportedLines(file, valueImport(driver)), [1], file);
    }
  });
}

test('every way of loading a driver is reported, type-only imports and subpaths included', async () => {
  const source = [
    "import type { Model } from 'mongoose';",
    "import { type Connection } from 'mongoose';",
    "import Default from 'mongodb';",
    "import * as everything from '@nestjs/mongoose';",
    "import 'kysely';",
    "import { ObjectId } from 'mongodb/lib/bson';",
    "import { CastError } from 'mongoose/lib/error';",
    "import { getModelToken } from '@nestjs/mongoose/dist/common';",
    "import { types } from 'pg/lib/defaults';",
    "export { Schema } from 'mongoose';",
    "export * from 'pg';",
    "import legacy = require('mongoose');",
    "const lazy = require('mongodb');",
    "const deep = require('kysely/helpers/postgres');",
    "export const later = () => import('pg');",
    "export const laterStill = () => import('@nestjs/mongoose/dist');",
    'void [Default, everything, ObjectId, CastError, getModelToken, types, legacy, lazy, deep];',
    'export type Kept = Model<unknown> | Connection;',
  ].join('\n');

  assert.deepEqual(
    await reportedLines(SERVICE, source),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  );
});

test('nothing but a driver is reported outside an adapter', async () => {
  const source = [
    "import { Injectable } from '@nestjs/common';",
    "import { UnitOfWork } from '../common/persistence/unit-of-work';",
    "import { MongoIdFormat } from '../common/persistence/mongo/mongo-id-format';",
    "import format from 'pg-format';",
    "import lean from 'mongoose-lean-virtuals';",
    "import { something } from '@nestjs/mongoose-extras';",
    "const tool = require('mongodb-memory-server');",
    "export const later = () => import('kysely-codegen');",
    "jest.mock('mongoose', () => {",
    "  throw new Error('mongoose was loaded above the seam');",
    '});',
    'void [Injectable, MongoIdFormat, format, lean, something, tool];',
    'export type Kept = UnitOfWork;',
  ].join('\n');

  assert.deepEqual(await reportedLines(SERVICE, source), []);
});

test('the MongoDB adapter imports its own drivers and no PostgreSQL one', async () => {
  for (const file of [MONGO_ADAPTER, MONGO_ADAPTER_SPEC, MONGO_SCHEMA]) {
    for (const driver of MONGO_DRIVERS) {
      assert.deepEqual(await reportedLines(file, valueImport(driver)), [], `${file} ${driver}`);
    }
    for (const driver of POSTGRES_DRIVERS) {
      assert.deepEqual(await reportedLines(file, valueImport(driver)), [1], `${file} ${driver}`);
    }
  }
});

test('a PostgreSQL adapter folder under src imports its own drivers and no MongoDB one', async () => {
  for (const driver of POSTGRES_DRIVERS) {
    assert.deepEqual(await reportedLines(POSTGRES_ADAPTER, valueImport(driver)), [], driver);
  }
  for (const driver of MONGO_DRIVERS) {
    assert.deepEqual(await reportedLines(POSTGRES_ADAPTER, valueImport(driver)), [1], driver);
  }
});

test('test support may hold MongoDB, and PostgreSQL only inside its test folder', async () => {
  for (const driver of MONGO_DRIVERS) {
    assert.deepEqual(await reportedLines(TEST_SUPPORT, valueImport(driver)), [], driver);
    assert.deepEqual(await reportedLines(POSTGRES_TEST_SUPPORT, valueImport(driver)), [], driver);
  }
  for (const driver of POSTGRES_DRIVERS) {
    assert.deepEqual(await reportedLines(TEST_SUPPORT, valueImport(driver)), [1], driver);
    assert.deepEqual(await reportedLines(POSTGRES_TEST_SUPPORT, valueImport(driver)), [], driver);
  }
});

test('the rules cannot be switched off from inside a file', async () => {
  const config = await configured.calculateConfigForFile(resolve(BACKEND, SERVICE));

  assert.equal(config.linterOptions?.noInlineConfig, true);
});
