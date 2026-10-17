import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigFileError,
  parseAnswersConfig,
  parseConfigFile,
  readConfigFile,
} from '../../src/flags/config-file.js';
import { PLAN_MANIFEST } from '../support/plan-fixture.js';

const roots: string[] = [];
const SOURCE = { manifest: PLAN_MANIFEST, template: { sha256: 'a'.repeat(64), commit: null } };
const ANSWERS = {
  schemaVersion: 4,
  packageManager: 'pnpm@12.6.0',
  rules: { policy: 'strict' },
  installer: { name: 'create-authstack-starter', version: '0.1.0' },
  template: { sha256: 'a'.repeat(64), commit: null },
  answers: {
    targets: ['native-expo', 'web'],
    database: 'mongodb',
    features: ['email-password'],
    options: ['docker', 'production'],
    locales: ['en'],
    mobile: { name: 'Notes', slug: 'notes', appId: 'org.sample.notes', scheme: 'notes' },
  },
};

async function tempFile(content: string, name = 'config.json'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-config-'));
  roots.push(root);
  const path = join(root, name);
  await writeFile(path, content, 'utf8');
  return path;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('parseConfigFile', () => {
  it('reads every documented key', () => {
    expect(
      parseConfigFile({
        targets: ['native-expo'],
        database: 'postgres',
        features: ['email-password'],
        preset: 'minimal',
        docker: false,
        production: true,
        locales: ['en'],
      }),
    ).toEqual({
      targets: ['native-expo'],
      databases: ['postgres'],
      features: ['email-password'],
      preset: 'minimal',
      options: { docker: false, production: true },
      locales: ['en'],
    });
  });

  it('accepts a database written as a list', () => {
    expect(parseConfigFile({ database: ['mongodb', 'postgres'] }).databases).toEqual([
      'mongodb',
      'postgres',
    ]);
  });

  it('normalises ids and the preset the way flags do', () => {
    expect(parseConfigFile({ targets: ['WEB'], preset: 'Minimal', database: 'MONGOdb' })).toEqual({
      targets: ['web'],
      preset: 'minimal',
      databases: ['mongodb'],
    });
  });

  it('rejects an empty database string', () => {
    expect(() => parseConfigFile({ database: '' })).toThrow(/database must be a non-empty string/);
  });

  it('rejects an unknown key', () => {
    expect(() => parseConfigFile({ turbo: true })).toThrow(ConfigFileError);
    expect(() => parseConfigFile({ turbo: true })).toThrow(/unknown key "turbo"/);
  });

  it('rejects a wrong type', () => {
    expect(() => parseConfigFile({ targets: 'web' })).toThrow(/targets must be an array/);
    expect(() => parseConfigFile({ docker: 'yes' })).toThrow(/docker must be a boolean/);
    expect(() => parseConfigFile({ locales: ['fr'] })).toThrow(/locales must be one of/);
  });

  it('rejects a non-object', () => {
    expect(() => parseConfigFile(['web'])).toThrow(/must be a JSON object/);
  });
});

// Catches a replay that quietly drops what it does not understand, or runs under another pnpm.
describe('parseAnswersConfig refuses what a replay cannot honour', () => {
  it.each([
    [
      'an unknown nested key',
      {
        ...ANSWERS,
        answers: { ...ANSWERS.answers, mobile: { ...ANSWERS.answers.mobile, icon: 'x' } },
      },
      /unknown key "answers\.mobile\.icon"/,
    ],
    [
      'an unknown option',
      { ...ANSWERS, answers: { ...ANSWERS.answers, options: ['docker', 'turbo'] } },
      /got "turbo"/,
    ],
    [
      'another package manager',
      { ...ANSWERS, packageManager: 'pnpm@11.0.0' },
      /packageManager must be pnpm@12\.6\.0, got "pnpm@11\.0\.0"/,
    ],
  ])('stops on %s and names it', (_label, record, named) => {
    expect(() => parseAnswersConfig(ANSWERS, SOURCE)).not.toThrow();
    expect(() => parseAnswersConfig(record, SOURCE)).toThrow(ConfigFileError);
    expect(() => parseAnswersConfig(record, SOURCE)).toThrow(named);
  });
});

describe('readConfigFile', () => {
  it('reports a missing file', async () => {
    const missing = join(tmpdir(), 'cna-config-missing', 'config.json');
    await expect(readConfigFile(missing, SOURCE)).rejects.toThrow(/config file not found/);
  });

  it('reports invalid JSON', async () => {
    const path = await tempFile('{ not json');
    await expect(readConfigFile(path, SOURCE)).rejects.toThrow(/not valid JSON/);
  });

  it('parses the same content with and without a byte order mark', async () => {
    const content = JSON.stringify({ targets: ['web'] });
    const plain = await tempFile(content, 'plain.json');
    const bom = await tempFile(`\uFEFF${content}`, 'bom.json');

    await expect(readConfigFile(plain, SOURCE)).resolves.toEqual({ targets: ['web'] });
    await expect(readConfigFile(bom, SOURCE)).resolves.toEqual({ targets: ['web'] });
  });

  it('reports a directory instead of a raw EISDIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cna-config-dir-'));
    roots.push(root);
    await expect(readConfigFile(root, SOURCE)).rejects.toThrow(/directory, not a file/);
  });
});
