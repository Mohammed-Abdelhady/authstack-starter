import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { expect, it } from 'vitest';
import { docReferences } from '../../src/prune/docs.js';
import { findDanglingReferences } from '../../src/prune/references.js';
import { readAnswersRecord } from '../../src/scaffold/answers.js';
import { scaffold, type Packed } from './packed-cli.js';
import { checkRulesCommit } from './rules-commit.js';
import { rulesOptionCases } from './packed-rules-options.js';
import { rulesContractCases } from './packed-rules-contracts.js';

export function rulesLevelCases(getPacked: () => Packed): void {
  rulesOptionCases(getPacked);
  rulesContractCases(getPacked);

  it('writes standard answers and removes its workflow without dangling references', async () => {
    const packed = getPacked();
    const result = scaffold(packed, 'rules-standard', undefined, {
      flags: ['--rules', 'standard'],
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const project = join(packed.workspace, 'rules-standard');
    const record = await readAnswersRecord(project);
    expect(record.rules).toEqual({ policy: 'standard' });
    expect(
      docReferences(
        'docs/reference/code-quality.md',
        readFileSync(join(project, 'docs/reference/code-quality.md'), 'utf8'),
      ),
    ).toEqual([]);
    expect(
      readFileSync(join(project, 'docs/README.md'), 'utf8')
        .split('\n')
        .find((line) => line.startsWith('- [Code quality]')),
    ).toBe(
      '- [Code quality](reference/code-quality.md): Local lint, format, hooks, and tests on push.',
    );
    expect(await findDanglingReferences(project, ['.github/workflows/trusted-scan.yml'])).toEqual(
      [],
    );
    const configPaths = ['backend', 'frontend', 'shared/core', 'shared/sdk'];
    expect(
      configPaths.map((path) => {
        const config = readFileSync(join(project, path, 'eslint.config.mjs'), 'utf8');
        return {
          inline: config.includes('noInlineConfig: true'),
          explicit: config.includes('no-explicit-' + 'a' + "ny': 'error'"),
        };
      }),
    ).toEqual([
      { inline: true, explicit: true },
      { inline: true, explicit: true },
      { inline: true, explicit: true },
      { inline: true, explicit: true },
    ]);
  });

  it.each(['strict', 'standard'] as const)(
    'commits the same banned probe only under standard, using %s hooks',
    async (level) => {
      await checkRulesCommit(getPacked(), level);
    },
  );

  it.each(['copy', 'name'] as const)(
    'reports the retained tree after a %s failure and refuses the rerun',
    (failure) => {
      const packed = getPacked();
      const packageRoot = join(packed.workspace, `broken-${failure}-package`);
      cpSync(join(packed.workspace, 'package'), packageRoot, { recursive: true });
      const template = join(packageRoot, 'template');
      if (failure === 'copy') {
        mkdirSync(join(template, '.gitignore'));
        writeFileSync(join(template, '.gitignore/occupied'), 'fixture\n');
      } else {
        writeFileSync(join(template, 'package.json'), 'not JSON\n');
      }
      const target = join(packed.workspace, `broken-${failure}-project`);
      const invoke = (): ReturnType<typeof spawnSync> =>
        spawnSync(
          process.execPath,
          [join(packageRoot, 'dist/index.js'), target, '--yes', '--no-install', '--no-git'],
          {
            cwd: packed.workspace,
            env: {
              ...process.env,
              PATH: [packed.pnpmDirectory, process.env.PATH ?? ''].join(delimiter),
            },
            encoding: 'utf8',
          },
        );
      const result = invoke();
      expect({
        status: result.status,
        retained: existsSync(target),
        notice: `${result.stdout}${result.stderr}`.includes(
          `Left the tree at ${target} so you can inspect it.`,
        ),
      }).toEqual({ status: 1, retained: true, notice: true });
      const rerun = invoke();
      expect({
        status: rerun.status,
        refused: `${rerun.stdout}${rerun.stderr}`.includes('exists and is not empty'),
      }).toEqual({ status: 2, refused: true });
    },
  );
}
