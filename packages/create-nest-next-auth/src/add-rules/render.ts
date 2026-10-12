import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { parseDocument } from 'yaml';
import { isRecord } from '../manifest/read.js';
import { RULES_POLICY } from '../constants/index.js';
import {
  ADD_RULES_ANY_SCOPE,
  ADD_RULES_SCRIPT_NAMES,
  RULES_GATES_PATH,
  RULES_COMMIT_CONFIG,
  RULES_STAGED_CONFIG,
  RULES_CI_ENTRY,
  RULES_HOOK_PATHS,
  RULES_SCAN_GATE,
  RULES_SCANNER_ENTRY,
  RULES_TRUSTED_WORKFLOW_PATH,
  RULES_WORKFLOW_PATH,
} from '../constants/rules.js';
import { ceilingFolders, readCeilingPattern } from './ceiling.js';
import { hasProjectScript } from './scripts.js';
import { withoutMarkerComments } from '../prune/markers.js';
import { pruneRules } from '../prune/rules.js';
import { renderRulesText } from '../scaffold/rules-text.js';
import { specializeCeilingText } from './ceiling.js';
import type { RulesPolicy } from '../types.js';
import type { RulesFile, RulesLayout, RulesIntegration } from '../types/add-rules.js';

async function moduleFiles(template: string): Promise<RulesFile[]> {
  const files = new Map<string, string>();
  const queue = [RULES_SCANNER_ENTRY, RULES_CI_ENTRY];
  for (const path of queue) {
    if (files.has(path)) continue;
    const content = withoutMarkerComments(await readFile(join(template, path), 'utf8'), path);
    files.set(path, content);
    for (const match of content.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))
      queue.push(posix.normalize(posix.join(posix.dirname(path), match[1])));
  }
  return [...files].map(([path, content]) => ({ path, content }));
}

/** Scopes name this template's folders, so another project's commit check takes any scope. */
function withoutScopeList(source: string): string {
  const stripped = source.replace(
    /[\t ]*'scope-enum':\s*\[[^\]]*\[[^\]]*\]\s*,?\s*\],?[\t ]*(?:\r?\n)?/,
    '',
  );
  if (stripped.includes('scope-enum')) throw new Error('Invalid bundled commit configuration.');
  return stripped;
}

function workflow(source: string, layout: RulesLayout, trusted: boolean): string {
  const document = parseDocument(source, { uniqueKeys: true });
  document.deleteIn(['on', trusted ? 'pull_request_target' : 'pull_request', 'branches']);
  if (!trusted) document.deleteIn(['on', 'push', 'branches']);
  document.deleteIn(['jobs', 'installer']);
  const value: unknown = document.toJS();
  const jobs: unknown = isRecord(value) ? value.jobs : undefined;
  if (!isRecord(jobs)) throw new Error('Invalid bundled workflow.');
  for (const job of Object.values(jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) throw new Error('Invalid bundled job.');
    job.steps = job.steps.filter((step: unknown) => {
      if (!isRecord(step)) return false;
      if (typeof step.uses === 'string' && step.uses.startsWith('actions/setup-node@'))
        step.with = { 'node-version': '22' };
      if (
        step.id === 'mongo' ||
        (typeof step.uses === 'string' && step.uses.startsWith('actions/cache@'))
      )
        return false;
      if (typeof step.uses === 'string' && step.uses.startsWith('pnpm/action-setup@')) {
        if (layout.manager !== 'pnpm') return false;
        step.with = {
          version: layout.version === 'not pinned' ? '12.6.0' : layout.version,
          run_install: false,
        };
      }
      return true;
    });
  }
  document.set('jobs', jobs);
  return document.toString();
}

export async function renderIntegration(
  template: string,
  staging: string,
  layout: RulesLayout,
  level: RulesPolicy,
  root: string,
): Promise<RulesIntegration> {
  const original: unknown = JSON.parse(await readFile(join(template, RULES_GATES_PATH), 'utf8'));
  if (!isRecord(original) || !Array.isArray(original.gates))
    throw new Error('Invalid bundled gates.');
  // Level handling stays with generated projects. The staging tree contains only bundled files.
  await pruneRules(staging, level);
  const gatesValue: unknown = JSON.parse(await readFile(join(staging, RULES_GATES_PATH), 'utf8'));
  if (!isRecord(gatesValue) || !Array.isArray(gatesValue.gates))
    throw new Error('Invalid bundled gates.');
  const gates = gatesValue.gates
    .filter(
      (gate: unknown) =>
        isRecord(gate) &&
        (gate.name === RULES_SCAN_GATE ||
          (gate.command === 'pnpm' &&
            Array.isArray(gate.args) &&
            ((gate.args.length === 2 &&
              gate.args[0] === 'run' &&
              typeof gate.args[1] === 'string' &&
              ADD_RULES_SCRIPT_NAMES.includes(
                gate.args[1] as (typeof ADD_RULES_SCRIPT_NAMES)[number],
              ) &&
              hasProjectScript(layout.manifest, gate.args[1])) ||
              (gate.args.length === 1 &&
                gate.args[0] === 'test' &&
                hasProjectScript(layout.manifest, 'test'))))),
    )
    .map((entry: unknown) => {
      if (!isRecord(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.args))
        throw new Error('Invalid gate.');
      return {
        name: entry.name,
        group: 'quality',
        command: entry.command === 'pnpm' ? layout.manager : 'node',
        args:
          entry.args[0] === 'test'
            ? ['run', 'test']
            : entry.args.filter((arg): arg is string => typeof arg === 'string'),
      };
    });
  const files = await moduleFiles(template);
  files.push({
    path: RULES_GATES_PATH,
    content: `${JSON.stringify({ install: { name: 'Install dependencies', command: layout.manager, args: layout.manager === 'pnpm' ? ['install', '--frozen-lockfile'] : ['install', '--ignore-scripts'] }, gates, environment: {} }, null, 2)}\n`,
  });
  for (const path of RULES_HOOK_PATHS) {
    let source = await readFile(join(staging, path), 'utf8');
    source = source.replace(
      'pnpm run lint && pnpm run typecheck && pnpm run test',
      ADD_RULES_SCRIPT_NAMES.filter(
        (name) => name !== 'build' && hasProjectScript(layout.manifest, name),
      )
        .map((name) => `${layout.manager} run ${name}`)
        .join(' && ') || ':',
    );
    source = source
      .replace('pnpm exec lint-staged', 'node node_modules/lint-staged/bin/lint-staged.js')
      .replace('pnpm exec commitlint', 'node node_modules/@commitlint/cli/cli.js');
    source = source.replace(
      'require-package-manager.sh pnpm',
      `require-package-manager.sh ${layout.manager}`,
    );
    files.push({ path, content: source });
  }
  for (const path of [
    ...(gates.length ? [RULES_WORKFLOW_PATH] : []),
    ...(level === RULES_POLICY.STRICT ? [RULES_TRUSTED_WORKFLOW_PATH] : []),
  ]) {
    files.push({
      path,
      content: workflow(
        await readFile(join(staging, path), 'utf8'),
        layout,
        path === RULES_TRUSTED_WORKFLOW_PATH,
      ),
    });
  }
  files.push({
    path: RULES_COMMIT_CONFIG,
    content: withoutScopeList(await readFile(join(template, RULES_COMMIT_CONFIG), 'utf8')),
  });
  const packageManagerGuard = 'scripts/lib/require-package-manager.sh';
  files.push({
    path: packageManagerGuard,
    content: await readFile(join(template, packageManagerGuard), 'utf8'),
  });
  const capped =
    level === RULES_POLICY.STRICT
      ? await ceilingFolders(root, await readCeilingPattern(template))
      : undefined;
  files.push({
    path: RULES_STAGED_CONFIG,
    content:
      "module.exports = { '*.{ts,tsx,js,jsx,json,md,yml,yaml}': ['node node_modules/prettier/bin/prettier.cjs --write'] };\n",
  });
  const rendered = await renderRulesText({
    projectRoot: template,
    level,
    delivery: { hooks: true, actions: gates.length > 0 },
    facts: {
      gates,
      manager: { name: layout.manager, version: layout.version },
      explicitTypeLint: '',
      commitScopes: ADD_RULES_ANY_SCOPE,
      standardNotEnforced:
        'The banned-construct scan and file length ceiling are off. The rules level was chosen when these files were added. Editing the rules receipt does not switch it.',
      standardCodeText:
        'Follow the existing project lint rules. No lint configuration is changed by this command.',
      whereThingsAre: [
        ...layout.workspaces.map((path) => `- \`${path}\``),
        '- `scripts/guardrails/policy.mjs`: Shared scanner policy.',
      ].join('\n'),
    },
  });
  files.push(
    {
      path: 'AGENTS.md',
      content:
        specializeCeilingText(rendered.agents, capped) +
        '\nChanging the rules level after installation is not supported. Hooks are not active until you explicitly activate them. No project checks have been run by this installer.\n',
    },
    { path: 'CLAUDE.md', content: rendered.claude },
  );
  for (const path of layout.workspaces)
    files.push({
      path: join(path, 'AGENTS.md'),
      content: `See ${posix.relative(path, 'AGENTS.md')} for project rules.\n`,
    });
  const notAdded = original.gates
    .filter(isRecord)
    .filter((gate) => !gates.some(({ name }) => name === gate.name))
    .map((gate) => {
      const args: unknown[] = Array.isArray(gate.args) ? gate.args : [];
      const script = args[0] === 'run' ? args[1] : args[0] === 'test' ? 'test' : undefined;
      return {
        check: String(gate.name),
        reason:
          gate.name === RULES_SCAN_GATE
            ? 'Standard rules omit this scanner.'
            : typeof script === 'string' && ADD_RULES_SCRIPT_NAMES.some((name) => name === script)
              ? `Required root script is missing: ${script}`
              : 'Template-specific gate is not supported in existing projects.',
      };
    });
  return { files, notAdded, ...(capped === undefined ? {} : { ceilingFolders: capped }) };
}
