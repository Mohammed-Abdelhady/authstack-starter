import { describe, expect, it } from 'vitest';
import { resolvePlan } from '../../src/manifest/plan.js';
import { validateManifest } from '../../src/manifest/validate.js';

describe('validateManifest version 2', () => {
  function manifest(overrides: Record<string, unknown> = {}): unknown {
    return {
      version: 2,
      targets: {
        web: { label: 'Web', default: true, files: [], workspaces: [], envFiles: [] },
      },
      shared: {},
      databases: {
        mongodb: { label: 'MongoDB', default: true, files: [], envVars: [] },
      },
      options: {},
      presets: {},
      features: {
        a: {
          label: 'A',
          description: 'A.',
          kind: 'oauth',
          default: false,
          files: [],
          envVars: [],
          requires: [],
          docs: [],
        },
      },
      core: { alwaysRemoveFiles: [] },
      ...overrides,
    };
  }

  it('rejects a preset that names a missing target', () => {
    expect(() =>
      validateManifest(
        manifest({ presets: { minimal: { targets: ['ghost'], features: [], options: [] } } }),
      ),
    ).toThrow(/presets\.minimal\.targets names "ghost"/);
  });

  it('rejects a feature limited to a missing target', () => {
    expect(() =>
      validateManifest(
        manifest({
          features: {
            a: {
              label: 'A',
              description: 'A.',
              kind: 'oauth',
              default: false,
              files: [],
              envVars: [],
              requires: [],
              docs: [],
              targets: ['ghost'],
            },
          },
        }),
      ),
    ).toThrow(/features\.a\.targets names "ghost"/);
  });

  it('rejects a non-boolean needsSignInSite', () => {
    expect(() =>
      validateManifest(
        manifest({
          targets: {
            web: {
              label: 'Web',
              default: true,
              files: [],
              workspaces: [],
              envFiles: [],
              needsSignInSite: 'yes',
            },
          },
        }),
      ),
    ).toThrow(/needsSignInSite must be a boolean/);
  });

  it('rejects two default databases and names both', () => {
    expect(() =>
      validateManifest(
        manifest({
          databases: {
            a: { label: 'A', default: true, files: [], envVars: [] },
            b: { label: 'B', default: true, files: [], envVars: [] },
          },
        }),
      ),
    ).toThrow(/exactly one available default, got "a", "b"/);
  });

  it('rejects a database default that is only planned', () => {
    expect(() =>
      validateManifest(
        manifest({
          databases: {
            a: { label: 'A', default: false, files: [], envVars: [] },
            b: {
              label: 'B',
              default: true,
              status: 'planned',
              files: [],
              envVars: [],
            },
          },
        }),
      ),
    ).toThrow(/exactly one available default, got none/);
  });

  it('rejects a manifest with no targets', () => {
    expect(() => validateManifest(manifest({ targets: {} }))).toThrow(
      /targets must define at least one available id/,
    );
  });

  it('rejects a manifest whose only targets are planned', () => {
    expect(() =>
      validateManifest(
        manifest({
          targets: {
            'native-x': { label: 'Native', default: true, status: 'planned' },
          },
        }),
      ),
    ).toThrow(/targets must define at least one available id/);
  });

  it('rejects a target default that is only available but not default', () => {
    expect(() =>
      validateManifest(
        manifest({
          targets: {
            web: { label: 'Web', default: false, files: [], workspaces: [], envFiles: [] },
          },
        }),
      ),
    ).toThrow(/targets must define at least one available default/);
  });

  it('rejects a manifest with no databases', () => {
    expect(() => validateManifest(manifest({ databases: {} }))).toThrow(
      /databases must define at least one available id/,
    );
  });

  it('rejects an id used by two dimensions and names it', () => {
    expect(() =>
      validateManifest(manifest({ shared: { web: { files: [], workspaces: [] } } })),
    ).toThrow(/id "web" is used by both targets and shared/);
  });

  it('rejects a planned database that lists files', () => {
    expect(() =>
      validateManifest(
        manifest({
          databases: {
            mongodb: {
              label: 'MongoDB',
              default: true,
              files: [],
              envVars: [],
            },
            later: { label: 'Later', default: false, status: 'planned', files: ['later/**'] },
          },
        }),
      ),
    ).toThrow(/databases\.later is planned and must not list files yet/);
  });

  it('rejects a non-string target description', () => {
    expect(() =>
      validateManifest(
        manifest({
          targets: {
            web: {
              label: 'Web',
              description: 5,
              default: true,
              files: [],
              workspaces: [],
              envFiles: [],
            },
          },
        }),
      ),
    ).toThrow(/targets\.web\.description must be a non-empty string/);
  });

  it('rejects an unknown preset key', () => {
    expect(() =>
      validateManifest(
        manifest({ presets: { minimal: { targets: [], features: [], options: [], extra: true } } }),
      ),
    ).toThrow(/presets\.minimal has unknown key "extra"/);
  });
});

describe('validateManifest version 1', () => {
  it('loads as web, mongodb and no options', () => {
    const manifest = validateManifest({
      features: {
        'email-password': {
          label: 'Email and password',
          description: 'Password sign-in.',
          kind: 'credential',
          default: true,
          files: [],
          envVars: [],
          requires: [],
          docs: [],
        },
      },
      core: { alwaysRemoveFiles: [] },
    });
    const plan = resolvePlan(manifest, {});

    expect(manifest.version).toBe(2);
    expect(plan.targets).toEqual(['web']);
    expect(plan.database).toEqual('mongodb');
    expect(plan.options).toEqual([]);
    expect(plan.features).toEqual(['email-password']);
  });
});
