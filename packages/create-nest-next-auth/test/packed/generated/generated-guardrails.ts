import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { git, isolatedGit } from '../../support/answers-helpers.js';
import { scaffold, type Packed } from '../packed-cli.js';

const DOM_TOKEN = 'inner' + 'HTML';

export function checkGeneratedGuardrails(packed: Packed): void {
  const { env } = isolatedGit(packed.workspace);
  const generated = scaffold(packed, 'guardrails-default', undefined, { git: true, env });
  expect(generated.status, `${generated.stdout}\n${generated.stderr}`).toBe(0);
  const project = join(packed.workspace, 'guardrails-default');
  expect(existsSync(join(project, 'scripts/guardrails/git/git-environment.mjs'))).toBe(true);
  expect(git(['rev-list', '--count', 'HEAD'], project, env).trim()).toBe('1');
  const result = spawnSync(process.execPath, ['scripts/check-hard-bans.mjs', '--all'], {
    cwd: project,
    env,
    encoding: 'utf8',
  });
  const lines = `${result.stdout}${result.stderr}`.trim().split('\n').filter(Boolean);
  expect({ status: result.status, lines }).toEqual({ status: 0, lines: [] });

  const generatedPackage = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(generatedPackage.scripts['test:config:all']).toBeUndefined();
  expect(existsSync(join(project, 'scripts/guardrails/git/round8-hook-fixture.mjs'))).toBe(false);
  const docs = readFileSync(join(project, 'docs/reference/code-quality.md'), 'utf8');
  expect(
    /test:config:all|\.slow\.mjs|check-hard-bans\.test\.mjs|eslint-policy\.test\.mjs|CLI combination tests|packages\/\*\/src|mobile\/|Test fixtures and policy listing|Scopes:|Playwright|test:e2e -w frontend|frontend\/e2e/i.test(
      docs,
    ),
  ).toBe(false);

  writeFileSync(
    join(project, 'scripts/guardrails/scanner/check-hard-bans.test.mjs'),
    `const host = {}; host.${DOM_TOKEN} = 'x';\n`,
  );
  const added = spawnSync(process.execPath, ['scripts/check-hard-bans.mjs', '--all'], {
    cwd: project,
    env,
    encoding: 'utf8',
  });
  const ownHits = added.stderr
    .split('\n')
    .filter((line) => line.startsWith('scripts/guardrails/scanner/check-hard-bans.test.mjs:'));
  expect(
    ownHits.map((line) =>
      line
        .match(
          /^scripts\/guardrails\/scanner\/check-hard-bans\.test\.mjs:(\d+): banned token "([^"]+)"/,
        )
        ?.slice(1),
    ),
  ).toEqual([['1', DOM_TOKEN]]);
}
