import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { MANIFEST_FILE, TEMPLATE_IDENTITY_FILE } from '../../src/constants/index.js';
import { PACKAGE_PATH, stagePackage } from './package-stage.js';
import { newFixture, runScript, trackAll } from '../support/sync-template-fixture.js';

const STALE_IDENTITY = '{"sha256":"stale"}\n';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** A repository whose package folder still holds an earlier build's output. */
function repository(): { root: string; packageDir: string } {
  const root = newFixture(roots);
  const packageDir = join(root, PACKAGE_PATH);
  put(root, 'README.md', '# Fixture\n');
  put(root, '.env', 'SECRET=1\n');
  put(root, 'node_modules/root-only/index.js', '');
  put(packageDir, 'node_modules/installed/index.js', 'export default 1;\n');
  put(packageDir, 'template/stale.txt', 'stale\n');
  put(packageDir, MANIFEST_FILE, '{"features":{"stale":{}}}');
  put(packageDir, TEMPLATE_IDENTITY_FILE, STALE_IDENTITY);
  trackAll(root);
  return { root, packageDir };
}

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'cna-stage-'));
  roots.push(root);
  return root;
}

it('builds in the stage and leaves the source package folder as it was', () => {
  const { root, packageDir } = repository();
  const staged = stagePackage(workspace(), root);

  runScript(dirname(dirname(staged)));

  expect({
    template: readdirSync(join(staged, 'template')).sort(),
    manifest: readFileSync(join(staged, MANIFEST_FILE), 'utf8'),
    identityIsFresh: readFileSync(join(staged, TEMPLATE_IDENTITY_FILE), 'utf8') !== STALE_IDENTITY,
  }).toEqual({ template: ['README.md'], manifest: '{"features":{}}', identityIsFresh: true });
  expect({
    template: readdirSync(join(packageDir, 'template')),
    manifest: readFileSync(join(packageDir, MANIFEST_FILE), 'utf8'),
    identity: readFileSync(join(packageDir, TEMPLATE_IDENTITY_FILE), 'utf8'),
  }).toEqual({
    template: ['stale.txt'],
    manifest: '{"features":{"stale":{}}}',
    identity: STALE_IDENTITY,
  });
});

it('ships a tracked file as it is on disk and leaves an untracked one out', () => {
  const { root } = repository();
  put(root, 'README.md', '# Edited and not committed\n');
  put(root, 'scratch.txt', 'never added\n');
  const staged = stagePackage(workspace(), root);

  runScript(dirname(dirname(staged)));

  expect({
    template: readdirSync(join(staged, 'template')).sort(),
    readme: readFileSync(join(staged, 'template/README.md'), 'utf8'),
  }).toEqual({ template: ['README.md'], readme: '# Edited and not committed\n' });
});

it('refuses a source that is not a Git repository', () => {
  const root = newFixture(roots);

  expect(() => stagePackage(workspace(), root)).toThrow(/not the root of a Git repository/);
});

it('leaves an earlier build, secrets and the root dependencies out of the stage', () => {
  const { root } = repository();
  const staged = stagePackage(workspace(), root);
  const stage = dirname(dirname(staged));

  expect({
    staleTemplate: existsSync(join(staged, 'template')),
    staleManifest: existsSync(join(staged, MANIFEST_FILE)),
    staleIdentity: existsSync(join(staged, TEMPLATE_IDENTITY_FILE)),
    secret: existsSync(join(stage, '.env')),
    rootDependencies: existsSync(join(stage, 'node_modules')),
  }).toEqual({
    staleTemplate: false,
    staleManifest: false,
    staleIdentity: false,
    secret: false,
    rootDependencies: false,
  });
});

it('reaches the dependencies installed for the source package', () => {
  const { root } = repository();
  const staged = stagePackage(workspace(), root);

  expect(readFileSync(join(staged, 'node_modules/installed/index.js'), 'utf8')).toBe(
    'export default 1;\n',
  );
});

it('refuses a repository that has no manifest', () => {
  const { root } = repository();
  rmSync(join(root, MANIFEST_FILE));

  expect(() => stagePackage(workspace(), root)).toThrow(/ENOENT/);
});
