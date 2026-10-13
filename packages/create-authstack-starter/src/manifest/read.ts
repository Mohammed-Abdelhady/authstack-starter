import type { FeatureStatus, PresetValue } from '../types.js';
import { PRESET_KEYWORDS } from '../constants/index.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const STATUSES = ['available', 'planned'] as const;

const STATUS_MESSAGE = STATUSES.join(', ');

/** True when `value` is one of the literal members of `list`. */
export function isMember<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && list.some((entry) => entry === value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown, where: string, problems: string[]): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    problems.push(`${where} must be a non-empty string`);
    return '';
  }
  return value;
}

export function readBoolean(value: unknown, where: string, problems: string[]): boolean {
  if (typeof value !== 'boolean') {
    problems.push(`${where} must be a boolean`);
    return false;
  }
  return value;
}

export function readOptionalBoolean(
  value: unknown,
  where: string,
  problems: string[],
): boolean | undefined {
  if (value === undefined) return undefined;
  return readBoolean(value, where, problems);
}

export function readStringArray(value: unknown, where: string, problems: string[]): string[] {
  if (!Array.isArray(value)) {
    problems.push(`${where} must be an array of strings`);
    return [];
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      problems.push(`${where} must contain non-empty strings`);
      continue;
    }
    entries.push(entry);
  }
  return entries;
}

/** A posix path that stays inside the project. */
export function isRelativePath(path: string): boolean {
  return !(path.startsWith('/') || path.includes('..') || path.includes('\\'));
}

export function readPathArray(value: unknown, where: string, problems: string[]): string[] {
  const entries = readStringArray(value, where, problems);
  for (const entry of entries) {
    if (!isRelativePath(entry)) {
      problems.push(`${where} entry "${entry}" must be a relative posix path inside the project`);
    }
  }
  return entries;
}

export function readStatus(
  value: unknown,
  where: string,
  problems: string[],
): FeatureStatus | undefined {
  if (value === undefined) return undefined;
  if (!isMember(STATUSES, value)) {
    problems.push(`${where} must be one of ${STATUS_MESSAGE}`);
    return undefined;
  }
  return value;
}

export function readIdPattern(id: string, where: string, problems: string[]): void {
  if (!ID_PATTERN.test(id)) {
    problems.push(`${where} id "${id}" must be lowercase letters, digits and hyphens`);
  }
}

export function readPresetValue(value: unknown, where: string, problems: string[]): PresetValue {
  if (isMember(PRESET_KEYWORDS, value)) return value;
  if (Array.isArray(value)) return readStringArray(value, where, problems);
  problems.push(`${where} must be an array of ids, "available" or "defaults"`);
  return [];
}
