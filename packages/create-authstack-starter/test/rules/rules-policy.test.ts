import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { templateContent } from '../../scripts/sync-template.mjs';
import { prune } from '../../src/prune/index.js';
import { renderRulesText } from '../../src/scaffold/rules-text.js';
import { TOOLING_MANIFEST } from '../support/fixture.js';
import { jobsOf, readWorkflow } from '../support/ci-workflow-helpers.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const roots: string[] = [];
const FILES = [
  '.husky/pre-commit',
  '.husky/pre-push',
  '.husky/commit-msg',
  '.github/workflows/ci.yml',
  '.github/workflows/trusted-scan.yml',
  'scripts/ci/gates.json',
  'package.json',
  'commitlint.config.cjs',
  'scripts/guardrails/policy.mjs',
];

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-rules-policy-'));
  roots.push(root);
  for (const path of FILES) {
    const bytes = await readFile(join(REPO_ROOT, path));
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), templateContent(path, bytes));
  }
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('generation-time rules policy', () => {
  it.each(['strict', 'standard'] as const)(
    'enumerates every enforcement point for %s',
    async (level) => {
      const root = await fixture();
      await prune(root, TOOLING_MANIFEST, ['email-password', 'alpha', 'beta'], [], level);
      const hooks = await Promise.all(
        ['pre-commit', 'pre-push', 'commit-msg'].map((name) =>
          readFile(join(root, '.husky', name), 'utf8'),
        ),
      );
      const gates = JSON.parse(await readFile(join(root, 'scripts/ci/gates.json'), 'utf8')) as {
        gates: { name: string }[];
      };
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const observed = {
        hooks,
        carriageReturns: hooks.some((hook) => hook.includes('\r')),
        gates: gates.gates.map((gate) => gate.name),
        jobs: Object.keys(jobsOf(readWorkflow(join(root, '.github/workflows/ci.yml')))),
        trusted: existsSync(join(root, '.github/workflows/trusted-scan.yml')),
        checkBans: manifest.scripts['check:bans'] ?? null,
        check: manifest.scripts.check,
      };
      const commitMessage =
        '#!/bin/sh\nset -e\nsh scripts/lib/require-package-manager.sh pnpm\npnpm exec commitlint --edit "$1"\nnode scripts/check-hard-bans.mjs --commit-msg "$1"\n';
      if (level === 'strict') {
        expect(observed).toEqual({
          hooks: [
            '#!/bin/sh\nset -e\nsh scripts/lib/require-package-manager.sh pnpm\npnpm exec lint-staged\nnode scripts/check-hard-bans.mjs --staged\n',
            '#!/bin/sh\nset -e\nsh scripts/lib/require-package-manager.sh pnpm\nnode scripts/check-hard-bans.mjs --push --hook "$1" "$2"\npnpm run lint && pnpm run typecheck && pnpm run test\n',
            commitMessage,
          ],
          carriageReturns: false,
          gates: [
            'Full-tree hard bans',
            'Package-manager inventory',
            'Workspace dependency check',
            'Colour contrast',
            'Lint',
            'Typecheck',
            'Unit and config tests',
            'Build',
            'Backend end-to-end',
          ],
          jobs: ['range-scan', 'quality', 'api'],
          trusted: true,
          checkBans: 'node scripts/check-hard-bans.mjs --staged',
          check: 'pnpm run check:bans && pnpm run lint && pnpm run typecheck',
        });
      } else {
        expect(observed).toEqual({
          hooks: [
            '#!/bin/sh\nset -e\nsh scripts/lib/require-package-manager.sh pnpm\npnpm exec lint-staged\n',
            '#!/bin/sh\nset -e\nsh scripts/lib/require-package-manager.sh pnpm\npnpm run lint && pnpm run typecheck && pnpm run test\n',
            commitMessage,
          ],
          carriageReturns: false,
          gates: [
            'Package-manager inventory',
            'Workspace dependency check',
            'Colour contrast',
            'Lint',
            'Typecheck',
            'Unit and config tests',
            'Build',
            'Backend end-to-end',
          ],
          jobs: ['quality', 'api'],
          trusted: false,
          checkBans: null,
          check: 'pnpm run lint && pnpm run typecheck',
        });
      }
    },
  );

  it('normalizes copied CRLF hook and workflow bodies to LF', async () => {
    const root = await fixture();
    for (const path of FILES.filter(
      (path) => path.startsWith('.husky/') || path.endsWith('.yml'),
    )) {
      const source = await readFile(join(root, path), 'utf8');
      await writeFile(join(root, path), source.replaceAll('\n', '\r\n'));
    }
    await prune(root, TOOLING_MANIFEST, ['email-password', 'alpha', 'beta'], [], 'strict');
    const contents = await Promise.all(
      FILES.slice(0, 5).map((path) => readFile(join(root, path), 'utf8')),
    );
    expect(contents.map((content) => content.includes('\r'))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it.each(['strict', 'standard'] as const)(
    'states at %s that the commit message hook runs and removes tool attribution',
    async (level) => {
      const root = await fixture();
      await prune(root, TOOLING_MANIFEST, ['email-password', 'alpha', 'beta'], [], level);
      const hook = await readFile(join(root, '.husky/commit-msg'), 'utf8');
      const withHooks = await renderRulesText({
        projectRoot: root,
        level,
        delivery: { hooks: true, actions: true },
      });
      const withoutHooks = await renderRulesText({
        projectRoot: root,
        level,
        delivery: { hooks: false, actions: true },
      });
      const statement =
        'The commit message hook checks this format. It also removes tool attribution trailers, such as a `Co-Authored-By` line that names a coding tool, and prints each line it removes.';
      const commitSection = (agents: string): string[] =>
        (agents.split('## Commit messages\n\n')[1]?.split('\n\n## ')[0] ?? '').split('\n');

      expect({
        hookStripsAttribution: hook
          .split('\n')
          .includes('node scripts/check-hard-bans.mjs --commit-msg "$1"'),
        stated: commitSection(withHooks.agents).includes(statement),
        statedWithoutHooks: commitSection(withoutHooks.agents).includes(statement),
        saysNothingRunsThePolicy: /nothing runs/i.test(withHooks.agents),
      }).toEqual({
        hookStripsAttribution: true,
        stated: true,
        statedWithoutHooks: false,
        saysNothingRunsThePolicy: false,
      });
    },
  );

  it('renders standard without an enforced ban list or ceiling and states the generation choice', async () => {
    const root = await fixture();
    await prune(root, TOOLING_MANIFEST, ['email-password', 'alpha', 'beta'], [], 'standard');
    const { agents } = await renderRulesText({
      projectRoot: root,
      level: 'standard',
      delivery: { hooks: true, actions: true },
    });
    expect({
      level: agents.includes('Rules level: standard.'),
      bannedList: agents.includes('Do not use these constructs.'),
      ceiling: agents.includes('Source file limit:'),
      inactive: agents.includes('The banned-construct scan and file length ceiling are off.'),
      generation: agents.includes(
        'The rules level was chosen at generation. Editing `.create-authstack-starter.json` does not switch it.',
      ),
      hardBanGate: agents.includes('| Full-tree hard bans |'),
    }).toEqual({
      level: true,
      bannedList: false,
      ceiling: false,
      inactive: true,
      generation: true,
      hardBanGate: false,
    });
  });
});
