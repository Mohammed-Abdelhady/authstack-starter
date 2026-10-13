import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { templateContent } from '../../scripts/sync-template.mjs';
import { commandEnvironment } from '../../src/utils/exec.js';

export const TRUSTED_RULES_ROOT = join(import.meta.dirname, '../../../..');
const roots: string[] = [];
export async function rulesFixture(
  manifest: unknown = {
    packageManager: 'pnpm@12.6.0',
    scripts: { lint: 'echo ok', typecheck: 'echo ok', test: 'echo ok', build: 'echo ok' },
  },
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'add-rules-'));
  roots.push(root);
  if (manifest !== undefined) await put(root, 'package.json', JSON.stringify(manifest));
  return root;
}
export async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
/** No inherited repository, no developer git configuration, husky not switched off. */
export function fixtureEnvironment(root: string): NodeJS.ProcessEnv {
  const { HUSKY: _husky, ...env } = commandEnvironment();
  return { ...env, GIT_CONFIG_GLOBAL: join(root, 'absent-global'), GIT_CONFIG_NOSYSTEM: '1' };
}
export function fixtureGit(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: fixtureEnvironment(root) });
}
export async function cleanRulesFixtures(): Promise<void> {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
}

export async function trackedRulesFile(root: string): Promise<void> {
  const content = Buffer.from('tracked fixture\n');
  const blob = Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]);
  const hash = createHash('sha1').update(blob).digest();
  const object = hash.toString('hex');
  await mkdir(join(root, '.git/objects', object.slice(0, 2)), { recursive: true });
  await writeFile(
    join(root, '.git/objects', object.slice(0, 2), object.slice(2)),
    deflateSync(blob),
  );
  const header = Buffer.from('444952430000000200000001', 'hex');
  const entry = Buffer.alloc(80);
  entry.writeUInt32BE(0o100644, 24);
  hash.copy(entry, 40);
  entry.writeUInt16BE(11, 60);
  entry.write('tracked.txt', 62);
  const index = Buffer.concat([header, entry]);
  await writeFile(
    join(root, '.git/index'),
    Buffer.concat([index, createHash('sha1').update(index).digest()]),
  );
  await put(root, 'tracked.txt', content.toString());
}

export async function rulesInstallerFixture(): Promise<string> {
  const root = await rulesFixture({});
  const scripts = await readdir(join(TRUSTED_RULES_ROOT, 'scripts'), {
    recursive: true,
    withFileTypes: true,
  });
  const files = [
    '.husky/pre-commit',
    '.husky/pre-push',
    '.husky/commit-msg',
    '.github/workflows/ci.yml',
    '.github/workflows/trusted-scan.yml',
    'commitlint.config.cjs',
    ...scripts
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.(mjs|json|sh)$/.test(entry.name) &&
          !/\.(test|slow)\.mjs$/.test(entry.name),
      )
      .map((entry) => relative(TRUSTED_RULES_ROOT, join(entry.parentPath, entry.name))),
  ];
  for (const path of files) {
    const content = templateContent(path, await readFile(join(TRUSTED_RULES_ROOT, path)));
    await put(root, join('template', path), content.toString());
  }
  return root;
}
