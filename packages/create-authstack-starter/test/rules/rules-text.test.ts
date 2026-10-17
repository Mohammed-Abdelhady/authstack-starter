import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { templateContent } from '../../scripts/sync-template.mjs';
import { stripFeatureMarkers } from '../../src/prune/markers.js';
import { renderRulesText } from '../../src/scaffold/rules-text.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const roots: string[] = [];

interface FixtureFiles {
  policy?: string;
  missingPolicy?: boolean;
  gates?: string;
  packageManager?: string;
  workspaces?: string[];
  explicitRuleSeverity?: 'error' | 'off';
  explicitRuleWorkspace?: string;
}

const DEFAULT_WORKSPACES = ['backend', 'frontend', 'shared/core', 'shared/sdk'];

/** What a web project keeps of a tooling file: the lines marked for a mobile app go. */
function forWebProject(path: string, content: string): string {
  const mobileIds = new Set(['native-core', 'native-expo']);
  return stripFeatureMarkers(content, path, new Set(), mobileIds).content;
}

async function projectFixture(overrides: FixtureFiles = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-rules-'));
  roots.push(root);
  const policySource =
    overrides.policy ??
    (await readFile(join(REPOSITORY_ROOT, 'scripts/guardrails/policy.mjs'), 'utf8'));
  const policy = forWebProject(
    'scripts/guardrails/policy.mjs',
    templateContent('scripts/guardrails/policy.mjs', Buffer.from(policySource)).toString(),
  );
  const commitlintSource = await readFile(join(REPOSITORY_ROOT, 'commitlint.config.cjs'), 'utf8');
  const commitlint = forWebProject(
    'commitlint.config.cjs',
    templateContent('commitlint.config.cjs', Buffer.from(commitlintSource)).toString(),
  );
  const gates =
    overrides.gates ??
    JSON.stringify({
      gates: [
        { name: 'Fixture check', command: 'node', args: ['scripts/check.mjs', '--all'] },
        {
          name: 'Second check',
          command: 'pnpm',
          args: ['--filter', 'backend', 'run', 'test:e2e'],
        },
      ],
    });
  const packageManager = overrides.packageManager ?? 'pnpm@12.6.0';
  const files: Record<string, string> = {
    'scripts/ci/gates.json': `${gates}\n`,
    'commitlint.config.cjs': commitlint,
    'package.json': `${JSON.stringify({ packageManager }, null, 2)}\n`,
    'pnpm-workspace.yaml': `packages:\n${(overrides.workspaces ?? DEFAULT_WORKSPACES)
      .map((workspace) => `  - ${workspace}`)
      .join('\n')}\n`,
  };
  if (!overrides.missingPolicy) files['scripts/guardrails/policy.mjs'] = policy;

  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, 'utf8');
  }

  for (const workspace of overrides.workspaces ?? DEFAULT_WORKSPACES) {
    const sourceManifest = join(REPOSITORY_ROOT, workspace, 'package.json');
    const sourceConfig = join(REPOSITORY_ROOT, workspace, 'eslint.config.mjs');
    const manifestPath = join(root, workspace, 'package.json');
    const configPath = join(root, workspace, 'eslint.config.mjs');
    await mkdir(dirname(manifestPath), { recursive: true });
    const manifest = await readFile(sourceManifest, 'utf8');
    const config = await readFile(sourceConfig, 'utf8');
    const shouldOverrideRule =
      overrides.explicitRuleSeverity !== undefined &&
      (overrides.explicitRuleWorkspace === undefined ||
        overrides.explicitRuleWorkspace === workspace);
    const configured = shouldOverrideRule
      ? config.replace(
          /('(?:@typescript-eslint\/)?no-explicit-[^']+':\s*)'error'/,
          `$1'${overrides.explicitRuleSeverity}'`,
        )
      : config;
    if (configured === config && shouldOverrideRule) {
      throw new Error(`The ${workspace} ESLint config has no explicit-type rule.`);
    }
    await writeFile(manifestPath, manifest, 'utf8');
    await writeFile(configPath, configured, 'utf8');
  }

  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('renderRulesText', () => {
  it('rejects a policy reason with no hand-written instruction sentence', async () => {
    const policy = await readFile(join(REPOSITORY_ROOT, 'scripts/guardrails/policy.mjs'), 'utf8');
    const reason = 'Fixture reason with no template sentence.';
    const changedPolicy = policy.replace(/SUPPRESSION: '[^']+'/, `SUPPRESSION: '${reason}'`);
    const projectRoot = await projectFixture({ policy: changedPolicy });

    await expect(
      renderRulesText({
        projectRoot,
        level: 'strict',
        delivery: { hooks: true, actions: true },
      }),
    ).rejects.toThrow(reason);
  });

  it('rejects an invalid gate list before it can describe checks', async () => {
    const projectRoot = await projectFixture({ gates: '{"gates":null}' });

    await expect(
      renderRulesText({
        projectRoot,
        level: 'strict',
        delivery: { hooks: true, actions: true },
      }),
    ).rejects.toThrow('scripts/ci/gates.json must contain a gates array');
  });

  it('rejects a missing policy instead of inventing rule facts', async () => {
    const projectRoot = await projectFixture({ missingPolicy: true });

    await expect(
      renderRulesText({
        projectRoot,
        level: 'strict',
        delivery: { hooks: true, actions: true },
      }),
    ).rejects.toThrow('scripts/guardrails/policy.mjs could not be loaded');
  });
});
