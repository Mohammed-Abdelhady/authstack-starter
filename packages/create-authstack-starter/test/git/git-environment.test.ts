import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from '../../src/utils/exec.js';
import { fixtureRoot, isolatedGit } from '../support/answers-helpers.js';

const roots: string[] = [];
const REPOSITORY_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REFERENCE_BACKEND',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
  'GIT_CONFIG_KEY_17',
  'GIT_CONFIG_VALUE_17',
];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('git child environment', () => {
  it.each(['caller-value', ''])(
    'removes repository overrides valued %j without changing its parent',
    async (value) => {
      const root = fixtureRoot(roots);
      const { overrides } = isolatedGit(root);
      for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
      for (const key of REPOSITORY_KEYS) vi.stubEnv(key, value);
      vi.stubEnv('GIT_AUTHOR_NAME', 'Installer User');
      vi.stubEnv('CNA_TEST_SENTINEL', 'preserved');
      const bin = join(root, 'bin');
      mkdirSync(bin);
      // A stand-in for the external git executable reports what it actually inherits.
      writeFileSync(
        join(bin, 'git'),
        `#!${process.execPath}\nconsole.log(JSON.stringify({
        keys: Object.keys(process.env).filter(key => ${JSON.stringify(REPOSITORY_KEYS)}.includes(key)),
        author: process.env.GIT_AUTHOR_NAME,
        sentinel: process.env.CNA_TEST_SENTINEL
      }));\n`,
        { mode: 0o755 },
      );
      vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH ?? ''}`);

      const result = await run('git', ['config', '--get', 'user.name'], root);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        keys: [],
        author: 'Installer User',
        sentinel: 'preserved',
      });
      for (const key of REPOSITORY_KEYS) expect.soft(process.env[key]).toBe(value);
    },
  );

  it('reports an unavailable git with its failure reason', async () => {
    const root = fixtureRoot(roots);
    const { overrides } = isolatedGit(root);
    for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
    vi.stubEnv('PATH', root);
    const result = await run('git', ['init', '--', root], root);
    expect(result.code).toBe(127);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
