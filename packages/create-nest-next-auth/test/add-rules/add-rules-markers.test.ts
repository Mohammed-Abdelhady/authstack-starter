import { afterEach, describe, expect, it } from 'vitest';
import { planRules } from '../../src/add-rules/plan.js';
import { MarkerError, withoutMarkerComments } from '../../src/prune/markers.js';
import { cleanRulesFixtures, rulesFixture, TRUSTED_RULES_ROOT } from './add-rules-fixture.js';

afterEach(cleanRulesFixtures);

describe('withoutMarkerComments', () => {
  it('keeps every marked line and takes the marker comments off', () => {
    const source = [
      'export const SKIPPED = [',
      "  'mobile/expo/ios/', // feature:native-expo",
      '  // feature:native-core:start',
      "  'mobile/auth/',",
      '  // feature:native-core:end',
      "  '.husky/_/',",
      '];',
      '',
    ].join('\n');

    expect(withoutMarkerComments(source, 'policy.mjs')).toBe(
      [
        'export const SKIPPED = [',
        "  'mobile/expo/ios/',",
        "  'mobile/auth/',",
        "  '.husky/_/',",
        '];',
        '',
      ].join('\n'),
    );
  });

  it('returns a file with no marker as it is', () => {
    expect(withoutMarkerComments('export const a = 1;\n', 'a.mjs')).toBe('export const a = 1;\n');
  });

  it('refuses a marker that names nothing', () => {
    expect(() => withoutMarkerComments('const a = 1; // feature::start\n', 'a.mjs')).toThrow(
      MarkerError,
    );
  });
});

describe('the scanner files another project receives', () => {
  it('carry the policy without a marker comment and with every folder family', async () => {
    const root = await rulesFixture();
    const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
    const marked = plan.files.filter(({ content }) => /(?:\/\/|<!--)\s*feature:/.test(content));
    const policy = plan.files.find(({ path }) => path === 'scripts/guardrails/policy.mjs');

    expect(marked.map(({ path }) => path)).toEqual([]);
    expect(policy?.content).toContain("'mobile/expo/ios/',");
    expect(policy?.content).toContain("'mobile\\\\/[^/]+\\\\/(src|app|test|conformance)',");
  });
});
