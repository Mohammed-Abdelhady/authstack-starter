import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ANSWERS_FILE_NAME,
  ANSWERS_SCHEMA_VERSION,
  BROKEN_PACKAGE,
  DEFAULT_RULES_POLICY,
  GIT_COMMIT_HEX_PATTERN,
  READABLE_ANSWERS_SCHEMA_VERSIONS,
  RULELESS_ANSWERS_SCHEMA_VERSION,
  RULES_POLICIES,
  LOCALE_OPTION_LOCALES,
  LEGACY_ANSWERS_FILE_NAME,
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
import type { MobileIdentity } from '../types/mobile.js';
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

/** An identity file from before the commit was recorded reads as null. */
function identityCommit(parsed: Record<string, unknown>, path: string): string | null {
  const { commit } = parsed;
  if (commit === undefined || commit === null) return null;
  if (typeof commit !== 'string' || !GIT_COMMIT_HEX_PATTERN.test(commit)) {
    throw brokenPackage(`${path} carries a commit that is not a 40-character hash.`);
  }
  return commit;
}

/**
 * The SHA-256 sync-template.mjs computed over the template's file list and
 * contents at build time, and the commit it was built from when the tree
 * matched it. Read from the manifest root, where the build writes it beside
 * the copied manifest: in the published package that root is the package
 * directory, next to the `template/` the digest describes.
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
  const identity = isRecord(parsed) ? parsed : {};
  const { sha256 } = identity;
  if (typeof sha256 !== 'string' || !SHA256_HEX_PATTERN.test(sha256)) {
    throw brokenPackage(`${path} does not carry a 64-character sha256.`);
  }
  return { sha256, commit: identityCommit(identity, path) };
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

/** Fixed key order, so the same identity always gives the same bytes. */
function orderedMobile(mobile: MobileIdentity): MobileIdentity {
  return { name: mobile.name, slug: mobile.slug, appId: mobile.appId, scheme: mobile.scheme };
}

/** The resolved plan, every array sorted so identical choices give identical bytes. */
function resolvedAnswers(plan: Plan): ResolvedAnswers {
  return {
    targets: [...plan.targets].sort(),
    database: plan.database,
    features: [...plan.features].sort(),
    options: [...plan.options].sort(),
    locales: resolvedLocales(plan.options),
    ...(plan.mobile === undefined ? {} : { mobile: orderedMobile(plan.mobile) }),
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
    template: { sha256: template.sha256, commit: template.commit },
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

/** Versions 2 and 3 never carried a commit. A version 4 record must. */
function readRecordedTemplate(
  value: unknown,
  current: boolean,
  problems: string[],
): TemplateIdentity {
  const template = isRecord(value) ? value : {};
  const sha256 = readString(template.sha256, 'template.sha256', problems);
  if (!SHA256_HEX_PATTERN.test(sha256)) problems.push('Invalid template sha256');
  const { commit } = template;
  if (!current || commit === null) return { sha256, commit: null };
  if (typeof commit === 'string' && GIT_COMMIT_HEX_PATTERN.test(commit)) return { sha256, commit };
  problems.push('template.commit must be a 40-character hash or null');
  return { sha256, commit: null };
}

function readRecordedMobile(value: unknown, problems: string[]): MobileIdentity {
  const mobile = isRecord(value) ? value : {};
  return {
    name: readString(mobile.name, 'answers.mobile.name', problems),
    slug: readString(mobile.slug, 'answers.mobile.slug', problems),
    appId: readString(mobile.appId, 'answers.mobile.appId', problems),
    scheme: readString(mobile.scheme, 'answers.mobile.scheme', problems),
  };
}

/** Versions 2 and 3 never carried the mobile identity, so none is read from them. */
function readResolvedAnswers(
  value: unknown,
  current: boolean,
  problems: string[],
): ResolvedAnswers {
  const answers = isRecord(value) ? value : {};
  const resolved: ResolvedAnswers = {
    targets: readStringArray(answers.targets, 'answers.targets', problems),
    database: readString(answers.database, 'answers.database', problems),
    features: readStringArray(answers.features, 'answers.features', problems),
    options: readStringArray(answers.options, 'answers.options', problems),
    locales: readStringArray(answers.locales, 'answers.locales', problems),
  };
  if (current && answers.mobile !== undefined) {
    resolved.mobile = readRecordedMobile(answers.mobile, problems);
  }
  return resolved;
}

/** A version 2 record written before `rules` existed reads as the default policy. */
function recordedPolicy(value: Record<string, unknown>): unknown {
  if (value.schemaVersion === RULELESS_ANSWERS_SCHEMA_VERSION && value.rules === undefined) {
    return DEFAULT_RULES_POLICY;
  }
  return isRecord(value.rules) ? value.rules.policy : undefined;
}

/** Reads every readable version into the current normalized contract. */
export function parseAnswersRecord(value: unknown): AnswersRecord {
  if (!isRecord(value)) throw new Error('Answers record must be an object.');
  const version = value.schemaVersion;
  if (!READABLE_ANSWERS_SCHEMA_VERSIONS.some((readable) => readable === version)) {
    throw new Error('Unsupported answers schema version.');
  }
  const current = version === ANSWERS_SCHEMA_VERSION;
  const policy = recordedPolicy(value);
  if (!isMember(RULES_POLICIES, policy)) throw new Error('Invalid rules policy.');
  const problems: string[] = [];
  const installer = isRecord(value.installer) ? value.installer : {};
  const record: AnswersRecord = {
    schemaVersion: ANSWERS_SCHEMA_VERSION,
    packageManager: readString(value.packageManager, 'packageManager', problems),
    rules: { policy },
    installer: {
      name: readString(installer.name, 'installer.name', problems),
      version: readString(installer.version, 'installer.version', problems),
    },
    template: readRecordedTemplate(value.template, current, problems),
    answers: readResolvedAnswers(value.answers, current, problems),
  };
  if (problems.length > 0) throw new Error(`Invalid answers record: ${problems.join(', ')}`);
  return record;
}

export async function readAnswersRecord(target: string): Promise<AnswersRecord> {
  let raw: string;
  try {
    raw = await readFile(join(target, ANSWERS_FILE_NAME), 'utf8');
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
    raw = await readFile(join(target, LEGACY_ANSWERS_FILE_NAME), 'utf8');
  }
  const value: unknown = JSON.parse(raw);
  return parseAnswersRecord(value);
}
