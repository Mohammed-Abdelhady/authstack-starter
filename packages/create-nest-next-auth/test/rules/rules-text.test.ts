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

function headingForEntry(markdown: string, entry: string | undefined): string | undefined {
  let heading: string | undefined;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('### ')) heading = line.slice(4);
    if (entry !== undefined && line === entry) return heading;
  }
  return undefined;
}

function sectionBody(markdown: string, heading: string): string | undefined {
  return markdown.split(`## ${heading}\n\n`)[1]?.split('\n\n## ')[0];
}

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
  it('renders policy, commit, gate, and package-manager facts from project files', async () => {
    const projectRoot = await projectFixture();
    const rendered = await renderRulesText({
      projectRoot,
      level: 'strict',
      delivery: { hooks: true, actions: true },
    });
    const facts = rendered.agents
      .split('\n')
      .filter((line) =>
        /^(?:Rules level:|Source file limit:|Package manager:|- Types:|- Scopes:|- Subject limit:|\| Fixture check \||\| Second check \|)/.test(
          line,
        ),
      );

    expect(facts).toEqual([
      'Rules level: strict.',
      'Source file limit: 350 lines.',
      '- Types: feat, fix, docs, style, refactor, perf, test, chore, revert',
      '- Scopes: backend, frontend, shared, packages, root, docs, husky, lint-staged',
      '- Subject limit: 100 characters.',
      '| Fixture check | `node scripts/check.mjs --all` |',
      '| Second check | `pnpm --filter backend run test:e2e` |',
      'Package manager: pnpm 12.6.0.',
    ]);
    const code = sectionBody(rendered.agents, 'Code') ?? '';
    const typeLintFact = [
      "The workspace ESLint configs reject TypeScript's `",
      'a',
      'ny',
      '` type.',
    ].join('');
    expect(code.split('\n')).toContain(typeLintFact);
    expect(rendered.agents).toContain('.github/workflows');
    expect(sectionBody(rendered.agents, 'What enforces this')?.split('\n')).toHaveLength(3);
    expect(rendered.claude).toBe('See AGENTS.md for project rules.\n');
  });

  it('prints a changed policy token on its own rendered line', async () => {
    const policy = await readFile(join(REPOSITORY_ROOT, 'scripts/guardrails/policy.mjs'), 'utf8');
    const sourceToken = /token: '([^']+)'/.exec(policy)?.[1];
    if (sourceToken === undefined) throw new Error('The policy fixture has no token.');
    const addedConstructs = [
      "  { token: 'fixtureTypeToken', reason: RULE_REASONS.TYPE },",
      "  { token: 'fixtureSuppressionToken', reason: RULE_REASONS.SUPPRESSION },",
      "  { token: 'fixtureBypassToken', reason: RULE_REASONS.BYPASS },",
    ].join('\n');
    const changedPolicy = policy
      .replace(`token: '${sourceToken}'`, "token: 'fixtureForbiddenToken'")
      .replace('BANNED_CONSTRUCTS.push(', `BANNED_CONSTRUCTS.push(\n${addedConstructs}`);
    const projectRoot = await projectFixture({ policy: changedPolicy });
    const rendered = await renderRulesText({
      projectRoot,
      level: 'strict',
      delivery: { hooks: true, actions: true },
    });
    const line = rendered.agents
      .split('\n')
      .find((candidate) => candidate === '- `fixtureForbiddenToken`');

    expect(line).toBe('- `fixtureForbiddenToken`');
    expect(headingForEntry(rendered.agents, line)).toBe('Markup injection');
    expect(headingForEntry(rendered.agents, '- `fixtureTypeToken`')).toBe('Type escapes');
    expect(headingForEntry(rendered.agents, '- `fixtureSuppressionToken`')).toBe('Hidden checks');
    expect(headingForEntry(rendered.agents, '- `fixtureBypassToken`')).toBe('Gate bypass flags');
  });

  it('groups policy tokens by first-seen reason and sorts tokens inside each group', async () => {
    const policy = await readFile(join(REPOSITORY_ROOT, 'scripts/guardrails/policy.mjs'), 'utf8');
    const unsortedTokensPolicy = policy.replace(
      'BANNED_CONSTRUCTS.push(',
      [
        'BANNED_CONSTRUCTS.push(',
        "  { token: 'zetaFixtureToken', reason: RULE_REASONS.DOM },",
        "  { token: 'alphaFixtureToken', reason: RULE_REASONS.DOM },",
      ].join('\n'),
    );
    const projectRoot = await projectFixture({ policy: unsortedTokensPolicy });
    const rendered = await renderRulesText({
      projectRoot,
      level: 'strict',
      delivery: { hooks: true, actions: true },
    });
    const lines = rendered.agents.split('\n');
    const groupHeadings = lines.filter((line) => line.startsWith('### '));

    expect(groupHeadings).toEqual([
      '### Markup injection',
      '### Hidden checks',
      '### Type escapes',
      '### Gate bypass flags',
    ]);
    expect(lines.indexOf('- `alphaFixtureToken`')).toBeLessThan(
      lines.indexOf('- `zetaFixtureToken`'),
    );
    expect(lines).toContain('- inline eslint configuration');
    expect(lines).not.toContain('- `inline eslint configuration`');
    expect(headingForEntry(rendered.agents, '- inline eslint configuration')).toBe('Hidden checks');
  });

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

  it('lists only workspace folders present in the generated project', async () => {
    const projectRoot = await projectFixture({ workspaces: ['backend', 'shared/core'] });
    const rendered = await renderRulesText({
      projectRoot,
      level: 'strict',
      delivery: { hooks: true, actions: true },
    });
    const where = sectionBody(rendered.agents, 'Where things are');
    const locations = where?.split('\n').map((line) => /^- `([^`]+)`/.exec(line)?.[1]);

    expect(locations).toEqual(['backend', 'shared/core', 'scripts/guardrails/policy.mjs']);
    expect(where?.split('\n')).toContain(
      '- `scripts/guardrails/policy.mjs`: Change the policy here. AGENTS.md is a snapshot rendered at scaffolding time. Later policy changes do not update it.',
    );
  });

  it('explains that standard still loads the policy file and needs strict regeneration for the scan', async () => {
    const projectRoot = await projectFixture();
    const rendered = await renderRulesText({
      projectRoot,
      level: 'standard',
      delivery: { hooks: true, actions: true },
    });

    expect(sectionBody(rendered.agents, 'Where things are')?.split('\n')).toContain(
      '- `scripts/guardrails/policy.mjs`: `scripts/check-hard-bans.mjs --commit-msg` and `scripts/ci.mjs` load this file, so keep it. The banned-construct scan and file length ceiling it defines are off at the standard rules level. Generate again with strict to turn them on.',
    );
  });

  it('omits the type lint fact if one shipped workspace config does not set the rule to error', async () => {
    const projectRoot = await projectFixture({
      explicitRuleSeverity: 'off',
      explicitRuleWorkspace: 'backend',
    });
    const rendered = await renderRulesText({
      projectRoot,
      level: 'strict',
      delivery: { hooks: true, actions: true },
    });

    const code = sectionBody(rendered.agents, 'Code') ?? '';
    expect(code.match(/^The workspace ESLint configs .+$/gm)).toBeNull();
  });

  it('does not claim unavailable delivery paths enforce the rules', async () => {
    const projectRoot = await projectFixture();
    const rendered = await renderRulesText({
      projectRoot,
      level: 'strict',
      delivery: { hooks: false, actions: false },
    });

    const enforcement = sectionBody(rendered.agents, 'What enforces this');
    expect(enforcement?.split('\n')).toHaveLength(3);
    expect(rendered.agents).not.toContain('.github/workflows');
  });

  it('states that an empty gate list has no checks', async () => {
    const projectRoot = await projectFixture({ gates: '{"gates":[]}' });
    const rendered = await renderRulesText({
      projectRoot,
      level: 'strict',
      delivery: { hooks: true, actions: true },
    });

    expect(rendered.agents.split('\n')).toContain('No checks are listed in the gate file.');
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
