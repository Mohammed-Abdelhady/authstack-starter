import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRunning, stopProcessTree } from '../../lib/process-tree.mjs';
import { GIT_PUSH_TIMEOUT_MS } from '../policy.mjs';
import { installChecker, repository } from '../test-repository.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const TOKEN = 'inner' + 'HTML';
export const CLEAN = 'export const value = 1;\n';
export const BAD = `node.${TOKEN} = value;\n`;
export const GATES = ['lint', 'typecheck', 'test'];
export const ZERO = '0'.repeat(40);
export { isRunning };

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
