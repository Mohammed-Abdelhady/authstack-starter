import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, isolatedGit } from '../support/answers-helpers.js';

/** All git commands here target disposable fixtures with an explicit environment. */
export function seedRepository(root: string): NodeJS.ProcessEnv {
  mkdirSync(root, { recursive: true });
  const { env } = isolatedGit(root);
  git(['init', '--initial-branch=scratch', root], root, env);
  git(['config', 'user.name', 'Scratch User'], root, env);
  git(['config', 'user.email', 'scratch@example.test'], root, env);
  git(['config', 'core.bare', 'false'], root, env);
  writeFileSync(join(root, 'sentinel.txt'), 'caller data\n');
  git(['add', 'sentinel.txt'], root, env);
  git(['commit', '-m', 'test: seed scratch repository'], root, env);
  writeFileSync(join(root, 'sentinel.txt'), 'staged caller data\n');
  git(['add', 'sentinel.txt'], root, env);
  return env;
}

export function repositorySnapshot(
  root: string,
  env: NodeJS.ProcessEnv,
): {
  head: Buffer;
  branch: Buffer;
  index: Buffer;
  config: Buffer;
  bare: string;
} {
  const dotGit = join(root, '.git');
  return {
    head: readFileSync(join(dotGit, 'HEAD')),
    branch: readFileSync(join(dotGit, 'refs/heads/scratch')),
    index: readFileSync(join(dotGit, 'index')),
    config: readFileSync(join(dotGit, 'config')),
    bare: git(['config', '--local', '--get', 'core.bare'], root, env),
  };
}
