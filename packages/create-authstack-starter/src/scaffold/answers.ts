import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ANSWERS_FILE_NAME,
  ANSWERS_SCHEMA_VERSION,
  BROKEN_PACKAGE,
  DEFAULT_RULES_POLICY,
  PREVIOUS_ANSWERS_SCHEMA_VERSION,
  RULES_POLICIES,
  LOCALE_OPTION_LOCALES,
  PACKAGE_MANIFEST,
  PACKAGE_MANAGER_SPEC,
  REINSTALL_HINT,
  REQUIRED_LOCALE_ID,
  SHA256_HEX_PATTERN,
  TEMPLATE_IDENTITY_FILE,
} from '../constants/index.js';
import { BrokenPackageError } from '../errors.js';
import type { Plan } from '../manifest/plan.js';
import { isMember, isRecord, readString, readStringArray } from '../manifest/read.js';
import { formatChangedFiles } from '../prune/format.js';
import type {
  AnswersRecord,
  InstallerIdentity,
  ResolvedAnswers,
  TemplateIdentity,
} from '../types.js';
import { isErrnoException } from '../utils/fs.js';

function brokenPackage(detail: string): BrokenPackageError {
  return new BrokenPackageError(`${BROKEN_PACKAGE}: ${detail} ${REINSTALL_HINT}`);
}

async function readIdentityFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      throw brokenPackage(`${path} is missing.`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw brokenPackage(`${path} could not be read (${reason}).`);
  }
}

/** The installer's own name and version, read once from its package.json. */
export async function readInstallerIdentity(root: string): Promise<InstallerIdentity> {
  const path = join(root, PACKAGE_MANIFEST);
  const raw = await readIdentityFile(path);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw brokenPackage(`${path} is not valid JSON (${reason}).`);
  }
  if (!isRecord(parsed)) throw brokenPackage(`${path} is not a JSON object.`);
  const { name, version } = parsed;
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw brokenPackage(`${path} does not carry a string name and version.`);
  }
  return { name, version };
}

/**
 * The SHA-256 sync-template.mjs computed over the template's file list and
 * contents at build time. Read from the manifest root, where the build writes
 * it beside the copied manifest: in the published package that root is the
 * package directory, next to the `template/` the digest describes.
 */
export async function readTemplateIdentity(root: string): Promise<TemplateIdentity> {
  const path = join(root, TEMPLATE_IDENTITY_FILE);
  const raw = await readIdentityFile(path);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw brokenPackage(`${path} is not valid JSON (${reason}).`);
  }
  const sha256 = isRecord(parsed) ? parsed.sha256 : undefined;
  if (typeof sha256 !== 'string' || !SHA256_HEX_PATTERN.test(sha256)) {
    throw brokenPackage(`${path} does not carry a 64-character sha256.`);
  }
  return { sha256 };
}

/**
 * The locales the resolved options leave in the project: the locale every
 * project ships, plus every locale whose manifest option is on.
 */
function resolvedLocales(options: readonly string[]): string[] {
  const locales = [REQUIRED_LOCALE_ID];
  for (const [optionId, locale] of Object.entries(LOCALE_OPTION_LOCALES)) {
    if (options.includes(optionId)) locales.push(locale);
  }
  return locales.sort();
}

/** The resolved plan, every array sorted so identical choices give identical bytes. */
function resolvedAnswers(plan: Plan): ResolvedAnswers {
  return {
    targets: [...plan.targets].sort(),
    database: plan.database,
    features: [...plan.features].sort(),
    options: [...plan.options].sort(),
    locales: resolvedLocales(plan.options),
  };
}

/** The answers record for one run: schema version, installer, template, plan. */
export function answersRecord(
  installer: InstallerIdentity,
  template: TemplateIdentity,
  plan: Plan,
): AnswersRecord {
  return {
    schemaVersion: ANSWERS_SCHEMA_VERSION,
    packageManager: PACKAGE_MANAGER_SPEC,
    rules: { policy: plan.rules },
    installer,
    template,
    answers: resolvedAnswers(plan),
  };
}

/**
 * Writes `<target>/.create-authstack-starter.json`: two spaces and a trailing
 * newline, nothing local and no timestamp, so the same choices always produce
 * the same file. The generated project's own prettier config then leaves the
 * bytes unchanged, the same way the pruner formats what it edits.
 */
export async function recordAnswers(target: string, record: AnswersRecord): Promise<void> {
  await writeFile(join(target, ANSWERS_FILE_NAME), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await formatChangedFiles(target, [ANSWERS_FILE_NAME]);
}

/** Reads both supported versions into the current normalized contract. */
export function parseAnswersRecord(value: unknown): AnswersRecord {
  if (!isRecord(value)) throw new Error('Answers record must be an object.');
  if (
    value.schemaVersion !== ANSWERS_SCHEMA_VERSION &&
    value.schemaVersion !== PREVIOUS_ANSWERS_SCHEMA_VERSION
  ) {
    throw new Error('Unsupported answers schema version.');
  }
  const problems: string[] = [];
  const rules = isRecord(value.rules) ? value.rules.policy : undefined;
  const policy =
    value.schemaVersion === PREVIOUS_ANSWERS_SCHEMA_VERSION && value.rules === undefined
      ? DEFAULT_RULES_POLICY
      : rules;
  if (!isMember(RULES_POLICIES, policy)) throw new Error('Invalid rules policy.');
  const installer = isRecord(value.installer) ? value.installer : {};
  const template = isRecord(value.template) ? value.template : {};
  const answers = isRecord(value.answers) ? value.answers : {};
  const sha256 = readString(template.sha256, 'template.sha256', problems);
  if (!SHA256_HEX_PATTERN.test(sha256)) problems.push('Invalid template sha256');
  const record: AnswersRecord = {
    schemaVersion: ANSWERS_SCHEMA_VERSION,
    packageManager: readString(value.packageManager, 'packageManager', problems),
    rules: { policy },
    installer: {
      name: readString(installer.name, 'installer.name', problems),
      version: readString(installer.version, 'installer.version', problems),
    },
    template: { sha256 },
    answers: {
      targets: readStringArray(answers.targets, 'answers.targets', problems),
      database: readString(answers.database, 'answers.database', problems),
      features: readStringArray(answers.features, 'answers.features', problems),
      options: readStringArray(answers.options, 'answers.options', problems),
      locales: readStringArray(answers.locales, 'answers.locales', problems),
    },
  };
  if (problems.length > 0) throw new Error(`Invalid answers record: ${problems.join(', ')}`);
  return record;
}

export async function readAnswersRecord(target: string): Promise<AnswersRecord> {
  const raw = await readFile(join(target, ANSWERS_FILE_NAME), 'utf8');
  const value: unknown = JSON.parse(raw);
  return parseAnswersRecord(value);
}
