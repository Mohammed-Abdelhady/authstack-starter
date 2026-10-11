import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REWRITES_FILE, TEMPLATE_IDENTITY_FILE } from '../../src/constants/index.js';
import { buildTemplate } from '../support/sync-template-fixture.js';

const roots: string[] = [];
const REWRITES = '{"second":[{"files":["a.md"],"from":"one","to":"two"}]}';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Builds a template from a fixture that holds one file and, when given, the rewrites. */
function build(rewrites?: string, setup: (fixture: string) => void = () => undefined): string {
  return buildTemplate(roots, (fixture) => {
    writeFileSync(join(fixture, 'app.txt'), 'one\n');
    if (rewrites !== undefined) writeFileSync(join(fixture, REWRITES_FILE), rewrites);
    setup(fixture);
  });
}

function identityOf(template: string): unknown {
  const parsed: unknown = JSON.parse(
    readFileSync(join(dirname(template), TEMPLATE_IDENTITY_FILE), 'utf8'),
  );
  return (parsed as { sha256?: unknown }).sha256;
}

describe('the rewrites file in a build', () => {
  it('ships beside the manifest with the same bytes, and not inside the template', () => {
    const template = build(REWRITES);

    expect({
      shipped: readFileSync(join(dirname(template), REWRITES_FILE), 'utf8'),
      inTemplate: existsSync(join(template, REWRITES_FILE)),
    }).toEqual({ shipped: REWRITES, inTemplate: false });
  });

  it('is part of the identity: adding it or changing it gives another template', () => {
    const without = identityOf(build());
    const withFile = identityOf(build(REWRITES));
    const changed = identityOf(build(REWRITES.replace('two', 'three')));
    const again = identityOf(build(REWRITES));

    expect({
      distinct: new Set([without, withFile, changed]).size,
      stable: again === withFile,
    }).toEqual({ distinct: 3, stable: true });
  });

  it('takes away the copy an earlier build left when the repository has none', () => {
    const template = build(undefined, (fixture) => {
      const stale = join(fixture, 'packages/create-nest-next-auth', REWRITES_FILE);
      mkdirSync(dirname(stale), { recursive: true });
      writeFileSync(stale, REWRITES);
    });

    expect(existsSync(join(dirname(template), REWRITES_FILE))).toBe(false);
  });

  it('refuses rewrites that are not JSON', () => {
    expect(() => build('{ not json')).toThrow();
  });
});
