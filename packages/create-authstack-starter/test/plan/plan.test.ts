import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SIGN_IN_SITE_ID } from '../../src/constants/index.js';
import { loadManifest } from '../../src/manifest/load.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { PLAN_MANIFEST } from '../support/plan-fixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

describe('resolvePlan rules', () => {
  it('rule 1: an empty target list is an error', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { targets: [] });
    expect(plan.errors).toEqual([{ id: 'targets', reason: 'empty' }]);
  });

  it('rule 2: a native target without web keeps the sign-in pages', () => {
    const plan = resolvePlan(PLAN_MANIFEST, {
      targets: ['native-expo'],
      features: ['email-password'],
    });
    expect(plan.signInSite).toBe('kept-for-native');
    expect(plan.added).toContainEqual({ id: SIGN_IN_SITE_ID, because: 'native-expo' });
  });

  it('rule 2: web keeps the full sign-in site with no addition', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { targets: ['web'], features: ['email-password'] });
    expect(plan.signInSite).toBe('full');
    expect(plan.added).toEqual([]);
  });

  it('rule 2: a shell that does not need the site leaves it out', () => {
    const plan = resolvePlan(PLAN_MANIFEST, {
      targets: ['webos-shell'],
      features: ['email-password'],
    });
    expect(plan.signInSite).toBe('none');
  });

  it('rule 3: expands target requires, then the sign-in site, in order', () => {
    const plan = resolvePlan(PLAN_MANIFEST, {
      targets: ['native-cli'],
      features: ['email-password'],
    });
    expect(plan.shared).toEqual(['native-core']);
    expect(plan.added).toEqual([
      { id: 'native-core', because: 'native-cli' },
      { id: SIGN_IN_SITE_ID, because: 'native-cli' },
    ]);
  });

  it('rule 3: expands feature requires with the requirer named', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { features: ['google'] });
    expect(plan.features).toEqual(['google', 'oauth-core']);
    expect(plan.added).toEqual([{ id: 'oauth-core', because: 'google' }]);
  });

  it('rule 3: expands option requires with the requirer named', () => {
    const plan = resolvePlan(PLAN_MANIFEST, {
      preset: 'minimal',
      options: { production: true },
    });
    expect(plan.options).toEqual(['docker', 'production']);
    expect(plan.added).toEqual([{ id: 'docker', because: 'production' }]);
  });

  it('rule 4: a planned id from a flag is an error that names it', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const plan = resolvePlan(manifest, { targets: ['native-cli'] });
    expect(plan.errors).toContainEqual({ id: 'native-cli', reason: 'planned' });
  });

  it('rule 4: an unknown id is an error that names it', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { targets: ['ghost'] });
    expect(plan.errors).toContainEqual({ id: 'ghost', reason: 'unknown' });
  });

  it('rule 5: exactly one database is kept', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { databases: ['postgres'] });
    expect(plan.database).toBe('postgres');
    expect(plan.errors).toEqual([]);
  });

  it('rule 5: a planned database is an error that names it, and nothing is added on top', () => {
    const manifest = {
      ...PLAN_MANIFEST,
      databases: {
        ...PLAN_MANIFEST.databases,
        postgres: { ...PLAN_MANIFEST.databases.postgres, status: 'planned' as const },
      },
    };

    const plan = resolvePlan(manifest, { databases: ['postgres'] });

    expect({ database: plan.database, errors: plan.errors }).toEqual({
      database: '',
      errors: [{ id: 'postgres', reason: 'planned' }],
    });
  });

  it('rule 5: an empty database list is an error', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { databases: [] });
    expect(plan.errors).toEqual([{ id: 'database', reason: 'empty' }]);
  });

  it('rule 5: two databases is a conflict', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { databases: ['mongodb', 'postgres'] });
    expect(plan.errors).toContainEqual({ id: 'mongodb,postgres', reason: 'database-conflict' });
  });

  it('rule 6: a target-limited feature is dropped and reported', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { preset: 'everything', targets: ['native-expo'] });
    expect(plan.features).not.toContain('web-only');
    expect(plan.removed).toContainEqual({ id: 'web-only', reason: 'targets', because: 'web' });
    expect(plan.errors).toEqual([]);
  });

  it('rule 6: an explicit target-limited feature is a conflict', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { targets: ['native-expo'], features: ['web-only'] });
    expect(plan.features).not.toContain('web-only');
    expect(plan.errors).toContainEqual({ id: 'web-only', reason: 'feature-conflict' });
  });

  it('cascades a target-limited removal to its dependents without a self reason', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { preset: 'everything', targets: ['native-expo'] });
    expect(plan.features).not.toContain('web-widget-user');
    expect(plan.removed).toContainEqual({
      id: 'web-widget-user',
      reason: 'needs',
      because: 'web-only',
    });
    for (const entry of plan.added) {
      expect(entry.id, `${entry.id} was reported as its own reason`).not.toBe(entry.because);
    }
  });

  it('names the dropped requirement when a requested feature is a dependent', () => {
    const plan = resolvePlan(PLAN_MANIFEST, {
      targets: ['native-expo'],
      features: ['web-widget-user'],
    });
    expect(plan.errors).toContainEqual({
      id: 'web-widget-user',
      needed: 'web-only',
      reason: 'feature-conflict',
    });
  });

  it('drops an orphaned requirement instead of adding it with no provider', () => {
    const plan = resolvePlan(PLAN_MANIFEST, {
      targets: ['webos-shell'],
      features: ['web-provider'],
    });
    expect(plan.features).toEqual([]);
    expect(plan.added).toEqual([]);
    expect(plan.removed).toContainEqual({ id: 'web-provider', reason: 'targets', because: 'web' });
  });

  it('rule 7: the order ids are requested in does not change the plan', () => {
    const first = resolvePlan(PLAN_MANIFEST, {
      targets: ['web', 'native-expo'],
      features: ['google', 'email-password'],
    });
    const second = resolvePlan(PLAN_MANIFEST, {
      targets: ['native-expo', 'web'],
      features: ['email-password', 'google'],
    });
    expect(first).toEqual(second);
    expect(first.features).toEqual(['email-password', 'google', 'oauth-core']);
  });
});
