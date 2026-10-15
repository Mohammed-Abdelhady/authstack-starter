import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answersRecord,
  parseAnswersRecord,
  readAnswersRecord,
  recordAnswers,
} from '../../src/scaffold/answers.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { PLAN_MANIFEST } from '../support/plan-fixture.js';
const INSTALLER = { name: 'create-authstack-starter', version: '0.1.0' };
const TEMPLATE = {
  sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  commit: null,
};
const LEGACY = {
  schemaVersion: 2,
  packageManager: 'pnpm@12.6.0',
  installer: INSTALLER,
  template: { sha256: TEMPLATE.sha256 },
  answers: { targets: ['web'], database: 'mongodb', features: [], options: [], locales: ['en'] },
};
const PREVIOUS = { ...LEGACY, schemaVersion: 3, rules: { policy: 'standard' } };
describe('rules answers contract', () => {
  it.each(['strict', 'standard'] as const)(
    'records and reads %s across the filesystem handoff',
    async (rules) => {
      const target = await mkdtemp(join(tmpdir(), 'rules-answers-'));
      try {
        await recordAnswers(
          target,
          answersRecord(INSTALLER, TEMPLATE, resolvePlan(PLAN_MANIFEST, { rules })),
        );
        const record = await readAnswersRecord(target);
        expect(record.schemaVersion).toBe(4);
        expect(record.rules).toEqual({ policy: rules });
      } finally {
        await rm(target, { recursive: true, force: true });
      }
    },
  );
  it('reads the old schema without rules as strict', () => {
    expect(parseAnswersRecord(LEGACY)).toEqual({
      schemaVersion: 4,
      packageManager: 'pnpm@12.6.0',
      rules: { policy: 'strict' },
      installer: { name: 'create-authstack-starter', version: '0.1.0' },
      template: {
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        commit: null,
      },
      answers: {
        targets: ['web'],
        database: 'mongodb',
        features: [],
        options: [],
        locales: ['en'],
      },
    });
  });
  it('reads the previous schema with no commit and no mobile identity', () => {
    expect(parseAnswersRecord(PREVIOUS)).toEqual({
      schemaVersion: 4,
      packageManager: 'pnpm@12.6.0',
      rules: { policy: 'standard' },
      installer: { name: 'create-authstack-starter', version: '0.1.0' },
      template: {
        sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        commit: null,
      },
      answers: {
        targets: ['web'],
        database: 'mongodb',
        features: [],
        options: [],
        locales: ['en'],
      },
    });
  });
  it.each([
    null,
    { ...LEGACY, schemaVersion: 1 },
    { ...LEGACY, schemaVersion: 4 },
    { ...LEGACY, schemaVersion: 3 },
    { ...LEGACY, schemaVersion: 3, rules: { policy: 'loose' } },
    { ...PREVIOUS, schemaVersion: 4 },
    { ...PREVIOUS, schemaVersion: 4, template: { ...TEMPLATE, commit: 'bad' } },
    { ...LEGACY, answers: { ...LEGACY.answers, targets: null } },
    { ...LEGACY, template: { sha256: 'bad' } },
  ])('rejects malformed or unsupported records %j', (record) => {
    expect(() => parseAnswersRecord(record)).toThrow();
  });
});
