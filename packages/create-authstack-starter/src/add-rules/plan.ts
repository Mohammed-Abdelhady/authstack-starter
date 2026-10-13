import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  ADD_RULES_AGENT_COPY,
  ADD_RULES_DEPENDENCIES,
  ADD_RULES_HOOK_ACTIVATION,
  ADD_RULES_RECEIPT,
  ADD_RULES_SCRIPT_NAMES,
  ADD_RULES_SETUP_PATHS,
  RULES_GATES_PATH,
  RULES_HOOK_PATHS,
  RULES_TRUSTED_WORKFLOW_PATH,
  RULES_WORKFLOW_PATH,
} from '../constants/rules.js';
import { SETUP_CHECK, SETUP_STATUS } from '../constants/setup.js';
import { isRecord } from '../manifest/read.js';
import type { RulesPolicy } from '../types.js';
import type { RulesFile, RulesLayout, RulesPlan } from '../types/add-rules.js';
import type { SetupSummary } from '../types/setup.js';
import { ceilingScopeText } from './ceiling.js';
import { inspectGit } from './git.js';
import { inspectLayout } from './layout.js';
import { checkPath, inspectFile } from './paths.js';
import { renderIntegration } from './render.js';
import { hookFilesActive } from '../scaffold/hooks-status.js';
import { ProjectPaths } from './project-paths.js';
import { hasProjectScript } from './scripts.js';
import { writePlan } from './write.js';

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function summary(layout: RulesLayout, level: RulesPolicy): SetupSummary {
  const missing = ADD_RULES_SCRIPT_NAMES.filter((name) => !hasProjectScript(layout.manifest, name));
  return {
    files: { count: 0, instructions: [] },
    rules: level,
    exitCode: 0,
    lockfile: { status: SETUP_STATUS.NOT_REQUESTED },
    git: {
      status: SETUP_STATUS.NOT_REQUESTED,
      reason: layout.repository
        ? 'Only hooks path inspected; no Git writes.'
        : 'No Git repository. No Git commands run.',
    },
    install: {
      status: SETUP_STATUS.NOT_REQUESTED,
      reason: 'Add these dependencies yourself: ' + ADD_RULES_DEPENDENCIES.join(', '),
    },
    hooks: {
      included: true,
      active: false,
      activationCommand: (layout.repository ? '' : 'git init && ') + ADD_RULES_HOOK_ACTIVATION,
    },
    checksRun: [],
    skipped: [
      ...missing.map((name) => ({
        check: name === 'test' ? SETUP_CHECK.TESTS : name,
        reason: `not added: package.json has no ${name} script`,
      })),
      { check: SETUP_CHECK.INSTALL, reason: 'No project dependencies installed or executed.' },
      {
        check: SETUP_CHECK.LINT,
        reason: 'No project scripts run during inspection or application.',
      },
    ],
    nextSteps: [],
    docs: [],
  };
}

async function stagingTree(template: string): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), 'rules-render-'));
  try {
    for (const path of [
      RULES_GATES_PATH,
      ...RULES_HOOK_PATHS,
      RULES_WORKFLOW_PATH,
      RULES_TRUSTED_WORKFLOW_PATH,
    ]) {
      await mkdir(dirname(join(staging, path)), { recursive: true });
      await cp(join(template, path), join(staging, path));
    }
    return staging;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function receiptReplay(plan: RulesPlan, source: string): Promise<boolean> {
  const receipt: unknown = JSON.parse(source);
  if (!isRecord(receipt) || receipt.version !== 1 || !Array.isArray(receipt.files))
    throw new Error('Invalid add rules receipt. Nothing written.');
  const permitted = new Set([
    ...plan.files.map(({ path }) => path),
    RULES_TRUSTED_WORKFLOW_PATH,
    ADD_RULES_AGENT_COPY,
  ]);
  let existing = 0;
  for (const item of receipt.files) {
    if (!isRecord(item) || typeof item.path !== 'string' || typeof item.hash !== 'string')
      throw new Error('Invalid rules receipt entry.');
    if (!permitted.has(item.path)) throw new Error('Unsafe or unknown path in rules receipt.');
    const content = await inspectFile(plan.root, item.path);
    if (content !== undefined) existing++;
    if (content !== undefined && digest(content) !== item.hash)
      plan.blockers.push(`Previously added file was edited: ${item.path}`);
  }
  if (existing === 0) {
    plan.blockers.push('Remove the empty rules receipt before adding rules again.');
    return true;
  }
  if (receipt.level !== plan.level) plan.blockers.push('Changing rules level is not supported.');
  const recordedPaths = receipt.files.filter(isRecord).map((item) => item.path);
  const alternate = recordedPaths.includes(ADD_RULES_AGENT_COPY);
  const expectedPaths = plan.files.map(({ path }) =>
    alternate && path === 'AGENTS.md' ? ADD_RULES_AGENT_COPY : path,
  );
  const sameLevelPathsComplete =
    receipt.level !== plan.level ||
    (recordedPaths.length === expectedPaths.length &&
      expectedPaths.every((path) => recordedPaths.includes(path)));
  if (existing !== receipt.files.length || !sameLevelPathsComplete)
    plan.blockers.push('Partial existing rules setup. Restore or remove it before applying.');
  if (plan.blockers.length === 0) {
    plan.files = [];
    const paths = await ProjectPaths.open(plan.root);
    try {
      plan.summary.hooks.active =
        (await checkPath(plan.root, '.git')) &&
        (await inspectGit(plan.root)).at(-1) === '.husky/_' &&
        (await hookFilesActive('', '.husky/_', (path, mode) => paths.access(path, mode)));
    } finally {
      await paths.close();
    }
    if (plan.summary.hooks.active) delete plan.summary.hooks.activationCommand;
  }
  return true;
}

export async function planRules(
  root: string,
  level: RulesPolicy,
  template: string,
  agentsFile?: typeof ADD_RULES_AGENT_COPY,
): Promise<RulesPlan> {
  const layout = await inspectLayout(resolve(root));
  const plan: RulesPlan = {
    root: resolve(root),
    level,
    files: [],
    blockers: [],
    observations: layout.observations,
    guards: layout.guards,
    summary: summary(layout, level),
  };
  const receiptSource = await inspectFile(plan.root, ADD_RULES_RECEIPT);
  const staging = await stagingTree(template);
  try {
    const integration = await renderIntegration(template, staging, layout, level, plan.root);
    plan.files = integration.files;
    if (integration.ceilingFolders !== undefined) plan.ceilingFolders = integration.ceilingFolders;
    plan.summary.notAdded = integration.notAdded;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  if (agentsFile !== undefined) {
    plan.files = plan.files.map((file) =>
      file.path === 'AGENTS.md'
        ? { ...file, path: agentsFile }
        : file.path === 'CLAUDE.md'
          ? { ...file, content: `See ${agentsFile} for project rules.\n` }
          : file.path.endsWith('/AGENTS.md')
            ? {
                ...file,
                content: `See ${file.content.slice(4).split(' ')[0].replace('AGENTS.md', agentsFile)} for project rules.\n`,
              }
            : file,
    );
  }
  if (receiptSource !== undefined && (await receiptReplay(plan, receiptSource))) return plan;
  for (const path of ADD_RULES_SETUP_PATHS) {
    const exists = await checkPath(plan.root, path);
    plan.guards.set(path, exists);
    if (exists) plan.blockers.push(`Existing setup: ${path}`);
  }
  const scripts = isRecord(layout.manifest.scripts) ? layout.manifest.scripts : {};
  if (Object.hasOwn(scripts, 'prepare'))
    plan.blockers.push('Existing prepare script. Integrate hooks manually.');
  for (const key of ['lint-staged', 'commitlint'])
    if (Object.hasOwn(layout.manifest, key))
      plan.blockers.push(`Existing ${key} package.json configuration.`);
  if (layout.repository) {
    plan.gitHooks = await inspectGit(plan.root);
    if (plan.gitHooks.length)
      plan.blockers.push('Existing core.hooksPath. Integrate hooks manually.');
  }
  for (const file of plan.files) {
    const existing = await inspectFile(plan.root, file.path);
    plan.observations.set(file.path, existing);
    if (existing !== undefined)
      plan.blockers.push(
        file.path === 'AGENTS.md'
          ? 'Existing AGENTS.md is preserved. Pass --agents-file AGENTS.rules.md to write a separate instruction file.'
          : `Existing file: ${file.path}`,
      );
  }
  const instructions = plan.files
    .filter(({ path }) => path.endsWith('.md'))
    .map(({ path }) => path);
  const receipt: RulesFile = {
    path: ADD_RULES_RECEIPT,
    content:
      JSON.stringify(
        {
          version: 1,
          level,
          files: plan.files.map((file) => ({ path: file.path, hash: digest(file.content) })),
        },
        null,
        2,
      ) + '\n',
  };
  plan.observations.set(ADD_RULES_RECEIPT, undefined);
  plan.files.push(receipt);
  plan.summary.files.instructions = instructions;
  return plan;
}

export async function applyRules(plan: RulesPlan): Promise<SetupSummary> {
  await writePlan(plan);
  return {
    ...plan.summary,
    files: {
      ...plan.summary.files,
      count: plan.files.length,
      paths: plan.files.map(({ path }) => path),
    },
  };
}

export function renderRulesPlan(plan: RulesPlan): string {
  return [
    plan.files.length === 0 && plan.blockers.length === 0
      ? 'Rules already present. Nothing changed.'
      : 'Proposed rules files:',
    ...plan.files.map(({ path, content }) => `\n--- ${path} ---\n${content}`),
    ...(plan.ceilingFolders === undefined || plan.files.length === 0
      ? []
      : [ceilingScopeText(plan.ceilingFolders)]),
    ...plan.blockers.map((reason) => `Blocked: ${reason}`),
  ].join('\n');
}
