import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { repository, outcome } from '../test-repository.mjs';

const TYPE = 'a' + 'ny';
const DOM_NAME = 'inner' + 'HTML';
const BAD = `node.${DOM_NAME} = value;\n`;
const CLEAN = 'export const value = 1;\n';

function range(t, source = CLEAN) {
  const repo = repository(t);
  repo.write('src/value.ts', source);
  const base = repo.commit();
  return { repo, base };
}

test('range ignores old violations and unstaged content', (t) => {
  const { repo, base } = range(t, BAD);
  repo.write('src/value.ts', BAD + CLEAN);
  const head = repo.commit();
  repo.write('src/value.ts', BAD.repeat(351));
  assert.deepEqual(outcome(repo.check('--range', base, head)), { status: 0, hits: [], caps: [] });
});

test('range rejects an added banned line at its head line number', (t) => {
  const { repo, base } = range(t);
  repo.write('src/value.ts', CLEAN + BAD);
  const head = repo.commit();
  assert.deepEqual(outcome(repo.check('--range', base, head)), {
    status: 1,
    hits: [['src/value.ts', 2, DOM_NAME]],
    caps: [],
  });
});

for (const [name, args, label] of [
  ['missing base', ['--range'], 'base'],
  ['unresolvable base', ['--range', 'absent', 'HEAD'], 'base'],
  ['missing head', ['--range', 'HEAD'], 'head'],
  ['unresolvable head', ['--range', 'HEAD', 'absent'], 'head'],
  ['option base', ['--range', '--all', 'HEAD'], 'base'],
]) {
  test(`range ${name} fails closed`, (t) => {
    const { repo } = range(t);
    const result = repo.check(...args);
    assert.deepEqual(
      {
        status: result.status,
        resolutionError: result.diagnostic.includes(`Cannot resolve ${label} commit`),
      },
      {
        status: 2,
        resolutionError: true,
      },
    );
  });
}

for (const [lines, status, caps] of [
  [349, 0, []],
  [350, 0, []],
  [351, 1, [['backend/src/large.ts', 351]]],
]) {
  test(`range checks ${lines} head lines, not worktree length`, (t) => {
    const { repo, base } = range(t);
    repo.write('backend/src/large.ts', CLEAN.repeat(lines));
    const head = repo.commit();
    repo.write('backend/src/large.ts', '');
    assert.deepEqual(outcome(repo.check('--range', base, head)), { status, hits: [], caps });
  });
}

test('staged ceiling reads index content', (t) => {
  const repo = repository(t);
  repo.write('backend/src/large.ts', CLEAN.repeat(351));
  repo.git('add', '.');
  repo.write('backend/src/large.ts', CLEAN);
  assert.deepEqual(outcome(repo.check('--staged')), {
    status: 1,
    hits: [],
    caps: [['backend/src/large.ts', 351]],
  });
});

for (const filePath of ['src/with space.ts', 'src/é.ts', 'src/quote"tab\t.ts']) {
  test(`range preserves git path ${JSON.stringify(filePath)}`, (t) => {
    const { repo, base } = range(t);
    repo.write(filePath, BAD);
    const head = repo.commit();
    assert.deepEqual(outcome(repo.check('--range', base, head)), {
      status: 1,
      hits: [[filePath, 1, DOM_NAME]],
      caps: [],
    });
  });
}

test('range ignores a deleted banned file', (t) => {
  const { repo, base } = range(t, BAD);
  repo.git('rm', 'src/value.ts');
  const head = repo.commit();
  assert.deepEqual(outcome(repo.check('--range', base, head)), { status: 0, hits: [], caps: [] });
});

test('range checks new lines in a renamed file', (t) => {
  const { repo, base } = range(t, CLEAN.repeat(10));
  repo.git('mv', 'src/value.ts', 'src/renamed.ts');
  repo.write('src/renamed.ts', CLEAN.repeat(10) + BAD);
  const head = repo.commit();
  assert.deepEqual(outcome(repo.check('--range', base, head)), {
    status: 1,
    hits: [['src/renamed.ts', 11, DOM_NAME]],
    caps: [],
  });
});

test('range checks ceiling on rename without added lines', (t) => {
  const { repo, base } = range(t, CLEAN.repeat(351));
  repo.write('backend/src/.keep', '');
  repo.git('mv', 'src/value.ts', 'backend/src/renamed.ts');
  const head = repo.commit();
  assert.deepEqual(outcome(repo.check('--range', base, head)), {
    status: 1,
    hits: [],
    caps: [['backend/src/renamed.ts', 351]],
  });
});

test('range accepts empty and binary files', (t) => {
  const { repo, base } = range(t);
  repo.write('empty.ts', '');
  repo.write(
    'frontend/src/binary.png',
    Buffer.concat([Buffer.from([0, 255, 1]), Buffer.from(BAD.repeat(351))]),
  );
  const head = repo.commit();
  assert.deepEqual(outcome(repo.check('--range', base, head)), { status: 0, hits: [], caps: [] });
});

test('range reads a last line without a trailing newline', (t) => {
  const { repo, base } = range(t);
  repo.write('src/value.ts', BAD.trim());
  const head = repo.commit();
  assert.deepEqual(outcome(repo.check('--range', base, head)), {
    status: 1,
    hits: [['src/value.ts', 1, DOM_NAME]],
    caps: [],
  });
});

test('first push excludes inherited root content and checks later added lines', (t) => {
  const { repo } = range(t, BAD);
  repo.write('src/added.ts', BAD);
  repo.commit();
  assert.deepEqual(outcome(repo.check('--push')), {
    status: 1,
    hits: [['src/added.ts', 1, DOM_NAME]],
    caps: [],
  });
});

test('push without HEAD reports resolution error', (t) => {
  const repo = repository(t);
  const result = repo.check('--push');
  assert.deepEqual(
    {
      status: result.status,
      resolutionError: result.diagnostic.includes('Cannot resolve push head commit'),
    },
    {
      status: 2,
      resolutionError: true,
    },
  );
});

test('push with configured but missing upstream uses root fallback', (t) => {
  const { repo } = range(t);
  repo.git('config', 'branch.feature.remote', 'origin');
  repo.git('config', 'branch.feature.merge', 'refs/heads/absent');
  assert.deepEqual(outcome(repo.check('--push')), { status: 0, hits: [], caps: [] });
});

for (const [name, upstream] of [
  ['default remote', false],
  ['upstream', true],
]) {
  test(`push uses merge base with ${name}`, (t) => {
    const { repo, base } = range(t, BAD);
    repo.git('update-ref', 'refs/remotes/origin/staging', base);
    repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/staging');
    if (upstream) {
      repo.git('config', 'remote.origin.url', 'https://example.invalid/fixture.git');
      repo.git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
      repo.git('config', 'branch.feature.remote', 'origin');
      repo.git('config', 'branch.feature.merge', 'refs/heads/staging');
    }
    repo.write('src/value.ts', BAD + CLEAN);
    repo.commit();
    assert.deepEqual(outcome(repo.check('--push')), { status: 0, hits: [], caps: [] });
  });
}

test('push uses the root when the default remote branch shares no history', (t) => {
  const { repo } = range(t);
  const tree = repo.git('rev-parse', 'HEAD^{tree}');
  const unrelated = repo.git('commit-tree', tree, '-m', 'test: unrelated root');
  repo.git('update-ref', 'refs/remotes/origin/staging', unrelated);
  repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/staging');
  assert.deepEqual(outcome(repo.check('--push')), { status: 0, hits: [], caps: [] });
});

test('full scan does not follow links or open protected files', (t) => {
  const { repo } = range(t);
  repo.write('outside.txt', BAD);
  symlinkSync(join(repo.root, 'outside.txt'), join(repo.root, 'link.ts'));
  repo.write('backend/src/.env.local', BAD + CLEAN.repeat(351));
  const result = repo.check('--all');
  assert.deepEqual(outcome(result), {
    status: 1,
    hits: [],
    caps: [],
  });
  assert.match(
    result.diagnostic,
    /^link\.ts:1: Source symlinks are refused; commit a regular source file\.$/m,
  );
});

test('commit message mode strips attribution through the hook entry', (t) => {
  const repo = repository(t);
  repo.write('message.txt', 'test: fixture\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n');
  const result = repo.check('--commit-msg', join(repo.root, 'message.txt'));
  assert.deepEqual(
    { status: result.status, message: readFileSync(join(repo.root, 'message.txt'), 'utf8') },
    {
      status: 0,
      message: 'test: fixture\n',
    },
  );
});
