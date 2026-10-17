import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prune } from '../../src/prune/index.js';
import { listFiles } from '../../src/utils/fs.js';
import { createOptionFixtureTree, OPTION_MANIFEST } from '../support/option-fixture.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('prune options', () => {
  it('deletes only what the unselected options own', async () => {
    const root = await createOptionFixtureTree();
    roots.push(root);

    const result = await prune(root, OPTION_MANIFEST, ['email-password'], ['docker']);
    const files = await listFiles(root);

    expect(result.removedOptions).toEqual(['production', 'locale-ar']);
    expect(result.deletedFiles).toEqual([
      'docker-compose.prod.yml',
      'docs/operations/deployment.md',
      'frontend/src/i18n/messages/ar.json',
      'nginx/nginx.conf',
      'scripts/config-transforms-tests/config-transforms.test.mjs',
      'scripts/setup-production.js',
    ]);
    expect(files).toContain('docker-compose.yml');
    expect(files).toContain('backend/Dockerfile');
    expect(files).toContain('frontend/src/i18n/messages/en.json');
    expect(files).not.toContain('nginx/nginx.conf');
    expect(files).not.toContain('frontend/src/i18n/messages/ar.json');
  });

  it('strips the markers of the options that stay and drops the rest', async () => {
    const root = await createOptionFixtureTree();
    roots.push(root);

    await prune(root, OPTION_MANIFEST, ['email-password'], ['docker']);

    const registry = await readFile(join(root, 'src/registry.ts'), 'utf8');
    expect(registry).toBe('export const modules = [dockerModule];\n');
  });

  it('removes the root scripts an unselected option owns', async () => {
    const root = await createOptionFixtureTree();
    roots.push(root);

    await prune(root, OPTION_MANIFEST, ['email-password'], ['docker']);

    const parsed = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(parsed.scripts).toEqual({
      build: 'nest build',
      'docker:up': 'docker compose up -d',
      'test:config': 'node --test scripts/config-transforms-tests/config-transforms.ports.test.mjs',
    });
  });

  it('reports a leftover script in a workspace that runs a removed file', async () => {
    const root = await createOptionFixtureTree({
      'frontend/package.json': `${JSON.stringify(
        {
          name: 'frontend',
          scripts: { deploy: 'node scripts/setup-production.js' },
        },
        null,
        2,
      )}\n`,
    });
    roots.push(root);

    const result = await prune(root, OPTION_MANIFEST, ['email-password'], ['docker']);

    expect(result.dangling).toEqual([
      {
        file: 'frontend/package.json',
        line: 1,
        specifier: 'deploy',
        target: 'scripts/setup-production.js',
        script: 'deploy',
      },
    ]);
  });
});
