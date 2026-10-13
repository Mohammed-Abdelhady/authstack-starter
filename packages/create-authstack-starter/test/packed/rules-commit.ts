import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect } from 'vitest';
import { ADD_RULES_HUSKY_ENTRY } from '../../src/constants/rules.js';
import type { RulesPolicy } from '../../src/types.js';
import { git, isolatedGit } from '../support/answers-helpers.js';
import { linkDependencies } from '../support/combination-helpers.js';
import { scaffold, type Packed } from './packed-cli.js';

const PROBE_PATH = 'backend/src/rules-level-probe.ts';
const DOM_TOKEN = 'inner' + 'HTML';

/** Only pnpm dispatch is substituted. Git, Husky, lint-staged, ESLint and commitlint are real. */
export async function checkRulesCommit(packed: Packed, level: RulesPolicy): Promise<void> {
  const { env } = isolatedGit(packed.workspace);
  const generated = scaffold(packed, `rules-commit-${level}`, undefined, {
    git: true,
    env,
    flags: ['--rules', level],
  });
  expect(generated.status, `${generated.stdout}\n${generated.stderr}`).toBe(0);
  const project = join(packed.workspace, `rules-commit-${level}`);
  linkDependencies(project);
  git(['config', 'user.name', 'Fixture'], project, env);
  git(['config', 'user.email', 'fixture@example.test'], project, env);
  const bin = join(project, '.git/rules-bin');
  mkdirSync(bin);
  const pnpm = join(bin, 'pnpm');
  writeFileSync(
    pnpm,
    `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('12.6.0'); process.exit(0); }
let directory = process.cwd();
if (args[0] === '--filter') { directory = join(directory, args[1]); args.splice(0, 2); }
if (args.shift() !== 'exec') { console.error('Unexpected pnpm boundary call'); process.exit(2); }
const tool = args.shift();
const result = spawnSync(join(directory, 'node_modules/.bin', tool), args, { cwd: directory, env: process.env, stdio: 'inherit' });
process.exit(result.status ?? 2);
`,
  );
  chmodSync(pnpm, 0o755);
  const hookEnv = {
    ...env,
    PATH: [bin, join(project, 'node_modules/.bin'), env.PATH ?? ''].join(delimiter),
  };
  const activate = spawnSync(process.execPath, [ADD_RULES_HUSKY_ENTRY], {
    cwd: project,
    env: hookEnv,
    encoding: 'utf8',
  });
  expect(activate.status, `${activate.stdout}\n${activate.stderr}`).toBe(0);
  const head = git(['rev-parse', 'HEAD'], project, env).trim();
  writeFileSync(join(project, PROBE_PATH), `export const rulesLevelProbe = '${DOM_TOKEN}';\n`);
  git(['add', PROBE_PATH], project, env);
  const committed = spawnSync('git', ['commit', '-m', 'test: rules level probe'], {
    cwd: project,
    env: hookEnv,
    encoding: 'utf8',
  });
  const observed = {
    status: committed.status,
    headMoved: git(['rev-parse', 'HEAD'], project, env).trim() !== head,
    commitCount: git(['rev-list', '--count', 'HEAD'], project, env).trim(),
    scanHit: `${committed.stdout}${committed.stderr}`.includes(`banned token "${DOM_TOKEN}"`),
  };
  if (level === 'strict') {
    expect(observed, `${committed.stdout}\n${committed.stderr}`).toEqual({
      status: 1,
      headMoved: false,
      commitCount: '1',
      scanHit: true,
    });
  } else {
    expect(observed, `${committed.stdout}\n${committed.stderr}`).toEqual({
      status: 0,
      headMoved: true,
      commitCount: '2',
      scanHit: false,
    });
    const committedProbe = git(['show', `HEAD:${PROBE_PATH}`], project, env);
    expect(committedProbe).toBe(`export const rulesLevelProbe = '${DOM_TOKEN}';\n`);
  }
  // Leave a valid staged source for the commit-message hook's independent check.
  writeFileSync(join(project, PROBE_PATH), 'export const rulesLevelProbe = 1;\n');
  git(['add', PROBE_PATH], project, env);
  const beforeBadMessage = git(['rev-parse', 'HEAD'], project, env).trim();
  const rejected = spawnSync('git', ['commit', '-m', 'invalid message'], {
    cwd: project,
    env: hookEnv,
    encoding: 'utf8',
  });
  expect({
    status: rejected.status,
    headMoved: git(['rev-parse', 'HEAD'], project, env).trim() !== beforeBadMessage,
  }).toEqual({ status: 1, headMoved: false });
  // Accessing the generated scanner here also proves commit-msg can import its retained files.
  readFileSync(join(project, 'scripts/check-hard-bans.mjs'));
}
