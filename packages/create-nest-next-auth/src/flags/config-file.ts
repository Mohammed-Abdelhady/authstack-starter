import { readFile } from 'node:fs/promises';
import {
  DOCKER_OPTION_ID,
  LOCALE_IDS,
  PRODUCTION_OPTION_ID,
  RULES_POLICIES,
} from '../constants/index.js';
import { isMember, isRecord, readBoolean, readString, readStringArray } from '../manifest/read.js';
import { MOBILE_IDENTITY_FIELDS } from '../constants/mobile.js';
import type { RulesPolicy } from '../types.js';
import type { MobileIdentityRequest } from '../types/mobile.js';
import { isErrnoException } from '../utils/fs.js';

export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigFileError';
  }
}

/** The selection fields a config file may carry, already validated. */
export interface ConfigSelection {
  targets?: string[];
  databases?: string[];
  features?: string[];
  preset?: string;
  options?: Partial<Record<string, boolean>>;
  locales?: string[];
  rules?: RulesPolicy;
  mobile?: MobileIdentityRequest;
}

const KEYS = new Set([
  'targets',
  'database',
  'features',
  'preset',
  'docker',
  'production',
  'locales',
  'rules',
  'mobile',
]);

/** Flags lower-case their lists, so config values are normalised the same way. */
function normalise(values: string[], where: string, problems: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length === 0) {
      problems.push(`${where} must contain non-empty strings`);
      continue;
    }
    out.push(trimmed);
  }
  return out;
}

function readDatabases(value: unknown, problems: string[]): string[] {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      problems.push('database must be a non-empty string');
      return [];
    }
    return [value.trim().toLowerCase()];
  }
  return normalise(readStringArray(value, 'database', problems), 'database', problems);
}

function readLocales(value: unknown, problems: string[]): string[] {
  const locales = normalise(readStringArray(value, 'locales', problems), 'locales', problems);
  for (const locale of locales) {
    if (!isMember(LOCALE_IDS, locale)) {
      problems.push(`locales must be one of ${LOCALE_IDS.join(', ')}, got "${locale}"`);
    }
  }
  return locales;
}

/** The same exact choices `--rules` takes: no trimming, no case folding. */
function readRules(value: unknown, problems: string[]): RulesPolicy | undefined {
  if (isMember(RULES_POLICIES, value)) return value;
  problems.push(`rules must be one of ${RULES_POLICIES.join(', ')}, got ${JSON.stringify(value)}`);
  return undefined;
}

/** The mobile app's identity: an object of strings. Their rules are checked with the plan. */
function readMobile(value: unknown, problems: string[]): MobileIdentityRequest {
  if (!isRecord(value)) {
    problems.push('mobile must be an object with name, slug, appId and scheme');
    return {};
  }
  const given: MobileIdentityRequest = {};
  for (const [key, entry] of Object.entries(value)) {
    const field = MOBILE_IDENTITY_FIELDS.find((name) => name === key);
    if (field === undefined) {
      problems.push(`unknown key "mobile.${key}"`);
      continue;
    }
    if (typeof entry !== 'string') {
      problems.push(`mobile.${key} must be a string`);
      continue;
    }
    given[field] = entry;
  }
  return given;
}

/** Validates a parsed config file. Throws ConfigFileError naming every problem. */
export function parseConfigFile(value: unknown): ConfigSelection {
  if (!isRecord(value)) {
    throw new ConfigFileError('config file must be a JSON object');
  }

  const problems: string[] = [];
  for (const key of Object.keys(value)) {
    if (!KEYS.has(key)) problems.push(`unknown key "${key}"`);
  }

  const selection: ConfigSelection = {};
  if (value.targets !== undefined) {
    selection.targets = normalise(
      readStringArray(value.targets, 'targets', problems),
      'targets',
      problems,
    );
  }
  if (value.features !== undefined) {
    selection.features = normalise(
      readStringArray(value.features, 'features', problems),
      'features',
      problems,
    );
  }
  if (value.database !== undefined) {
    selection.databases = readDatabases(value.database, problems);
  }
  if (value.preset !== undefined) {
    selection.preset = readString(value.preset, 'preset', problems).trim().toLowerCase();
  }

  const options: Partial<Record<string, boolean>> = {};
  if (value.docker !== undefined) {
    options[DOCKER_OPTION_ID] = readBoolean(value.docker, 'docker', problems);
  }
  if (value.production !== undefined) {
    options[PRODUCTION_OPTION_ID] = readBoolean(value.production, 'production', problems);
  }
  if (Object.keys(options).length > 0) selection.options = options;

  if (value.locales !== undefined) {
    selection.locales = readLocales(value.locales, problems);
  }

  if (value.rules !== undefined) {
    const rules = readRules(value.rules, problems);
    if (rules !== undefined) selection.rules = rules;
  }

  if (value.mobile !== undefined) {
    const mobile = readMobile(value.mobile, problems);
    if (Object.keys(mobile).length > 0) selection.mobile = mobile;
  }

  if (problems.length > 0) {
    throw new ConfigFileError(`config file is invalid:\n  ${problems.join('\n  ')}`);
  }
  return selection;
}

/** Reads and validates a config file. Throws ConfigFileError with a clear message. */
export async function readConfigFile(path: string): Promise<ConfigSelection> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = isErrnoException(error) ? error.code : undefined;
    if (code === 'ENOENT') throw new ConfigFileError(`config file not found: ${path}`);
    if (code === 'EISDIR') {
      throw new ConfigFileError(`config path is a directory, not a file: ${path}`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigFileError(`config file could not be read: ${reason}`);
  }

  // Editors on Windows write a UTF-8 BOM; JSON.parse would reject it.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigFileError(`config file is not valid JSON: ${reason}`);
  }

  return parseConfigFile(parsed);
}
