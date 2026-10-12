import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../../src/manifest/load.js';
import { resolvePlan } from '../../src/manifest/plan.js';
import { buildSummary, describePlanErrors } from '../../src/report/summary.js';
import { toPlanRequest } from '../../src/flags/request.js';
import type { CliOptions } from '../../src/types.js';
import { PLAN_MANIFEST } from '../support/plan-fixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

function cliOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    yes: false,
    install: true,
    git: true,
    dryRun: false,
    optionOverrides: {},
    ...overrides,
  };
}

describe('plan precedence', () => {
  it('a flag beats the config file', () => {
    const request = toPlanRequest(cliOptions({ targets: ['native-expo'] }), {
      targets: ['web'],
    });
    expect(request.targets).toEqual(['native-expo']);
    expect(resolvePlan(PLAN_MANIFEST, request).targets).toEqual(['native-expo']);
  });

  it('the config file beats the preset', () => {
    const request = toPlanRequest(cliOptions({ preset: 'minimal' }), {
      targets: ['native-expo'],
    });
    expect(resolvePlan(PLAN_MANIFEST, request).targets).toEqual(['native-expo']);
  });

  it('the preset beats the manifest default', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { preset: 'everything' });
    expect(plan.targets).toEqual(['web', 'native-expo', 'native-cli', 'webos-shell']);
  });

  it('the manifest default applies when nothing else does', () => {
    const manifest = { ...PLAN_MANIFEST, presets: {} };
    const plan = resolvePlan(manifest, {});
    expect(plan.targets).toEqual(['web']);
    expect(plan.database).toEqual('mongodb');
    expect(plan.features).toEqual(['email-password', 'google', 'oauth-core']);
  });

  it('locales turn the locale-ar option on and off', () => {
    const off = toPlanRequest(cliOptions({ preset: 'minimal', locales: ['en'] }));
    const on = toPlanRequest(cliOptions({ preset: 'minimal', locales: ['en', 'ar'] }));
    expect(resolvePlan(PLAN_MANIFEST, off).options).not.toContain('locale-ar');
    expect(resolvePlan(PLAN_MANIFEST, on).options).toContain('locale-ar');
  });

  it('requires English in a locale list', () => {
    expect(resolvePlan(PLAN_MANIFEST, { locales: ['ar'] }).errors).toContainEqual({
      id: 'locales',
      reason: 'locales',
    });
    expect(resolvePlan(PLAN_MANIFEST, { locales: [] }).errors).toContainEqual({
      id: 'locales',
      reason: 'locales',
    });
  });

  it('a flag beats the config file for an option', () => {
    const request = toPlanRequest(cliOptions({ optionOverrides: { docker: false } }), {
      options: { docker: true },
    });
    expect(request.options?.docker).toBe(false);
  });

  it('the config file beats the preset for an option', () => {
    const request = toPlanRequest(cliOptions({ preset: 'standard' }), {
      options: { production: false },
    });
    const plan = resolvePlan(PLAN_MANIFEST, request);
    expect(plan.options).not.toContain('production');
    expect(plan.options).toContain('docker');
  });
});

describe('option availability', () => {
  it('turns a locale off when the list drops Arabic', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const plan = resolvePlan(manifest, { locales: ['en'] });
    expect(plan.errors).toEqual([]);
    expect(plan.options).not.toContain('locale-ar');
  });

  it('turns Arabic on when the list includes it', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const plan = resolvePlan(manifest, { locales: ['en', 'ar'] });
    expect(plan.errors).toEqual([]);
    expect(plan.options).toContain('locale-ar');
  });

  it('reports production needing docker when docker is turned off', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const plan = resolvePlan(manifest, { options: { docker: false } });
    expect(plan.errors).toContainEqual({
      id: 'production',
      needed: 'docker',
      reason: 'option-conflict',
    });
  });

  it('turns docker and production off together', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const plan = resolvePlan(manifest, { options: { docker: false, production: false } });
    expect(plan.errors).toEqual([]);
    expect(plan.options).not.toContain('docker');
    expect(plan.options).not.toContain('production');
    expect(plan.options).toContain('locale-ar');
  });

  it('lets the minimal preset drop every option', async () => {
    const manifest = await loadManifest(REPO_ROOT);
    const plan = resolvePlan(manifest, { preset: 'minimal' });
    expect(plan.errors).toEqual([]);
    expect(plan.options).toEqual([]);
  });
});

describe('option requires conflicts', () => {
  it('reports a conflict when an explicit off breaks a requirement', () => {
    const plan = resolvePlan(PLAN_MANIFEST, {
      preset: 'minimal',
      options: { docker: false, production: true },
    });
    expect(plan.errors).toContainEqual({
      id: 'production',
      needed: 'docker',
      reason: 'option-conflict',
    });
  });
});

describe('planned options', () => {
  const withPlannedOptions = {
    ...PLAN_MANIFEST,
    options: {
      ...PLAN_MANIFEST.options,
      'planned-on': {
        label: 'Planned on',
        default: true,
        files: [],
        requires: [],
        docs: [],
        catalogueKeys: [],
        status: 'planned' as const,
      },
      'planned-off': {
        label: 'Planned off',
        default: false,
        files: [],
        requires: [],
        docs: [],
        catalogueKeys: [],
        status: 'planned' as const,
      },
    },
  };

  it('fixes a planned option at its default when a preset omits it', () => {
    const plan = resolvePlan(withPlannedOptions, { preset: 'minimal' });

    expect(plan.errors).toEqual([]);
    expect(plan.options).toContain('planned-on');
    expect(plan.options).not.toContain('planned-off');
  });

  it('rejects turning a planned-on option off', () => {
    const plan = resolvePlan(withPlannedOptions, { options: { 'planned-on': false } });

    expect(plan.errors).toContainEqual({ id: 'planned-on', reason: 'planned' });
  });

  it('rejects turning a planned-off option on', () => {
    const plan = resolvePlan(withPlannedOptions, { options: { 'planned-off': true } });

    expect(plan.errors).toContainEqual({ id: 'planned-off', reason: 'planned' });
  });

  it('explains both planned-option directions with its label', () => {
    expect(
      describePlanErrors(withPlannedOptions, [{ id: 'planned-on', reason: 'planned' }]),
    ).toEqual([
      'Turning off "Planned on" is not available yet. Every project includes this for now.',
    ]);
    expect(
      describePlanErrors(withPlannedOptions, [{ id: 'planned-off', reason: 'planned' }]),
    ).toEqual(['Turning on "Planned off" is not available yet. Every project omits this for now.']);
  });
});

describe('plan messages', () => {
  it('gives a requested feature its own conflict wording', () => {
    const plan = resolvePlan(PLAN_MANIFEST, {
      targets: ['native-expo'],
      features: ['web-widget-user'],
    });
    expect(describePlanErrors(PLAN_MANIFEST, plan.errors)).toEqual([
      '"web-widget-user" needs "web-only", which the selected clients do not support.',
    ]);
  });

  it('gives the database conflict its own wording', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { databases: ['mongodb', 'postgres'] });
    expect(describePlanErrors(PLAN_MANIFEST, plan.errors)).toEqual([
      'Choose exactly one database; got: mongodb,postgres.',
    ]);
  });

  it('reads a removal with labels and a reason', () => {
    const plan = resolvePlan(PLAN_MANIFEST, { preset: 'everything', targets: ['native-expo'] });
    const summary = buildSummary(PLAN_MANIFEST, plan);
    expect(summary).toContain('Removed    Web only widget, only available for Web app (Next.js)');
    expect(
      summary.some((line) =>
        line.includes(
          'Removed    Web widget user, needs Web only widget, which is not available for the selected clients',
        ),
      ),
    ).toBe(true);
  });
});
