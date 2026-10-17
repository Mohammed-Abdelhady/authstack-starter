import assert from 'node:assert/strict';
import test from 'node:test';
import { repository } from '../test-repository.mjs';
import {
  BAD,
  CLEAN,
  GATES,
  TOKEN,
  fixture,
  gates,
  push,
  received,
  remote,
} from './round8-hook-fixture.mjs';

function notices(result) {
  return result.diagnostic
    .split('\n')
    .filter((line) => /^(?:warning:|trusting guardrails\.)/.test(line));
}

test('an unfetched shared branch explains refusal and passes after fetch and rebase', (t) => {
  const repo = fixture(t);
  repo.git('branch', '-m', 'main');
  const origin = remote(t, repo, 'origin');
  repo.git('push', 'origin', 'main');
  repo.git('switch', '-c', 'shared');
  repo.write('src/shared.ts', CLEAN);
  repo.commit();
  repo.git('push', '-u', 'origin', 'shared');
  const colleague = repository(t);
  colleague.git('fetch', origin.root, 'shared');
  colleague.git('reset', '--hard', 'FETCH_HEAD');
  colleague.write('src/inherited.ts', BAD);
  const inherited = colleague.commit();
  colleague.git('push', origin.root, 'HEAD:shared');
  repo.git('fetch', 'origin');
  repo.git('merge', '--ff-only', 'origin/shared');
  colleague.write('src/colleague.ts', CLEAN);
  const server = colleague.commit();
  colleague.git('push', origin.root, 'HEAD:shared');
  repo.write('src/own.ts', CLEAN);
  repo.commit();
  const refused = push(repo, 'origin', 'shared');
  const report = refused.diagnostic
    .split('\n')
    .filter((line) => line.startsWith('warning:') || line.includes(': banned token '));
  assert.deepEqual(
    {
      status: refused.status,
      hits: refused.hits,
      notices: notices(refused),
      adviceFirst: report[0]?.startsWith('warning:'),
      gates: gates(repo),
      server: origin.git('rev-parse', 'shared'),
    },
    {
      status: 1,
      hits: [[inherited.slice(0, 7), 'src/inherited.ts', 1, TOKEN]],
      notices: [
        'warning: the tracking ref for the pushed branch is out of date; fetch first, then push again.',
      ],
      adviceFirst: true,
      gates: [],
      server,
    },
  );
  repo.git('fetch', 'origin');
  repo.git('rebase', 'origin/shared');
  const accepted = push(repo, 'origin', 'shared');
  assert.deepEqual(
    {
      status: accepted.status,
      hits: accepted.hits,
      notices: notices(accepted),
      gates: gates(repo),
      branch: received(origin, 'shared'),
    },
    { status: 0, hits: [], notices: [], gates: GATES, branch: '5' },
  );
});
