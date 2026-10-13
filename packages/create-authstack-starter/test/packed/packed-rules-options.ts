import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { Packed } from './packed-cli.js';

export function rulesOptionCases(getPacked: () => Packed): void {
  it.each([
    { flags: [], expected: 'strict', name: 'default' },
    { flags: ['--rules', 'strict'], expected: 'strict', name: 'strict' },
    { flags: ['--rules', 'standard'], expected: 'standard', name: 'standard' },
  ])(
    'shows $expected in the packed dry run without creating a tree',
    ({ flags, expected, name }) => {
      const packed = getPacked();
      const target = join(packed.workspace, `dry-rules-${name}`);
      const result = spawnSync(
        process.execPath,
        [packed.cli, target, '--yes', '--dry-run', ...flags],
        {
          cwd: packed.workspace,
          encoding: 'utf8',
        },
      );
      expect({
        status: result.status,
        summary: `${result.stdout}${result.stderr}`.includes(`Rules      ${expected}`),
        written: existsSync(target),
      }).toEqual({ status: 0, summary: true, written: false });
    },
  );

  it.each([
    { flags: ['--rules', 'loose'], name: 'invalid' },
    { flags: ['--rules', ''], name: 'empty' },
    { flags: ['--rules'], name: 'missing' },
  ])('rejects $name rules as a usage error before any prompt', ({ flags, name }) => {
    const packed = getPacked();
    const target = join(packed.workspace, `bad-rules-${name}`);
    const result = spawnSync(process.execPath, [packed.cli, target, ...flags], {
      cwd: packed.workspace,
      encoding: 'utf8',
    });
    expect({
      status: result.status,
      written: existsSync(target),
      attemptedPrompt: `${result.stdout}${result.stderr}`.includes('No terminal to prompt'),
    }).toEqual({ status: 2, written: false, attemptedPrompt: false });
  });
}
