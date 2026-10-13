import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

  it('leaves the docker scripts when docker stays', async () => {
    const root = await createOptionFixtureTree();
    roots.push(root);

    await prune(root, OPTION_MANIFEST, ['email-password'], ['docker', 'production', 'locale-ar']);

    const parsed = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(parsed.scripts['docker:up']).toBe('docker compose up -d');
    expect(parsed.scripts['setup:prod']).toBe('node scripts/setup-production.js');
  });

  it('drops the doc links of a removed option doc', async () => {
    const root = await createOptionFixtureTree();
    roots.push(root);

    const result = await prune(root, OPTION_MANIFEST, ['email-password'], ['docker']);

    const readme = await readFile(join(root, 'README.md'), 'utf8');
    expect(result.removedDocLines).toBe(1);
    expect(readme).not.toContain('deployment.md');
    // The docker section stays and its markers are gone.
    expect(readme).toContain('## Start with Docker');
    expect(readme).not.toContain('feature:');
  });

  it('formats the files it changed with the project prettier config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cna-format-'));
    roots.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, '.prettierrc'),
      JSON.stringify({
        singleQuote: true,
        trailingComma: 'all',
        tabWidth: 2,
        semi: true,
        printWidth: 100,
        arrowParens: 'always',
        endOfLine: 'auto',
      }),
    );
    await writeFile(
      join(root, 'src/registry.ts'),
      [
        'export const modules = [',
        '  passwordMethod, // feature:email-password',
        '];',
        'export const label = "hello";',
        '',
      ].join('\n'),
    );

    const result = await prune(root, OPTION_MANIFEST, ['email-password'], []);

    expect(result.formattedFiles).toContain('src/registry.ts');
    expect(await readFile(join(root, 'src/registry.ts'), 'utf8')).toBe(
      "export const modules = [passwordMethod];\nexport const label = 'hello';\n",
    );
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
