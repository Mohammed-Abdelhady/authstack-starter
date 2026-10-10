import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT_PUSH_TIMEOUT_MS } from '../policy.mjs';
import { installChecker, repository } from '../test-repository.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const TOKEN = 'inner' + 'HTML';
export const CLEAN = 'export const value = 1;\n';
export const BAD = `node.${TOKEN} = value;\n`;
export const GATES = ['lint', 'typecheck', 'test'];
export const ZERO = '0'.repeat(40);
const PROCESS_TREE_STOP_TIMEOUT_MS = 10_000;
const PROCESS_TREE_POLL_MS = 25;

export function fixture(t, { hooks = true } = {}) {
  const repo = repository(t);
  installChecker(repo.root, { directory: 'scripts' });
  repo.write(
    'package.json',
    JSON.stringify({
      type: 'module',
      scripts: {
        lint: 'node scripts/lifecycle.mjs lint',
        typecheck: 'node scripts/lifecycle.mjs typecheck',
        test: 'node scripts/lifecycle.mjs test',
      },
    }),
  );
  repo.write(
    'scripts/lifecycle.mjs',
    "import { appendFileSync } from 'node:fs';\n" +
      "appendFileSync('.git/lifecycle', `${process.argv[2]}\\n`);\n",
  );
  if (hooks) installHooks(repo);
  repo.write('src/root.ts', CLEAN);
  repo.commit();
  return repo;
}

export function remote(t, repo, name, url) {
  const target = repository(t, ['--bare']);
  repo.git('remote', 'add', name, url ?? target.root);
  return target;
}

// Mirrors stopProcessTree in the installer's test support, which cannot be imported from here.
function processTable() {
  const listed = spawnSync('ps', ['-Ao', 'pid=,ppid=,pgid=,stat='], { encoding: 'utf8' });
  if (listed.error) throw listed.error;
  return listed.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length === 4)
    .map(([pid, parent, group, state]) => ({
      pid: Number(pid),
      parent: Number(parent),
      group: Number(group),
      exited: state.startsWith('Z'),
    }));
}

export function isRunning(pid) {
  return processTable().some((row) => row.pid === Number(pid) && !row.exited);
}

function claim(owned, leader, table) {
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of table) {
      if (owned.has(row.pid) || row.pid === process.pid) continue;
      if (row.group !== leader && !owned.has(row.parent)) continue;
      owned.add(row.pid);
      grew = true;
    }
  }
}

/** A group signal misses the scripts pnpm starts, each in a process group of its own. */
export function stopProcessTree(leader, timeout = PROCESS_TREE_STOP_TIMEOUT_MS) {
  // 0 and 1 would claim this process group or every orphan on the machine.
  if (!Number.isSafeInteger(leader) || leader <= 1 || leader === process.pid)
    throw new RangeError(`Process ${leader} cannot be stopped as a process-group leader.`);
  // Not seeded with the leader: once it has exited, an unrelated process can hold its number.
  const owned = new Set();
  const signalled = new Set();
  const deadline = Date.now() + timeout;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const table = processTable();
    claim(owned, leader, table);
    const running = table.filter((row) => owned.has(row.pid) && !row.exited);
    if (running.length === 0) return;
    if (Date.now() > deadline) {
      const pids = running.map((row) => row.pid).join(', ');
      throw new Error(`Processes ${pids} were still running ${timeout} ms after being killed.`);
    }
    for (const row of running) {
      // Once only: a second signal could reach a process that took over the number.
      if (signalled.has(row.pid)) continue;
      signalled.add(row.pid);
      try {
        process.kill(row.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    Atomics.wait(pause, 0, 0, PROCESS_TREE_POLL_MS);
  }
}

// GIT_PUSH_TIMEOUT_MS is the installer's push budget too, sized there from the
// slowest real hook. These hooks run shims: a whole case takes about 2 s under load.
export function push(repo, ...args) {
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', 'push', ...args], {
    cwd: repo.root,
    env: { ...repo.env, npm_config_offline: 'true', npm_config_update_notifier: 'false' },
    encoding: 'utf8',
    timeout: GIT_PUSH_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    detached: true,
  });
  if (result.error) {
    // The bound stops Git alone; its hook and the hook's tools are still running.
    if (result.pid) stopProcessTree(result.pid);
    if (result.error.code === 'ETIMEDOUT')
      throw new Error(`Git push fixture timed out after ${GIT_PUSH_TIMEOUT_MS} ms.`);
    throw result.error;
  }
  const hits = [
    ...result.stderr.matchAll(
      /^(?:\[([a-f0-9]+)\] )?(.+?):(\d+): banned token "((?:\\.|[^"\\])*)"/gm,
    ),
  ].map((match) => [match[1] ?? null, match[2], Number(match[3]), JSON.parse(`"${match[4]}"`)]);
  return { status: result.status, hits, diagnostic: result.stderr };
}

export function gates(repo) {
  const path = join(repo.root, '.git/lifecycle');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [];
}

export function received(target, branch) {
  const exists = target.git('for-each-ref', '--format=%(refname)', `refs/heads/${branch}`);
  return exists ? target.git('rev-list', '--count', branch) : null;
}

export function triangular(t, primary = 'trunk') {
  const repo = fixture(t);
  repo.git('branch', '-m', primary);
  const origin = remote(t, repo, 'origin');
  const fork = remote(t, repo, 'fork');
  repo.git('push', '-u', 'origin', primary);
  repo.git('push', 'fork', primary);
  const root = repo.git('rev-parse', 'HEAD');
  const colleague = repository(t);
  colleague.git('fetch', origin.root, primary);
  colleague.git('reset', '--hard', 'FETCH_HEAD');
  colleague.write('src/inherited.ts', BAD);
  colleague.commit();
  colleague.git('push', origin.root, `HEAD:${primary}`);
  repo.git('fetch', 'origin');
  repo.git('merge', '--ff-only', `origin/${primary}`);
  return { repo, fork, root };
}

export function installHooks(repo) {
  repo.write('.hooks/pre-push', readFileSync(join(ROOT, '.husky/pre-push'), 'utf8'));
  chmodSync(join(repo.root, '.hooks/pre-push'), 0o755);
  repo.git('config', 'core.hooksPath', '.hooks');
}
