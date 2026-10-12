import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TEMPLATE_IDENTITY_FILE } from '../../src/constants/index.js';
import {
  copySyncTemplateInputs,
  newFixture,
  syncScript,
  templateOf,
  trackFiles,
} from '../support/sync-template-fixture.js';

const roots: string[] = [];
const PACKAGE = 'packages/create-nest-next-auth';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sync(fixture: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [syncScript(fixture)], {
    timeout: 10_000,
    encoding: 'utf8',
    env,
  });
}

function shippedFiles(fixture: string): string[] {
  return readdirSync(templateOf(fixture), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(templateOf(fixture).length + 1))
    .sort();
}

describe('sync-template tracked files', () => {
  it('ships only the files Git tracks', () => {
    const fixture = newFixture(roots);
    mkdirSync(join(fixture, 'src'));
    mkdirSync(join(fixture, 'local-notes'));
    writeFileSync(join(fixture, 'src/tracked.txt'), 'tracked\n');
    writeFileSync(join(fixture, '.gitignore'), 'local-notes/\n');
    writeFileSync(join(fixture, '.npmrc'), '//registry.example.test/:_authToken=synthetic\n');
    writeFileSync(join(fixture, 'scratch.txt'), 'untracked\n');
    writeFileSync(join(fixture, 'local-notes/todo.txt'), 'ignored\n');
    trackFiles(fixture, ['src/tracked.txt', '.gitignore']);

    const result = sync(fixture);

    expect(result.status).toBe(0);
    expect(shippedFiles(fixture)).toEqual(['_gitignore', 'src/tracked.txt']);
  });

  it('ships a tracked .npmrc under its packed name', () => {
    const fixture = newFixture(roots);
    writeFileSync(join(fixture, '.npmrc'), 'engine-strict=true\n');
    trackFiles(fixture, ['.npmrc']);

    expect(sync(fixture).status).toBe(0);
    expect(shippedFiles(fixture)).toEqual(['_npmrc']);
  });

  it('keeps the deny list for a file that is tracked', () => {
    const fixture = newFixture(roots);
    mkdirSync(join(fixture, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(fixture, '.env'), 'SYNTHETIC=1\n');
    writeFileSync(join(fixture, 'server.pem'), 'synthetic\n');
    writeFileSync(join(fixture, 'node_modules/pkg/index.js'), 'export {};\n');
    writeFileSync(join(fixture, 'kept.txt'), 'kept\n');
    trackFiles(fixture, ['.env', 'server.pem', 'node_modules/pkg/index.js', 'kept.txt']);

    expect(sync(fixture).status).toBe(0);
    expect(shippedFiles(fixture)).toEqual(['kept.txt']);
  });

  it('leaves out a tracked file that was deleted from the working tree', () => {
    const fixture = newFixture(roots);
    writeFileSync(join(fixture, 'gone.txt'), 'gone\n');
    writeFileSync(join(fixture, 'kept.txt'), 'kept\n');
    trackFiles(fixture, ['gone.txt', 'kept.txt']);
    rmSync(join(fixture, 'gone.txt'));

    expect(sync(fixture).status).toBe(0);
    expect(shippedFiles(fixture)).toEqual(['kept.txt']);
  });
});

describe('sync-template without a usable repository', () => {
  it('fails when the folder is not a Git repository', () => {
    const fixture = newFixture(roots);
    writeFileSync(join(fixture, 'loose.txt'), 'loose\n');
    writeFileSync(join(fixture, PACKAGE, TEMPLATE_IDENTITY_FILE), '{"sha256":"deadbeef"}\n');

    const result = sync(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not the root of a Git repository');
    expect(existsSync(join(templateOf(fixture), 'loose.txt'))).toBe(false);
    expect(existsSync(join(fixture, PACKAGE, TEMPLATE_IDENTITY_FILE))).toBe(false);
  });

  it('fails when git cannot be run', () => {
    const fixture = newFixture(roots);
    writeFileSync(join(fixture, 'kept.txt'), 'kept\n');
    trackFiles(fixture, ['kept.txt']);
    const emptyPath = mkdtempSync(join(tmpdir(), 'cna-sync-no-git-'));
    roots.push(emptyPath);

    const result = sync(fixture, { ...process.env, PATH: emptyPath });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('git could not be run');
    expect(existsSync(join(templateOf(fixture), 'kept.txt'))).toBe(false);
  });

  it('fails when the folder sits inside another repository', () => {
    const outer = mkdtempSync(join(tmpdir(), 'cna-sync-outer-'));
    roots.push(outer);
    const fixture = join(outer, 'nested');
    mkdirSync(fixture);
    copySyncTemplateInputs(fixture);
    writeFileSync(join(fixture, 'template.manifest.json'), '{"features":{}}');
    writeFileSync(join(fixture, 'kept.txt'), 'kept\n');
    trackFiles(outer, ['nested/kept.txt']);

    const result = sync(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('it sits inside another repository at nested/');
    expect(existsSync(join(templateOf(fixture), 'kept.txt'))).toBe(false);
  });

  it('reads the repository in its own folder when a hook exports another one', () => {
    const other = newFixture(roots);
    writeFileSync(join(other, 'other.txt'), 'other\n');
    trackFiles(other, ['other.txt']);
    const fixture = newFixture(roots);
    writeFileSync(join(fixture, 'kept.txt'), 'kept\n');
    trackFiles(fixture, ['kept.txt']);

    const result = sync(fixture, {
      ...process.env,
      GIT_DIR: join(other, '.git'),
      GIT_WORK_TREE: other,
      GIT_INDEX_FILE: join(other, '.git/index'),
    });

    expect(result.status).toBe(0);
    expect(shippedFiles(fixture)).toEqual(['kept.txt']);
  });
});

it.each([
  {
    owner: { files: ['missing/**'] },
    reason: 'files names "missing/**", which matches no tracked file',
  },
  {
    owner: { files: ['kept.txt'], workspaces: ['missing'] },
    reason: 'workspaces names "missing", which has no tracked package.json',
  },
])('refuses stale manifest ownership: $reason', ({ owner, reason }) => {
  const fixture = newFixture(roots);
  writeFileSync(join(fixture, 'kept.txt'), 'tracked\n');
  writeFileSync(
    join(fixture, 'template.manifest.json'),
    JSON.stringify({ features: {}, shared: { core: owner } }),
  );
  trackFiles(fixture, ['kept.txt']);

  const result = sync(fixture);

  expect({
    status: result.status,
    reason: result.stderr.includes(`shared.core.${reason}`),
    identity: existsSync(join(fixture, PACKAGE, TEMPLATE_IDENTITY_FILE)),
  }).toEqual({ status: 1, reason: true, identity: false });
});

it('does not follow a symlink that replaces a tracked parent folder', () => {
  const fixture = newFixture(roots);
  mkdirSync(join(fixture, 'src'));
  writeFileSync(join(fixture, 'src/tracked.txt'), 'original\n');
  trackFiles(fixture, ['src/tracked.txt']);
  const outside = mkdtempSync(join(tmpdir(), 'cna-sync-outside-'));
  roots.push(outside);
  writeFileSync(join(outside, 'tracked.txt'), 'outside synthetic content\n');
  rmSync(join(fixture, 'src'), { recursive: true });
  symlinkSync(outside, join(fixture, 'src'), 'dir');

  const result = sync(fixture);

  expect({ status: result.status, shipped: shippedFiles(fixture) }).toEqual({
    status: 0,
    shipped: [],
  });
});

it('accepts planned targets and databases with no ownership lists', () => {
  const fixture = newFixture(roots);
  writeFileSync(join(fixture, 'kept.txt'), 'tracked\n');
  writeFileSync(
    join(fixture, 'template.manifest.json'),
    JSON.stringify({
      features: {},
      targets: { native: { label: 'Native', status: 'planned' } },
      databases: { postgres: { label: 'PostgreSQL', status: 'planned' } },
    }),
  );
  trackFiles(fixture, ['kept.txt']);

  const result = sync(fixture);

  expect({ status: result.status, shipped: shippedFiles(fixture) }).toEqual({
    status: 0,
    shipped: ['kept.txt'],
  });
});
