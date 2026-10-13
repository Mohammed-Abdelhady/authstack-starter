import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { planRules, applyRules } from '../../src/add-rules/plan.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it.each(['pnpm', 'npm'] as const)(
  'adds only existing gates to %s and replays without writes',
  async (manager) => {
    const root = await mkdtemp(join(tmpdir(), 'add-rules-'));
    roots.push(root);
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ packageManager: `${manager}@12.6.0`, scripts: { lint: 'echo ok' } }),
    );
    const plan = await planRules(root, 'strict', join(import.meta.dirname, '../../../..'));
    expect(plan.blockers).toEqual([]);
    await applyRules(plan);
    const config = JSON.parse(await readFile(join(root, 'scripts/ci/gates.json'), 'utf8')) as {
      gates: { name: string; group: string; command: string; args: string[] }[];
    };
    expect(config.gates).toEqual([
      {
        name: 'Full-tree hard bans',
        group: 'quality',
        command: 'node',
        args: ['scripts/check-hard-bans.mjs', '--all'],
      },
      { name: 'Lint', group: 'quality', command: manager, args: ['run', 'lint'] },
    ]);
    expect(
      (await planRules(root, 'strict', join(import.meta.dirname, '../../../..'))).files,
    ).toEqual([]);
  },
);
