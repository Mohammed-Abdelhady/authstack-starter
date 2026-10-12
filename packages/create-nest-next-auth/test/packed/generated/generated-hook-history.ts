import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect } from 'vitest';
import type { RulesPolicy } from '../../../src/types.js';
import { git, isolatedGit } from '../../support/answers-helpers.js';
import { boundedGitPush } from '../../support/bounded-git-push.js';
import { scaffold, type Packed } from '../packed-cli.js';

const DOM_TOKEN = 'inner' + 'HTML';
const SOURCE_PATH = 'backend/src/guardrail-probe.ts';
const CLEAN = 'export const guardrailProbe = 1;\n';

/**
 * Stands in for pnpm at the dispatch boundary: `pnpm run <script>` starts the
 * script's node command. Git, the hook and the scanner are real.
 */
function writeScriptRunner(project: string): string {
  const bin = join(project, '.git/gate-bin');
  mkdirSync(bin);
  const pnpm = join(bin, 'pnpm');
  writeFileSync(
    pnpm,
    `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const [verb, name] = process.argv.slice(2);
if (verb !== 'run') { console.error('Unexpected pnpm boundary call'); process.exit(2); }
const [program, ...args] = JSON.parse(readFileSync('package.json', 'utf8')).scripts[name].split(' ');
if (program !== 'node') { console.error('Unexpected gate script'); process.exit(2); }
process.exit(spawnSync(process.execPath, args, { stdio: 'inherit' }).status ?? 2);
`,
  );
  chmodSync(pnpm, 0o755);
  return bin;
}

/**
 * Pushes a branch whose history holds a banned token. Strict scans the push and
 * refuses it before any gate; standard has no push scan, so the gates run and
 * the branch lands.
 */
export function checkGeneratedHookHistory(packed: Packed, level: RulesPolicy = 'strict'): void {
  const { env } = isolatedGit(packed.workspace);
  const name = level === 'strict' ? 'guardrails-hook-history' : `guardrails-hook-history-${level}`;
  const generated = scaffold(packed, name, undefined, {
    git: true,
    env,
    flags: ['--rules', level],
  });
  expect(generated.status, `${generated.stdout}\n${generated.stderr}`).toBe(0);
  const project = join(packed.workspace, name);
  const remote = join(packed.workspace, `${name}.git`);
  git(['config', 'user.name', 'Fixture'], project, env);
  git(['config', 'user.email', 'fixture@example.test'], project, env);
  git(['branch', '-M', 'main'], project, env);
  git(['init', '--bare', '--initial-branch=main', remote], packed.workspace, env);
  git(['remote', 'add', 'origin', remote], project, env);
  const initial = boundedGitPush(['-u', 'origin', 'main'], project, env);
  expect(initial.status, initial.stderr).toBe(0);
  const baseline = git(['rev-parse', 'HEAD'], project, env).trim();

  // Lifecycle shims observe scan-before-gates without installing dependencies.
  const packagePath = join(project, 'package.json');
  const packageJson = JSON.parse(git(['show', 'HEAD:package.json'], project, env)) as {
    scripts: Record<string, string>;
  };
  for (const script of ['lint', 'typecheck', 'test']) {
    packageJson.scripts[script] = `node .git/guardrail-gate.mjs ${script}`;
  }
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(
    join(project, '.git/guardrail-gate.mjs'),
    "import { appendFileSync } from 'node:fs';\n" +
      "appendFileSync('.git/guardrail-gates', `${process.argv[2]}\\n`);\n",
  );
  writeFileSync(join(project, SOURCE_PATH), CLEAN + `host.${DOM_TOKEN} = value;\n`);
  git(['add', 'package.json', SOURCE_PATH], project, env);
  git(['commit', '-m', 'test: pre-hook local violation'], project, env);
  const offending = git(['rev-parse', 'HEAD'], project, env).trim();
  git(['switch', '-c', 'feat'], project, env);
  writeFileSync(join(project, 'backend/src/guardrail-child.ts'), CLEAN);
  git(['add', 'backend/src/guardrail-child.ts'], project, env);
  git(['commit', '-m', 'test: clean child'], project, env);
  const hook = join(project, '.git/hooks/pre-push');
  copyFileSync(join(project, '.husky/pre-push'), hook);
  chmodSync(hook, 0o755);

  const head = git(['rev-parse', 'HEAD'], project, env).trim();
  const pushEnv = {
    ...env,
    PATH: [writeScriptRunner(project), env.PATH ?? ''].join(delimiter),
  };

  const pushed = boundedGitPush(['origin', 'feat'], project, pushEnv);
  const hits = [
    ...pushed.stderr.matchAll(/^\[([a-f0-9]+)\] (.+?):(\d+): banned token "((?:\\.|[^"\\])*)"/gm),
  ].map((match) => [match[1], match[2], Number(match[3]), JSON.parse(`"${match[4]}"`)]);
  const gates = join(project, '.git/guardrail-gates');
  const observed = {
    status: pushed.status,
    hits,
    gates: existsSync(gates) ? readFileSync(gates, 'utf8') : '',
    refs: git(['for-each-ref', '--format=%(objectname) %(refname)'], remote, env).trim(),
  };
  if (level === 'strict') {
    expect(observed, pushed.stderr).toEqual({
      status: 1,
      hits: [[offending.slice(0, 7), SOURCE_PATH, 2, DOM_TOKEN]],
      gates: '',
      refs: `${baseline} refs/heads/main`,
    });
    return;
  }
  expect(observed, pushed.stderr).toEqual({
    status: 0,
    hits: [],
    gates: 'lint\ntypecheck\ntest\n',
    refs: `${head} refs/heads/feat\n${baseline} refs/heads/main`,
  });
}
