import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { outcome } from '../test-repository.mjs';
import {
  BAD,
  CLEAN,
  TOKEN,
  GATES,
  ZERO,
  fixture,
  remote,
  push,
  gates,
  received,
} from './round8-hook-fixture.mjs';

function suffixedRemote(t, repo, name) {
  const container = remote(t, repo, name);
  const root = join(container.root, 'destination.git');
  container.git('init', '--bare', root);
  repo.git('remote', 'set-url', name, root);
  return { root, git: (...args) => container.git('--git-dir', root, ...args) };
}

function untrusted(t) {
  const repo = fixture(t);
  const target = suffixedRemote(t, repo, 'primary');
  remote(t, repo, 'fork');
  repo.git('config', 'guardrails.trustedRemotes', 'fork');
  repo.git('push', 'primary', 'HEAD:seed');
  repo.git('push', 'fork', 'HEAD:seed');
  repo.write('src/inherited.ts', CLEAN + BAD);
  const dirty = repo.commit();
  repo.git('push', 'fork', 'HEAD:side');
  return { repo, target, dirty };
}

function alias(t, path, label) {
  const alternative = join(dirname(path), label);
  if (!existsSync(alternative)) {
    symlinkSync(path, alternative, 'dir');
    t.after(() => rmSync(alternative, { force: true }));
  }
  return alternative;
}

for (const spelling of [
  'absolute',
  'slash',
  'file',
  'relative',
  'suffix',
  'tmp',
  'dot',
  'symlink',
  'case',
  'case-without-suffix',
]) {
  test(`a normalized ${spelling} destination refuses another remote's inherited violation`, (t) => {
    const { repo, target, dirty } = untrusted(t);
    let url = target.root;
    if (spelling === 'slash') url += '/';
    if (spelling === 'file') url = pathToFileURL(url).href;
    if (spelling === 'relative') url = relative(repo.root, url);
    if (spelling === 'suffix') url = url.slice(0, -4);
    if (spelling === 'tmp') {
      const directory = mkdtempSync(join(tmpdir(), 'guardrails-url-'));
      url = join(directory, 'destination.git');
      symlinkSync(target.root, url, 'dir');
      t.after(() => rmSync(directory, { recursive: true, force: true }));
    }
    if (spelling === 'dot') url = join(dirname(url), '.') + '/./' + basename(url);
    if (spelling === 'symlink') url = alias(t, target.root, 'linked-destination');
    if (spelling === 'case') url = alias(t, target.root, 'DESTINATION.GIT');
    if (spelling === 'case-without-suffix')
      url = alias(t, target.root, 'DESTINATION.git').slice(0, -4);
    const result = push(repo, url, 'HEAD:published');
    assert.deepEqual(
      {
        status: result.status,
        hits: result.hits,
        gates: gates(repo),
        received: received(target, 'published'),
      },
      {
        status: 1,
        hits: [[dirty.slice(0, 7), 'src/inherited.ts', 2, TOKEN]],
        gates: [],
        received: null,
      },
    );
  });
}

for (const kind of ['fetch', 'push']) {
  test(`the second configured ${kind} URL establishes the destination`, (t) => {
    const { repo, target, dirty } = untrusted(t);
    const first = remote(t, repo, 'unused');
    if (kind === 'fetch') {
      repo.git('remote', 'set-url', 'primary', first.root);
      repo.git('config', '--add', 'remote.primary.url', target.root);
      repo.git('config', 'remote.primary.pushurl', first.root);
    } else {
      repo.git('remote', 'set-url', 'primary', first.root);
      repo.git('config', '--add', 'remote.primary.pushurl', first.root);
      repo.git('config', '--add', 'remote.primary.pushurl', target.root);
    }
    const result = push(repo, target.root, 'HEAD:published');
    assert.deepEqual(
      {
        status: result.status,
        hits: result.hits,
        gates: gates(repo),
        received: received(target, 'published'),
      },
      {
        status: 1,
        hits: [[dirty.slice(0, 7), 'src/inherited.ts', 2, TOKEN]],
        gates: [],
        received: null,
      },
    );
  });
}

for (const setting of ['insteadOf', 'pushInsteadOf']) {
  test(`the expanded hook URL resolves an ${setting} alias`, (t) => {
    const { repo, target, dirty } = untrusted(t);
    repo.git('config', `url.${dirname(target.root)}/.${setting}`, 'lab:');
    repo.git('remote', 'set-url', 'primary', 'lab:destination.git');
    const result = push(repo, 'lab:destination.git', 'HEAD:published');
    assert.deepEqual(
      {
        status: result.status,
        hits: result.hits,
        gates: gates(repo),
        received: received(target, 'published'),
      },
      {
        status: 1,
        hits: [[dirty.slice(0, 7), 'src/inherited.ts', 2, TOKEN]],
        gates: [],
        received: null,
      },
    );
  });
}

for (const known of ['origin', 'backup']) {
  test(`all URL matches contribute tracking history known only by ${known}`, (t) => {
    const repo = fixture(t);
    const target = suffixedRemote(t, repo, 'origin');
    repo.git('remote', 'add', 'backup', target.root);
    repo.git('push', known, 'HEAD:seed');
    repo.write('src/inherited.ts', BAD);
    repo.commit();
    repo.git('push', known, 'HEAD:side');
    repo.git('fetch', known);
    const result = push(repo, target.root, 'HEAD:published');
    assert.deepEqual(
      {
        status: result.status,
        hits: result.hits,
        gates: gates(repo),
        received: received(target, 'published'),
      },
      { status: 0, hits: [], gates: GATES, received: '2' },
    );
  });
}

test('a configured name wins over other names sharing its URL', (t) => {
  const repo = fixture(t);
  const target = suffixedRemote(t, repo, 'backup');
  repo.git('remote', 'add', 'origin', target.root);
  repo.git('push', 'origin', 'HEAD:seed');
  repo.write('src/inherited.ts', BAD);
  const dirty = repo.commit();
  repo.git('push', 'origin', 'HEAD:side');
  const result = push(repo, 'backup', 'HEAD:published');
  assert.deepEqual(
    {
      status: result.status,
      hits: result.hits,
      gates: gates(repo),
      received: received(target, 'published'),
    },
    {
      status: 1,
      hits: [[dirty.slice(0, 7), 'src/inherited.ts', 1, TOKEN]],
      gates: [],
      received: null,
    },
  );
});

test('a real optional URL lookup failure does not abort other matching remotes', (t) => {
  const { repo, target, dirty } = untrusted(t);
  repo.git('config', 'remote.-odd.url', target.root);
  repo.git('config', 'remote.-odd.fetch', '+refs/heads/*:refs/remotes/-odd/*');
  const result = push(repo, target.root, 'HEAD:published');
  assert.deepEqual(
    {
      status: result.status,
      hits: result.hits,
      gates: gates(repo),
      received: received(target, 'published'),
    },
    {
      status: 1,
      hits: [[dirty.slice(0, 7), 'src/inherited.ts', 2, TOKEN]],
      gates: [],
      received: null,
    },
  );
});

for (const [configured, supplied, expected] of [
  ['https://host.test/project.git', 'https://host.test/project', 1],
  ['https://host.test/project.git', 'https://host.test/project.git/', 1],
  ['https://host.test/project.git', 'https://HOST.test/project.git', 0],
  ['https://host.test/project.git', 'https://host.test/proj', 0],
  ['https://host.test/project.git', 'https://host.test/project-unmatched', 0],
  ['git@host.test:project.git', 'ssh://git@host.test/project.git', 0],
  [
    'https://user:fixture-secret@host.test/project.git',
    'https://user:fixture-secret@host.test/project.git',
    1,
  ],
  ['https://user:fixture-secret@host.test/project.git', 'https://host.test/project.git', 0],
]) {
  test(`network URL comparison is exact except suffix/slash: ${supplied}`, (t) => {
    const { repo, dirty } = untrusted(t);
    repo.git('remote', 'set-url', 'primary', configured);
    const input = `refs/heads/feature ${dirty} refs/heads/published ${ZERO}\n`;
    assert.deepEqual(outcome(repo.checkInput(input, '--push', '--hook', supplied)), {
      status: expected,
      hits: expected === 1 ? [['src/inherited.ts', 2, TOKEN]] : [],
      caps: [],
    });
  });
}

test('malformed push input never prints destination credentials', (t) => {
  const { repo } = untrusted(t);
  const url = 'https://user:fixture-secret@host.test/project.git';
  repo.git('remote', 'set-url', 'primary', url);
  const result = repo.checkInput('malformed\n', '--push', '--hook', url);
  assert.deepEqual(
    {
      ...outcome(result),
      credentialPrinted: result.diagnostic.includes('fixture-secret'),
      lines: result.diagnostic.trim().split('\n').filter(Boolean).length,
    },
    { status: 2, hits: [], caps: [], credentialPrinted: false, lines: 1 },
  );
});

test('hook destination URL grammar rejects a fifth argument with one error line', (t) => {
  const repo = fixture(t);
  const result = repo.checkInput(
    '',
    '--push',
    '--hook',
    'primary',
    'https://host.test/project.git',
    'extra',
  );
  assert.deepEqual(
    { ...outcome(result), lines: result.diagnostic.trim().split('\n').filter(Boolean).length },
    { status: 2, hits: [], caps: [], lines: 1 },
  );
});
