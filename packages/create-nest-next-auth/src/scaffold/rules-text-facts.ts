import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULES_POLICY } from '../constants/index.js';
import { isRecord } from '../manifest/read.js';
import type { RulesPolicy } from '../types.js';
import { isErrnoException } from '../utils/fs.js';
import {
  AGENT_RULE_COPY,
  KNOWN_WORKSPACE_COPY,
  MOBILE_APP_CONFIG_PATH,
  MOBILE_APP_TEXT,
  STANDARD_POLICY_LOCATION,
} from './rules-text-template.js';
import { workspaceDirectories } from './workspace.js';

export const POLICY_PATH = 'scripts/guardrails/policy.mjs';

export interface PolicyConstruct {
  token: string;
  reason: string;
  display?: 'description';
}

export interface PolicyFacts {
  fileLineLimit: number;
  bannedConstructs: PolicyConstruct[];
  explicitTypeRule: string;
}

function policyError(message: string): Error {
  return new Error(`${POLICY_PATH} ${message}`);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw policyError('must export the expected policy values');
  return value;
}

export async function readPolicyFacts(projectRoot: string): Promise<PolicyFacts> {
  let moduleValue: unknown;
  try {
    moduleValue = await import(pathToFileURL(join(projectRoot, POLICY_PATH)).href);
  } catch {
    throw policyError('could not be loaded');
  }

  const policy = requireRecord(moduleValue);
  const fileLineLimit = policy.FILE_LINE_LIMIT;
  const constructs = policy.BANNED_CONSTRUCTS;
  const rawReasons = requireRecord(policy.RULE_REASONS);
  const explicitTypeRule = policy.EXPLICIT_TYPE_RULE;
  if (typeof fileLineLimit !== 'number' || !Number.isInteger(fileLineLimit) || fileLineLimit < 1) {
    throw policyError('has an invalid file line limit');
  }
  if (!Array.isArray(constructs) || !constructs.every((entry) => isRecord(entry))) {
    throw policyError('has an invalid banned construct list');
  }
  if (typeof explicitTypeRule !== 'string' || explicitTypeRule.length === 0) {
    throw policyError('has an invalid explicit-type rule name');
  }

  const reasons = new Set<string>();
  for (const reason of Object.values(rawReasons)) {
    if (typeof reason !== 'string') throw policyError(`has an invalid reason: ${String(reason)}`);
    reasons.add(reason);
    if (!Object.hasOwn(AGENT_RULE_COPY, reason)) {
      throw new Error(`No instruction sentence exists for policy reason: ${reason}`);
    }
  }

  const bannedConstructs = constructs.map((entry, index) => {
    const construct = requireRecord(entry);
    if (typeof construct.token !== 'string') {
      throw policyError(`has a banned construct without a token at position ${index + 1}`);
    }
    if (typeof construct.reason !== 'string') {
      throw policyError(`has a banned construct without a reason at position ${index + 1}`);
    }
    if (construct.display !== undefined && construct.display !== 'description') {
      throw policyError(`has an unsupported display value for reason ${construct.reason}`);
    }
    if (!reasons.has(construct.reason)) {
      throw policyError(`has a banned construct with an unknown reason: ${construct.reason}`);
    }
    const normalized: PolicyConstruct = {
      token: construct.token,
      reason: construct.reason,
    };
    if (construct.display === 'description') normalized.display = 'description';
    return normalized;
  });

  return { fileLineLimit, bannedConstructs, explicitTypeRule };
}

export function renderBannedConstructs(policy: PolicyFacts): string {
  const groups = new Map<string, PolicyConstruct[]>();
  for (const construct of policy.bannedConstructs) {
    if (!Object.hasOwn(AGENT_RULE_COPY, construct.reason)) {
      throw new Error(`No instruction sentence exists for policy reason: ${construct.reason}`);
    }
    const group = groups.get(construct.reason) ?? [];
    group.push(construct);
    groups.set(construct.reason, group);
  }

  return [...groups.entries()]
    .map(([reason, constructs]) => {
      if (!Object.hasOwn(AGENT_RULE_COPY, reason)) {
        throw new Error(`No instruction sentence exists for policy reason: ${reason}`);
      }
      const copy = AGENT_RULE_COPY[reason];
      const tokens = constructs
        .sort((left, right) => (left.token < right.token ? -1 : left.token > right.token ? 1 : 0))
        .map((construct) => {
          const token =
            construct.display === 'description' ? construct.token : `\`${construct.token}\``;
          return `- ${token}`;
        });
      return `### ${copy.heading}\n\n${copy.sentence}\n\n${tokens.join('\n')}`;
    })
    .join('\n\n');
}

function hasErrorRule(source: string, rule: string): boolean {
  const escaped = rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(
    `^[\\t ]*['"]${escaped}['"]\\s*:\\s*(?:['"]error['"]|2|\\[\\s*['"]error['"])(?=\\s*(?:,|\\]|$))`,
    'm',
  );
  return declaration.test(source);
}

export async function explicitTypeLintFact(
  projectRoot: string,
  policy: PolicyFacts,
): Promise<string> {
  const directories = await workspaceDirectories(projectRoot);
  const configurations: string[] = [];
  for (const directory of directories) {
    try {
      configurations.push(
        await readFile(join(projectRoot, directory, 'eslint.config.mjs'), 'utf8'),
      );
    } catch (error) {
      // A workspace without its own ESLint config contributes no rule fact.
      if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
    }
  }
  if (
    configurations.length === 0 ||
    !configurations.every((config) => hasErrorRule(config, policy.explicitTypeRule))
  ) {
    return '';
  }

  const typeName = policy.explicitTypeRule
    .split('/')
    .at(-1)
    ?.replace(/^no-explicit-/, '');
  if (typeName === undefined || typeName === policy.explicitTypeRule) {
    throw policyError('has an invalid explicit-type rule name');
  }
  return `The workspace ESLint configs reject TypeScript's \`${typeName}\` type.`;
}

/** The mobile section, for a project that has the Expo app. Empty for every other project. */
export async function mobileAppSection(projectRoot: string): Promise<string> {
  try {
    await readFile(join(projectRoot, MOBILE_APP_CONFIG_PATH), 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return '';
    throw error;
  }
  return `\n\n${MOBILE_APP_TEXT}`;
}

export async function workspaceLocationLines(
  projectRoot: string,
  level: RulesPolicy,
): Promise<string> {
  const directories = await workspaceDirectories(projectRoot);
  const workspaces = directories.map((directory) => {
    const description = Object.hasOwn(KNOWN_WORKSPACE_COPY, directory)
      ? KNOWN_WORKSPACE_COPY[directory]
      : undefined;
    return description === undefined ? `- \`${directory}\`` : `- \`${directory}\`: ${description}`;
  });
  workspaces.push(
    level === RULES_POLICY.STANDARD
      ? `- \`${POLICY_PATH}\`: ${STANDARD_POLICY_LOCATION}`
      : `- \`${POLICY_PATH}\`: Change the policy here. AGENTS.md is a snapshot rendered at scaffolding time. Later policy changes do not update it.`,
  );
  return workspaces.join('\n');
}
