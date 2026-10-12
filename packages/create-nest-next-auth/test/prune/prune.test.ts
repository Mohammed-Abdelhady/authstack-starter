import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { stripEnvVars } from '../../src/prune/env.js';
import { prune } from '../../src/prune/index.js';
import { findDanglingReferences } from '../../src/prune/references.js';
import { listFiles } from '../../src/utils/fs.js';
import { createFixtureTree, FIXTURE_MANIFEST } from '../support/fixture.js';

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await createFixtureTree();
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function writeSource(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, 'utf8');
}

/** A project with one manifest per shared package, each declaring the given exports. */
async function sharedFixture(packages: Record<string, Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-shared-'));
  roots.push(root);
  for (const [name, exported] of Object.entries(packages)) {
    const manifest = { name: `@app/${name}`, exports: exported };
    await writeSource(root, `shared/${name}/package.json`, `${JSON.stringify(manifest)}\n`);
  }
  return root;
}

describe('prune', () => {
  it('deletes only what the unselected features own', async () => {
    const root = await fixture();
    const result = await prune(root, FIXTURE_MANIFEST, ['email-password', 'alpha'], []);
    const files = await listFiles(root);

    expect(result.deletedFiles).toEqual([
      'docs/setup-beta.md',
      'src/strategies/beta-oauth.strategy.ts',
      'tooling/internal.md',
    ]);
    expect(files).toContain('src/strategies/alpha-oauth.strategy.ts');
    expect(files).toContain('src/strategies/alpha-oauth.strategy.spec.ts');
    expect(files).toContain('docs/setup-alpha.md');
    expect(files).toContain('docs/setup/setup-smtp.md');
    expect(files).not.toContain('src/strategies/beta-oauth.strategy.ts');
    expect(files).not.toContain('tooling/internal.md');
    expect(result.dangling).toEqual([]);
  });

  it('strips the env lines of removed features and keeps shared ones', async () => {
    const root = await fixture();
    const result = await prune(root, FIXTURE_MANIFEST, ['email-password', 'alpha'], []);

    const backend = await readFile(join(root, 'backend/.env.example'), 'utf8');
    const docker = await readFile(join(root, '.env.docker.example'), 'utf8');

    expect(result.strippedEnvVars).toEqual(['OAUTH_BETA_CLIENT_ID']);
    expect(backend).not.toContain('OAUTH_BETA_CLIENT_ID');
    expect(backend).not.toContain('# Beta OAuth');
    expect(backend).toContain('# OAUTH_ALPHA_CLIENT_ID=alpha-id');
    expect(backend).toContain('SHARED_KEY=shared');
    expect(backend).toContain('SWAGGER_ENABLED=false');
    expect(docker).not.toContain('OAUTH_BETA_CLIENT_ID');
    expect(docker).toContain('NEXT_PUBLIC_API_URL=http://localhost:5000');
  });

  it('keeps a shared var when only one of its owners is removed', async () => {
    const root = await fixture();
    await prune(root, FIXTURE_MANIFEST, ['email-password'], []);
    const backend = await readFile(join(root, 'backend/.env.example'), 'utf8');

    expect(backend).toContain('SHARED_KEY=shared');
    expect(backend).not.toContain('OAUTH_ALPHA_CLIENT_ID');
  });

  it('records the enabled features in the backend env example', async () => {
    const root = await fixture();
    await prune(root, FIXTURE_MANIFEST, ['email-password', 'alpha'], []);
    const backend = await readFile(join(root, 'backend/.env.example'), 'utf8');

    expect(backend).toContain('AUTH_FEATURES=email-password,alpha');
    expect(backend.match(/AUTH_FEATURES=/g)).toHaveLength(1);
  });

  it('removes doc links from lists and tables, and leaves the rest', async () => {
    const root = await fixture();
    const result = await prune(root, FIXTURE_MANIFEST, ['email-password', 'alpha'], []);

    const docsIndex = await readFile(join(root, 'docs/README.md'), 'utf8');
    const readme = await readFile(join(root, 'README.md'), 'utf8');

    expect(result.removedDocLines).toBe(2);
    expect(docsIndex).not.toContain('setup-beta.md');
    expect(docsIndex).toContain('setup-alpha.md');
    expect(readme).not.toContain('docs/setup-beta.md');
    expect(readme).toContain('| Guide');
  });

  it('renders and formats the pruned workspace while retaining pnpm settings', async () => {
    const root = await fixture();
    await writeSource(
      root,
      'pnpm-workspace.yaml',
      "packages: [backend, mobile/*]\noverrides: {diff: '>=8.0.3'}\nallowBuilds: {bcrypt: true}\nenablePrePostScripts: true\n",
    );
    await writeSource(root, 'backend/package.json', '{"name":"backend"}\n');
    await writeSource(root, 'mobile/auth/package.json', '{"name":"@app/native-auth"}\n');
    const manifest = {
      ...FIXTURE_MANIFEST,
      core: { alwaysRemoveFiles: ['mobile/**'] },
    };

    const result = await prune(root, manifest, ['email-password', 'alpha'], []);

    expect(result.formattedFiles).toContain('pnpm-workspace.yaml');
    expect(parse(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'))).toEqual({
      packages: ['backend'],
      overrides: { diff: '>=8.0.3' },
      allowBuilds: { bcrypt: true },
      enablePrePostScripts: true,
    });
  });

  it('leaves a workspace file byte-identical when pruning removes no workspace', async () => {
    const root = await fixture();
    const workspaceFile =
      '# keep the original patterns and settings\npackages: [backend, shared/*]\noverrides: {diff: ">=8.0.3"}\nenablePrePostScripts: true\n';
    await writeSource(root, 'pnpm-workspace.yaml', workspaceFile);
    await writeSource(root, 'backend/package.json', '{"name":"backend"}\n');
    await writeSource(root, 'shared/core/package.json', '{"name":"@app/core"}\n');

    await prune(root, FIXTURE_MANIFEST, ['email-password', 'alpha', 'beta'], []);

    expect(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspaceFile);
  });

  it('reports imports left pointing at deleted files', async () => {
    const root = await fixture();
    const result = await prune(root, FIXTURE_MANIFEST, ['email-password', 'beta'], []);

    expect(result.dangling).toHaveLength(1);
    expect(result.dangling[0]).toMatchObject({
      file: 'src/auth.module.ts',
      line: 1,
      specifier: './strategies/alpha-oauth.strategy',
    });
  });

  it('removes planned features that never made it into the prompt', async () => {
    const root = await fixture();
    const result = await prune(root, FIXTURE_MANIFEST, ['email-password', 'alpha', 'beta'], []);
    expect(result.removed).toEqual(['gamma']);
  });

  it('reports @app/core imports left pointing at deleted shared files', async () => {
    const root = await sharedFixture({ core: { '.': './src/index.ts' } });
    await writeSource(root, 'frontend/src/page.ts', "import { ErrorCode } from '@app/core';\n");

    const bare = await findDanglingReferences(root, ['shared/core/src/index.ts']);
    expect(bare).toEqual([
      {
        file: 'frontend/src/page.ts',
        line: 1,
        specifier: '@app/core',
        target: 'shared/core/src/index',
      },
    ]);

    const intact = await findDanglingReferences(root, ['shared/core/src/other.ts']);
    expect(intact).toEqual([]);
  });

  it('follows a subpath the shared package exports', async () => {
    const root = await sharedFixture({
      core: { '.': './src/index.ts', './errors': './src/errors.ts' },
    });
    await writeSource(
      root,
      'shared/sdk/src/envelope.ts',
      "import { ErrorCode } from '@app/core/errors';\n",
    );

    const dangling = await findDanglingReferences(root, ['shared/core/src/errors.ts']);
    expect(dangling).toEqual([
      {
        file: 'shared/sdk/src/envelope.ts',
        line: 1,
        specifier: '@app/core/errors',
        target: 'shared/core/src/errors',
      },
    ]);

    const rootOnly = await findDanglingReferences(root, ['shared/core/src/index.ts']);
    expect(rootOnly).toEqual([]);
  });

  it('treats a deep @app/core path the package does not export as an unknown package', async () => {
    const root = await sharedFixture({ core: { '.': './src/index.ts' } });
    await writeSource(
      root,
      'frontend/src/deep.ts',
      "import { zodEmail } from '@app/core/validations/string';\n",
    );

    const dangling = await findDanglingReferences(root, ['shared/core/src/validations/string.ts']);
    expect(dangling).toEqual([]);
  });

  it('reports @app/sdk imports left pointing at the deleted sdk index', async () => {
    const root = await sharedFixture({ sdk: { '.': './src/index.ts' } });
    await writeSource(root, 'frontend/src/api.ts', "import { API_PATHS } from '@app/sdk';\n");

    const dangling = await findDanglingReferences(root, ['shared/sdk/src/index.ts']);
    expect(dangling).toEqual([
      {
        file: 'frontend/src/api.ts',
        line: 1,
        specifier: '@app/sdk',
        target: 'shared/sdk/src/index',
      },
    ]);

    const otherPackage = await findDanglingReferences(root, ['shared/core/src/index.ts']);
    expect(otherPackage).toEqual([]);
  });

  it('still reports imports of a shared package the pruner removed whole', async () => {
    const root = await sharedFixture({});
    await writeSource(root, 'frontend/src/api.ts', "import { API_PATHS } from '@app/sdk';\n");

    const dangling = await findDanglingReferences(root, [
      'shared/sdk/package.json',
      'shared/sdk/src/index.ts',
    ]);
    expect(dangling).toEqual([
      {
        file: 'frontend/src/api.ts',
        line: 1,
        specifier: '@app/sdk',
        target: 'shared/sdk/src/index',
      },
    ]);
  });

  it('treats an @app package with no shared folder as an ordinary package', async () => {
    const root = await sharedFixture({ core: { '.': './src/index.ts' } });
    await writeSource(root, 'frontend/src/other.ts', "import { thing } from '@app/other';\n");

    // Resolving `@app/other` by convention would land on this path and report it.
    const dangling = await findDanglingReferences(root, ['shared/other/src/index.ts']);
    expect(dangling).toEqual([]);
  });

  it.each(['@app/..', '@app/.', '@app/core.js', '@app/core/../sdk', '@app/Core'])(
    'does not read %s as a shared package',
    async (specifier) => {
      const root = await sharedFixture({
        core: { '.': './src/index.ts' },
        'core.js': { '.': './src/index.ts' },
        sdk: { '.': './src/index.ts' },
      });
      // A manifest wherever a looser pattern would look for one.
      await writeSource(root, 'package.json', '{}\n');
      await writeSource(root, 'shared/package.json', '{}\n');
      await writeSource(root, 'frontend/src/odd.ts', `import { thing } from '${specifier}';\n`);

      // Every path one of these would reach if the pattern let it through.
      const dangling = await findDanglingReferences(root, [
        'src/index.ts',
        'shared/src/index.ts',
        'shared/core/src/index.ts',
        'shared/core.js/src/index.ts',
        'shared/Core/src/index.ts',
        'shared/sdk/src/index.ts',
      ]);
      expect(dangling).toEqual([]);
    },
  );
});

describe('stripEnvVars', () => {
  it('drops a commented assignment and the comment above it', () => {
    const content = ['# Beta OAuth (optional)', '# OAUTH_BETA_CLIENT_ID=id', ''].join('\n');
    const result = stripEnvVars(content, new Map([['OAUTH_BETA_CLIENT_ID', ['Beta', 'beta']]]));

    expect(result.content.trim()).toBe('');
    expect(result.stripped).toEqual(['OAUTH_BETA_CLIENT_ID']);
  });

  it('keeps a comment that does not name the feature', () => {
    const content = ['# Rate limiting', 'OAUTH_BETA_CLIENT_ID=id', 'THROTTLE_TTL=60'].join('\n');
    const result = stripEnvVars(content, new Map([['OAUTH_BETA_CLIENT_ID', ['Beta', 'beta']]]));

    expect(result.content).toContain('# Rate limiting');
    expect(result.content).toContain('THROTTLE_TTL=60');
  });

  it('leaves a file with no removals alone apart from the trailing newline', () => {
    const content = 'A=1\nB=2\n';
    expect(stripEnvVars(content, new Map()).content).toBe(content);
  });
});
