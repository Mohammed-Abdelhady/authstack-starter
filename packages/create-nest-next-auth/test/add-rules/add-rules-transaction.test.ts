import { basename, dirname, join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { applyRules, planRules } from '../../src/add-rules/plan.js';
import { cleanRulesFixtures, put, rulesFixture, TRUSTED_RULES_ROOT } from './add-rules-fixture.js';

const fault = vi.hoisted(() => ({
  root: '',
  race: false,
  fail: false,
  write: false,
  replace: false,
  symbolic: false,
  parent: false,
  directory: false,
  parentRead: false,
  outside: '',
  parentInode: 0,
  outsideInode: 0,
  openedOutside: false,
  cleanupFile: false,
  cleanupDirectory: false,
  recovery: false,
  workspaceRead: false,
  workspaceInode: 0,
  outsideDirectoryInode: 0,
  listedOutside: false,
}));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    readdir: async (...args: Parameters<typeof fs.readdir>) => {
      const stat = await fs.stat(args[0]);
      if (fault.workspaceRead && stat.ino === fault.workspaceInode) {
        fault.workspaceRead = false;
        await fs.rename(join(fault.root, 'apps'), join(fault.root, 'apps-old'));
        await fs.symlink(fault.outside, join(fault.root, 'apps'));
      }
      if (
        fault.outsideDirectoryInode &&
        (await fs.stat(args[0])).ino === fault.outsideDirectoryInode
      )
        fault.listedOutside = true;
      return fs.readdir(...args);
    },
    rename: async (...args: Parameters<typeof fs.rename>) => {
      const name = basename(String(args[0]));
      if (fault.cleanupFile && name === 'AGENTS.md') {
        fault.cleanupFile = false;
        await fs.unlink(args[0]);
        await fs.writeFile(args[0], 'late cleanup writer\n');
      }
      if (fault.cleanupDirectory && name === 'scripts') {
        fault.cleanupDirectory = false;
        await fs.rename(args[0], `${String(args[0])}-old`);
        await fs.mkdir(args[0]);
        await fs.writeFile(join(String(args[0]), 'marker'), 'late directory writer\n');
      }
      return fs.rename(...args);
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      if (
        fault.root !== '' &&
        basename(String(args[0])) === 'CLAUDE.md' &&
        typeof args[1] === 'number'
      ) {
        if (fault.race) {
          fault.race = false;
          await fs.writeFile(args[0], 'racing writer\n');
        } else if (fault.fail) {
          fault.fail = false;
          throw new Error('disk failure');
        }
      }
      if (fault.recovery && basename(String(args[0])).startsWith('.rules-rollback-')) {
        fault.recovery = false;
        await fs.rename(args[0], `${String(args[0])}-old`);
        await fs.symlink(fault.outside, args[0]);
      }
      if (fault.directory && basename(String(args[0])) === 'scripts') {
        fault.directory = false;
        throw new Error('directory open failure');
      }
      if (fault.parent && basename(String(args[0])) === 'gates.json') {
        fault.parent = false;
        await fs.rename(join(fault.root, 'scripts/ci'), join(fault.root, 'scripts/ci-old'));
        await fs.symlink(fault.outside, join(fault.root, 'scripts/ci'));
      }
      if (
        fault.parentRead &&
        basename(String(args[0])) === 'package.json' &&
        (await fs.stat(dirname(String(args[0])))).ino === fault.parentInode
      ) {
        fault.parentRead = false;
        await fs.rename(join(fault.root, 'apps/web'), join(fault.root, 'apps/web-old'));
        await fs.symlink(fault.outside, join(fault.root, 'apps/web'));
      }
      const handle = await fs.open(...args);
      if (fault.write && basename(String(args[0])) === 'AGENTS.md') {
        fault.write = false;
        handle.writeFile = async () => {
          throw new Error('disk write failure');
        };
      }
      if (fault.outsideInode && (await handle.stat()).ino === fault.outsideInode)
        fault.openedOutside = true;
      if (fault.symbolic && basename(String(args[0])) === '.create-nest-next-auth.rules.json') {
        fault.symbolic = false;
        await fs.unlink(join(fault.root, 'CLAUDE.md'));
        await fs.symlink(join(fault.outside, 'package.json'), join(fault.root, 'CLAUDE.md'));
      }
      if (
        fault.root !== '' &&
        basename(String(args[0])) === '.create-nest-next-auth.rules.json' &&
        fault.replace
      ) {
        fault.replace = false;
        await fs.unlink(join(fault.root, 'AGENTS.md'));
        await fs.writeFile(join(fault.root, 'AGENTS.md'), 'competing writer\n');
      }
      return handle;
    },
  };
});
afterEach(async () => {
  fault.root = '';
  fault.race = false;
  fault.fail = false;
  Object.assign(fault, {
    root: '',
    race: false,
    fail: false,
    write: false,
    replace: false,
    symbolic: false,
    parent: false,
    directory: false,
    parentRead: false,
    outside: '',
    parentInode: 0,
    outsideInode: 0,
    openedOutside: false,
    cleanupFile: false,
    cleanupDirectory: false,
    recovery: false,
    workspaceRead: false,
    workspaceInode: 0,
    outsideDirectoryInode: 0,
    listedOutside: false,
  });
  await cleanRulesFixtures();
});
it.each(['race', 'fail', 'write', 'replace'] as const)(
  'rolls back reservations after a late %s and preserves the competing writer',
  async (mode) => {
    const root = await rulesFixture();
    const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
    fault.root = root;
    fault[mode] = true;
    await expect(applyRules(plan)).rejects.toThrow();
    expect(await readdir(root)).toEqual(
      mode === 'race'
        ? ['CLAUDE.md', 'package.json']
        : mode === 'replace'
          ? ['AGENTS.md', 'package.json']
          : ['package.json'],
    );
    if (mode === 'replace')
      expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('competing writer\n');
    if (mode === 'race')
      expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe('racing writer\n');
  },
);

it.each(['symbolic', 'parent', 'directory'] as const)(
  'handles late %s faults without following a project symlink or abandoning reservations',
  async (mode) => {
    const root = await rulesFixture();
    const outside = await rulesFixture({ name: 'outside-marker' });
    const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
    fault.root = root;
    fault.outside = outside;
    fault[mode] = true;
    await expect(applyRules(plan)).rejects.toThrow();
    expect({
      tree: await readdir(root),
      outside: await readFile(join(outside, 'package.json'), 'utf8'),
      outsideTree: await readdir(outside),
      scripts: mode === 'parent' ? await readdir(join(root, 'scripts')) : [],
    }).toEqual({
      tree:
        mode === 'symbolic'
          ? ['CLAUDE.md', 'package.json']
          : mode === 'parent'
            ? ['package.json', 'scripts']
            : ['package.json'],
      outside: '{"name":"outside-marker"}',
      outsideTree: ['package.json'],
      scripts: mode === 'parent' ? ['ci'] : [],
    });
  },
);
it('does not read through a parent swapped after directory inspection', async () => {
  const root = await rulesFixture({ packageManager: 'pnpm@12.6.0', workspaces: ['apps/*'] });
  const outside = await rulesFixture({ name: 'outside-marker' });
  const fs = await import('node:fs/promises');
  await fs.mkdir(join(root, 'apps/web'), { recursive: true });
  await fs.writeFile(join(root, 'apps/web/package.json'), '{}');
  fault.root = root;
  fault.outside = outside;
  fault.parentInode = (await fs.lstat(join(root, 'apps/web'))).ino;
  fault.outsideInode = (await fs.lstat(join(outside, 'package.json'))).ino;
  fault.parentRead = true;
  await expect(planRules(root, 'strict', TRUSTED_RULES_ROOT)).rejects.toThrow('Symbolic link');
  expect(fault.openedOutside).toBe(false);
});

it('restores a competing file captured after the rollback ownership check', async () => {
  const root = await rulesFixture();
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  Object.assign(fault, { root, fail: true, cleanupFile: true });
  await expect(applyRules(plan)).rejects.toThrow('disk failure');
  expect({
    tree: await readdir(root),
    content: await readFile(join(root, 'AGENTS.md'), 'utf8'),
  }).toEqual({ tree: ['AGENTS.md', 'package.json'], content: 'late cleanup writer\n' });
});
it('preserves a competing directory captured during cleanup and reports its recovery location', async () => {
  const root = await rulesFixture();
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  Object.assign(fault, { root, fail: true, cleanupDirectory: true });
  await expect(applyRules(plan)).rejects.toThrow('Competing directory preserved at');
  const recovery = (await readdir(root)).find((name) => name.startsWith('.rules-rollback-'));
  if (!recovery) throw new Error('Missing reported recovery directory');
  expect(await readFile(join(root, recovery, 'entry/marker'), 'utf8')).toBe(
    'late directory writer\n',
  );
});

it('never captures through a replaced rollback recovery parent', async () => {
  const root = await rulesFixture();
  const outside = await rulesFixture({ name: 'outside-marker' });
  await put(outside, 'entry', 'outside recovery writer\n');
  const plan = await planRules(root, 'strict', TRUSTED_RULES_ROOT);
  Object.assign(fault, { root, outside, fail: true, recovery: true });
  await expect(applyRules(plan)).rejects.toThrow('Rollback needs attention');
  expect({
    tree: await readdir(outside),
    content: await readFile(join(outside, 'package.json'), 'utf8'),
    entry: await readFile(join(outside, 'entry'), 'utf8'),
  }).toEqual({
    tree: ['entry', 'package.json'],
    content: '{"name":"outside-marker"}',
    entry: 'outside recovery writer\n',
  });
});

it('never lists outside workspace entries through a parent swapped during traversal', async () => {
  const root = await rulesFixture({ packageManager: 'pnpm@12.6.0', workspaces: ['apps/*'] });
  const outside = await rulesFixture();
  await put(root, 'apps/web/package.json', '{}');
  const fs = await import('node:fs/promises');
  Object.assign(fault, {
    root,
    outside,
    workspaceRead: true,
    workspaceInode: (await fs.stat(join(root, 'apps'))).ino,
    outsideDirectoryInode: (await fs.stat(outside)).ino,
  });
  await expect(planRules(root, 'strict', TRUSTED_RULES_ROOT)).rejects.toThrow('Symbolic link');
  expect(fault.listedOutside).toBe(false);
});
