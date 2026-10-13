import { resolve } from 'node:path';
import {
  DEFAULT_COMMIT_MESSAGE,
  GIT_FALLBACK_EMAIL,
  GIT_FALLBACK_NAME,
} from '../constants/index.js';
import { lastLines, run } from '../utils/exec.js';

export interface GitResult {
  ok: boolean;
  reason?: string;
  enclosingWorkTree?: string;
}

async function hasIdentity(root: string): Promise<boolean> {
  const name = await run('git', ['config', '--get', 'user.name'], root);
  const email = await run('git', ['config', '--get', 'user.email'], root);
  return name.code === 0 && email.code === 0;
}

/**
 * Creates the repository and the first commit. Runs before pnpm install so the
 * project's husky hooks are not installed yet and cannot reject this commit.
 */
export async function initRepository(root: string): Promise<GitResult> {
  const enclosing = await run('git', ['rev-parse', '--show-toplevel'], root);
  const context =
    enclosing.code === 0 ? { enclosingWorkTree: enclosing.stdout.replace(/\n$/, '') } : {};
  const init = await run('git', ['init', '--', resolve(root)], root);
  if (init.code !== 0) {
    return { ...context, ok: false, reason: lastLines(init.stderr, 2) || 'git init failed' };
  }

  const add = await run('git', ['add', '-A'], root);
  if (add.code !== 0) return { ...context, ok: false, reason: lastLines(add.stderr, 2) };

  const identity = (await hasIdentity(root))
    ? []
    : ['-c', `user.name=${GIT_FALLBACK_NAME}`, '-c', `user.email=${GIT_FALLBACK_EMAIL}`];

  const commit = await run('git', [...identity, 'commit', '-m', DEFAULT_COMMIT_MESSAGE], root);
  if (commit.code !== 0) return { ...context, ok: false, reason: lastLines(commit.stderr, 2) };

  return { ...context, ok: true };
}
