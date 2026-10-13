import assert from 'node:assert/strict';
import test from 'node:test';
import { repository, outcome } from '../test-repository.mjs';

const TOKEN = 'inner' + 'HTML';
const BAD = `node.${TOKEN} = value;\n`;
const CLEAN = 'export const value = 1;\n';
const ZERO = '0'.repeat(40);
const update = (local, remote = ZERO) =>
  `refs/heads/feature ${local} refs/heads/feature ${remote}\n`;

for (const answers of [
  undefined,
  '.create-authstack-starter.json',
  '.create-nest-next-auth.json',
]) {
  test(`stdin first push checks a user root without trusting marker answers=${answers}`, (t) => {
    const repo = repository(t);
    repo.write('src/a.ts', BAD);
    if (answers) repo.write(answers, '{}\n');
    const head = repo.commit();
    assert.deepEqual(outcome(repo.checkInput(update(head), '--push')), {
      status: 1,
      hits: [['src/a.ts', 1, TOKEN]],
      caps: [],
    });
  });
}

test('stdin selects the pushed branch while HEAD remains clean', (t) => {
  const repo = repository(t);
  repo.write('src/a.ts', CLEAN);
  const remote = repo.commit();
  repo.git('branch', 'other');
  repo.git('switch', 'other');
  repo.write('src/other.ts', BAD);
  const local = repo.commit();
  repo.git('switch', 'feature');
  assert.deepEqual(outcome(repo.checkInput(update(local, remote), '--push')), {
    status: 1,
    hits: [['src/other.ts', 1, TOKEN]],
    caps: [],
  });
});

test('stdin excludes remote content and handles unchanged and deleted refs', (t) => {
  const repo = repository(t);
  repo.write('src/legacy.ts', BAD);
  const remote = repo.commit();
  repo.write('src/new.ts', CLEAN);
  const local = repo.commit();
  for (const input of [update(local, remote), update(remote, remote), update(ZERO, remote)]) {
    assert.deepEqual(outcome(repo.checkInput(input, '--push')), { status: 0, hits: [], caps: [] });
  }
});

test('stdin checks a forbidden intermediate commit even when the tip removes it', (t) => {
  const repo = repository(t);
  repo.write('src/a.ts', CLEAN);
  const remote = repo.commit();
  repo.write('src/temporary.ts', BAD);
  repo.commit();
  repo.git('rm', 'src/temporary.ts');
  const local = repo.commit();
  assert.deepEqual(outcome(repo.checkInput(update(local, remote), '--push')), {
    status: 1,
    hits: [['src/temporary.ts', 1, TOKEN]],
    caps: [],
  });
});

for (const input of ['bad input\n', `refs/heads/a ${'f'.repeat(40)} refs/heads/a ${ZERO}\n`]) {
  test(`invalid or missing stdin objects fail closed: ${input.trim()}`, (t) => {
    const repo = repository(t);
    repo.write('src/a.ts', CLEAN);
    repo.commit();
    const result = repo.checkInput(input, '--push');
    assert.equal(result.status, 2);
    assert.equal(result.diagnostic.trim().split('\n').filter(Boolean).length, 1);
  });
}

test('new side commits are scanned while a clean merge inherits known-remote content', (t) => {
  const repo = repository(t);
  repo.write('src/a.ts', CLEAN);
  const root = repo.commit();
  repo.git('branch', 'side');
  repo.write('src/legacy.ts', BAD);
  const remote = repo.commit();
  repo.git('switch', 'side');
  repo.write('src/side.ts', CLEAN);
  repo.commit();
  repo.git('merge', '--no-edit', 'feature');
  const local = repo.git('rev-parse', 'HEAD');
  assert.deepEqual(outcome(repo.checkInput(update(local, remote), '--push')), {
    status: 0,
    hits: [],
    caps: [],
  });
  repo.git('switch', '-c', 'bad-side', root);
  repo.write('src/side-bad.ts', BAD);
  repo.commit();
  repo.git('merge', '--no-edit', 'feature');
  assert.deepEqual(
    outcome(repo.checkInput(update(repo.git('rev-parse', 'HEAD'), remote), '--push')),
    {
      status: 1,
      hits: [['src/side-bad.ts', 1, TOKEN]],
      caps: [],
    },
  );
});

test('stdin checks a line created only by the merge result', (t) => {
  const repo = repository(t);
  repo.write('src/a.ts', CLEAN);
  repo.commit();
  repo.git('branch', 'side');
  repo.write('src/main.ts', CLEAN);
  const remote = repo.commit();
  repo.git('switch', 'side');
  repo.write('src/side.ts', CLEAN);
  repo.commit();
  repo.git('merge', '--no-commit', '--no-ff', 'feature');
  repo.write('src/merge.ts', BAD);
  const local = repo.commit();
  assert.deepEqual(outcome(repo.checkInput(update(local, remote), '--push')), {
    status: 1,
    hits: [['src/merge.ts', 1, TOKEN]],
    caps: [],
  });
});

for (const variant of ['extra field', 'symbolic object']) {
  test(`stdin validates existing objects: ${variant}`, (t) => {
    const repo = repository(t);
    repo.write('src/a.ts', CLEAN);
    const head = repo.commit();
    const input = variant === 'extra field' ? update(head).trimEnd() + ' extra\n' : update('HEAD');
    const result = repo.checkInput(input, '--push');
    assert.deepEqual(
      { status: result.status, lines: result.diagnostic.trim().split('\n').filter(Boolean).length },
      { status: 2, lines: 1 },
    );
  });
}
