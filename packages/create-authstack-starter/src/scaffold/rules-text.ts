import type { RulesTextFacts } from '../types/add-rules.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRecord } from '../manifest/read.js';
import {
  AGENTS_TEMPLATE,
  COMMIT_MESSAGE_HOOK_TEXT,
  STANDARD_CODE_TEXT,
  STANDARD_NOT_ENFORCED,
} from './rules-text-template.js';
import { RULES_POLICY } from '../constants/index.js';
import { RULES_GATES_PATH as GATES_PATH } from '../constants/rules.js';
import type { RulesPolicy } from '../types.js';
import {
  explicitTypeLintFact,
  mobileAppSection,
  readPolicyFacts,
  renderBannedConstructs,
  workspaceLocationLines,
} from './rules-text-facts.js';

export const AGENTS_FILE_NAME = 'AGENTS.md';
export const CLAUDE_FILE_NAME = 'CLAUDE.md';
export const CLAUDE_RULES_TEXT = 'See AGENTS.md for project rules.\n';

const COMMITLINT_PATH = 'commitlint.config.cjs';
const PACKAGE_JSON_PATH = 'package.json';

export interface RulesTextInput {
  projectRoot: string;
  level: RulesPolicy;
  facts?: RulesTextFacts;
  delivery: {
    hooks: boolean;
    actions: boolean;
  };
}

export interface RenderedRulesText {
  agents: string;
  claude: string;
}

interface CommitFacts {
  types: string[];
  scopes: string[];
  subjectLimit: number;
}

interface Gate {
  name: string;
  command: string;
  args: string[];
}

interface PackageManagerFacts {
  name: string;
  version: string;
}

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${description} must be an object`);
  return value;
}

async function readJson(path: string, description: string): Promise<Record<string, unknown>> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch {
    throw new Error(`${description} is missing or cannot be read`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${description} is not valid JSON`);
  }
  return requireRecord(parsed, description);
}

function enumValues(rules: Record<string, unknown>, name: string): string[] {
  const rule = rules[name];
  if (!Array.isArray(rule) || !Array.isArray(rule[2])) {
    throw new Error(`${COMMITLINT_PATH} has an invalid ${name} rule`);
  }
  const values: unknown[] = rule[2];
  if (values.length === 0 || !values.every((value) => typeof value === 'string')) {
    throw new Error(`${COMMITLINT_PATH} has an invalid ${name} values`);
  }
  return values.filter((value): value is string => typeof value === 'string');
}

function subjectLimit(rules: Record<string, unknown>): number {
  const rule = rules['subject-max-length'];
  const limit = Array.isArray(rule) ? rule[2] : undefined;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`${COMMITLINT_PATH} has an invalid subject limit`);
  }
  return limit;
}

async function readCommitFacts(projectRoot: string): Promise<CommitFacts> {
  let loaded: unknown;
  try {
    const namespace = await import(pathToFileURL(join(projectRoot, COMMITLINT_PATH)).href);
    loaded = namespace.default;
  } catch {
    throw new Error(`${COMMITLINT_PATH} could not be loaded`);
  }
  const config = requireRecord(loaded, COMMITLINT_PATH);
  const rules = requireRecord(config.rules, `${COMMITLINT_PATH} rules`);
  return {
    types: enumValues(rules, 'type-enum'),
    scopes: enumValues(rules, 'scope-enum'),
    subjectLimit: subjectLimit(rules),
  };
}

function readGates(value: Record<string, unknown>): Gate[] {
  if (!Array.isArray(value.gates)) {
    throw new Error(`${GATES_PATH} must contain a gates array`);
  }
  return value.gates.map((entry, index) => {
    const gate = requireRecord(entry, `${GATES_PATH} gate ${index + 1}`);
    if (
      typeof gate.name !== 'string' ||
      typeof gate.command !== 'string' ||
      !Array.isArray(gate.args)
    ) {
      throw new Error(`${GATES_PATH} gate ${index + 1} is invalid`);
    }
    const args = gate.args.filter((argument): argument is string => typeof argument === 'string');
    if (args.length !== gate.args.length)
      throw new Error(`${GATES_PATH} gate ${index + 1} is invalid`);
    return { name: gate.name, command: gate.command, args };
  });
}

function quoteCommandPart(value: string): string {
  if (/^[A-Za-z0-9_./:@=+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderGate(gate: Gate): string {
  const command = [gate.command, ...gate.args].map(quoteCommandPart).join(' ');
  return `| ${gate.name.replaceAll('|', '\\|')} | \`${command.replaceAll('|', '\\|')}\` |`;
}

function renderChecks(gates: Gate[]): string {
  if (gates.length === 0) return 'No checks are listed in the gate file.';
  return ['| Check | Command |', '| --- | --- |', ...gates.map(renderGate)].join('\n');
}

async function readPackageManager(projectRoot: string): Promise<PackageManagerFacts> {
  const manifest = await readJson(join(projectRoot, PACKAGE_JSON_PATH), PACKAGE_JSON_PATH);
  const packageManager = manifest.packageManager;
  if (typeof packageManager !== 'string') {
    throw new Error(`${PACKAGE_JSON_PATH} has no packageManager value`);
  }
  const match = /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)$/.exec(packageManager);
  if (match === null) throw new Error(`${PACKAGE_JSON_PATH} has an invalid packageManager value`);
  return { name: match[1], version: match[2] };
}

function replacePlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(/{{([A-Za-z]+)}}/g, (_placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No rules text value was supplied for ${name}`);
    return value;
  });
}

export async function renderRulesText(input: RulesTextInput): Promise<RenderedRulesText> {
  const policy = await readPolicyFacts(input.projectRoot);
  const gates =
    input.facts?.gates ??
    readGates(await readJson(join(input.projectRoot, GATES_PATH), GATES_PATH));
  const commits = await readCommitFacts(input.projectRoot);
  const manager = input.facts?.manager ?? (await readPackageManager(input.projectRoot));
  const explicitTypeLint =
    input.facts?.explicitTypeLint ?? (await explicitTypeLintFact(input.projectRoot, policy));
  const whereThingsAre =
    input.facts?.whereThingsAre ?? (await workspaceLocationLines(input.projectRoot, input.level));
  const hooks = input.delivery.hooks
    ? '- Local hooks run on your machine after Git and dependencies are set up.'
    : '- Local hooks are not included.';
  const actions = input.delivery.actions
    ? '- Workflows in `.github/workflows` run only when GitHub Actions is enabled for this repository.'
    : '- No workflow is included, so GitHub Actions cannot run these checks.';
  const branchProtection = input.delivery.actions
    ? "- Their checks block a merge only if this repository's branch protection requires them."
    : "- A check blocks a merge only if this repository's branch protection requires it.";
  const notEnforced = [
    'This file guides developers and coding agents. It does not block changes by itself.',
    ...(input.delivery.hooks ? ['Local hooks can be skipped.'] : []),
  ].join(' ');
  const template =
    input.level === RULES_POLICY.STANDARD
      ? AGENTS_TEMPLATE.replace(
          /Source file limit:[\s\S]*?{{bannedConstructs}}{{explicitTypeLint}}/,
          (input.facts?.standardCodeText ?? STANDARD_CODE_TEXT) + '{{explicitTypeLint}}',
        )
      : AGENTS_TEMPLATE;
  const agents = replacePlaceholders(template, {
    level: input.level,
    fileLineLimit: String(policy.fileLineLimit),
    bannedConstructs: renderBannedConstructs(policy),
    explicitTypeLint: explicitTypeLint === '' ? '' : `\n\n${explicitTypeLint}`,
    commitTypes: commits.types.join(', '),
    commitScopes: input.facts?.commitScopes ?? commits.scopes.join(', '),
    subjectLimit: String(commits.subjectLimit),
    commitHook: input.delivery.hooks ? `\n\n${COMMIT_MESSAGE_HOOK_TEXT}` : '',
    checks: renderChecks(gates),
    packageManager: manager.name,
    packageManagerVersion: manager.version,
    hooks,
    actions,
    branchProtection,
    notEnforced:
      input.level === RULES_POLICY.STANDARD
        ? `${notEnforced}\n\n${input.facts?.standardNotEnforced ?? STANDARD_NOT_ENFORCED}`
        : notEnforced,
    whereThingsAre,
    // Supplied facts describe another project, which has no app from this template.
    mobileApp: input.facts === undefined ? await mobileAppSection(input.projectRoot) : '',
  });
  return { agents, claude: CLAUDE_RULES_TEXT };
}

export async function writeRulesText(input: RulesTextInput): Promise<RenderedRulesText> {
  const rendered = await renderRulesText(input);
  await writeFile(join(input.projectRoot, AGENTS_FILE_NAME), rendered.agents, 'utf8');
  await writeFile(join(input.projectRoot, CLAUDE_FILE_NAME), rendered.claude, 'utf8');
  return rendered;
}
