import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../src/manifest/validate.js';

describe('what the manifest may say about a database', () => {
  const base = {
    version: 2,
    features: {},
    targets: { web: { label: 'Web', default: true } },
    databases: { first: { label: 'First', default: true } },
    core: { alwaysRemoveFiles: [] },
  };

  it('refuses a planned database that already owns something', () => {
    const planned = {
      ...base,
      databases: {
        ...base.databases,
        second: { label: 'Second', default: false, status: 'planned', packages: ['pg'] },
      },
    };

    expect(() => validateManifest(planned)).toThrow(
      'databases.second is planned and must not list files yet',
    );
  });

  it('refuses an id that is the marker for lines that only choose between databases', () => {
    const taken = {
      ...base,
      databases: { ...base.databases, 'database-choice': { label: 'Second', default: false } },
    };

    expect(() => validateManifest(taken)).toThrow(
      'id "database-choice" is used by both the database choice marker and databases',
    );
  });

  it('reads what a database owns and what it changes when chosen', () => {
    const manifest = validateManifest({
      ...base,
      databases: {
        ...base.databases,
        second: {
          label: 'Second',
          default: false,
          packages: ['pg'],
          scripts: ['migration:second:up'],
          jsonKeys: { 'backend/nest-cli.json': [['compilerOptions', 'assets']] },
          buildApprovals: ['embedded'],
          renames: { 'a.second.yml': 'a.yml' },
          scriptRenames: { 'migration:second:up': 'migration:up' },
          rewrites: [{ files: ['backend/package.json'], from: 'second:', to: '' }],
          envExamples: [{ path: 'backend/.env.example', lines: ['SECOND_URL=x'] }],
        },
      },
    });

    expect(manifest.databases.second).toEqual({
      label: 'Second',
      default: false,
      files: [],
      docs: [],
      envVars: [],
      packages: ['pg'],
      scripts: ['migration:second:up'],
      jsonKeys: { 'backend/nest-cli.json': [['compilerOptions', 'assets']] },
      buildApprovals: ['embedded'],
      renames: { 'a.second.yml': 'a.yml' },
      scriptRenames: { 'migration:second:up': 'migration:up' },
      rewrites: [{ files: ['backend/package.json'], from: 'second:', to: '' }],
      envExamples: [{ path: 'backend/.env.example', lines: ['SECOND_URL=x'] }],
      status: undefined,
    });
  });

  it.each([
    [
      'a rename that leaves the project',
      { renames: { 'a.yml': '../a.yml' } },
      /renames entry "a\.yml"/,
    ],
    ['a rewrite without a text', { rewrites: [{ files: ['a'], to: 'b' }] }, /rewrites\[0\]\.from/],
    [
      'a command renamed to something that is not a name',
      { scriptRenames: { 'a:second': 7 } },
      /scriptRenames\.a:second/,
    ],
    ['a key path that names no key', { jsonKeys: { 'a.json': [[]] } }, /must name a key/],
    [
      'an environment example without lines',
      { envExamples: [{ path: 'a' }] },
      /envExamples\[0\]\.lines/,
    ],
  ])('refuses %s', (_, owned, problem) => {
    const broken = {
      ...base,
      databases: { ...base.databases, second: { label: 'Second', default: false, ...owned } },
    };

    expect(() => validateManifest(broken)).toThrow(problem);
  });
});
