import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';
import { repository } from '../test-repository.mjs';

function exerciseRepositories(t) {
  const repo = repository(t);
  const origin = repository(t, ['--bare']);
  const colleague = repository(t);
  const trace = join(repo.root, '.git/git-trace.jsonl');
  repo.env.GIT_TRACE2_EVENT = trace;
  repo.git('config', 'gc.auto', '1');
  for (let index = 0; index < 512; index++) {
    repo.write(`objects/${index}.txt`, `${index}\n${'payload'.repeat(500)}\n`);
  }
  repo.commit();
  repo.git('remote', 'add', 'origin', origin.root);
  repo.git('push', '-u', 'origin', 'feature');
  colleague.git('fetch', origin.root, 'feature');
  colleague.git('reset', '--hard', 'FETCH_HEAD');
  colleague.write('colleague.txt', 'colleague change\n');
  colleague.commit();
  colleague.git('push', origin.root, 'HEAD:feature');
  repo.write('local.txt', 'local change\n');
  repo.commit();
  repo.git('fetch', 'origin');
  repo.git('rebase', 'origin/feature');
  return { repositories: [repo, origin, colleague], trace };
}

function liveGitProcesses(repositories) {
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw new Error(`Git process inspection is unavailable on ${process.platform}.`);
  }
  const options = { cwd: repositories[0].root, env: repositories[0].env, encoding: 'utf8' };
  const processes = execFileSync('ps', ['-axo', 'pid=,comm=,args='], options)
    .split('\n')
    .map((line) => line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/))
    .filter((match) => match && /^git(?:$|-)/.test(basename(match[2])));
  const roots = repositories.map(({ root }) => root);
  const matches = processes.filter((match) => roots.some((root) => match[3].includes(root)));
  for (const match of processes) {
    let cwd;
    if (process.platform === 'linux') {
      try {
        cwd = readlinkSync(`/proc/${match[1]}/cwd`);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
    } else {
      const result = spawnSync('lsof', ['-a', '-p', match[1], '-d', 'cwd', '-Fn'], options);
      if (result.error) throw result.error;
      if (
        result.status !== 0 &&
        !(result.status === 1 && result.stdout === '' && result.stderr === '')
      ) {
        throw new Error(`Cannot inspect Git PID ${match[1]}: ${result.stderr}`);
      }
      cwd = result.stdout
        .split('\n')
        .find((line) => line.startsWith('n'))
        ?.slice(1);
    }
    if (cwd && roots.some((root) => cwd === root || cwd.startsWith(`${root}/`))) {
      matches.push(match);
    }
  }
  return matches.map((match) => ({ pid: match[1], command: match[3] }));
}

test('fixture commit, fetch and rebase cannot start automatic maintenance', (t) => {
  const { trace } = exerciseRepositories(t);
  const events = readFileSync(trace, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const backgroundWork = events.filter(
    (event) =>
      event.event === 'child_start' &&
      event.argv.some((argument) => ['maintenance', 'gc', 'repack'].includes(argument)),
  );
  assert.deepEqual(backgroundWork, []);
});

test('fixture commit, fetch and rebase leave no live Git writer before cleanup', (t) => {
  const { repositories } = exerciseRepositories(t);
  assert.deepEqual(liveGitProcesses(repositories), []);
});
