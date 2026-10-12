import type { DatabaseEnvExample, DatabaseRewrite } from '../types.js';
import { isRecord, isRelativePath, readPathArray, readString, readStringArray } from './read.js';

/** `{ "backend/package.json": [["jest", "globalSetup"]] }`: a file and the key paths in it. */
export function readJsonKeys(
  value: unknown,
  where: string,
  problems: string[],
): Record<string, string[][]> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    problems.push(`${where} must be an object of file paths`);
    return {};
  }
  const keys: Record<string, string[][]> = {};
  for (const [path, entry] of Object.entries(value)) {
    if (!isRelativePath(path)) {
      problems.push(`${where} entry "${path}" must be a relative posix path inside the project`);
      continue;
    }
    if (!Array.isArray(entry)) {
      problems.push(`${where}.${path} must be an array of key paths`);
      continue;
    }
    keys[path] = entry.map((keyPath, index) => {
      const read = readStringArray(keyPath, `${where}.${path}[${index}]`, problems);
      if (read.length === 0) problems.push(`${where}.${path}[${index}] must name a key`);
      return read;
    });
  }
  return keys;
}

/** `{ "from/path": "to/path" }`. Both sides stay inside the project. */
export function readRenames(
  value: unknown,
  where: string,
  problems: string[],
): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    problems.push(`${where} must be an object of paths`);
    return {};
  }
  const renames: Record<string, string> = {};
  for (const [from, to] of Object.entries(value)) {
    const target = readString(to, `${where}.${from}`, problems);
    if (!isRelativePath(from) || !isRelativePath(target)) {
      problems.push(`${where} entry "${from}" must map relative posix paths inside the project`);
      continue;
    }
    renames[from] = target;
  }
  return renames;
}

/** `{ "long:name": "name" }`: a backend command and the name it takes. */
export function readScriptRenames(
  value: unknown,
  where: string,
  problems: string[],
): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    problems.push(`${where} must be an object of script names`);
    return {};
  }
  const renames: Record<string, string> = {};
  for (const [from, to] of Object.entries(value)) {
    renames[from] = readString(to, `${where}.${from}`, problems);
  }
  return renames;
}

export function readRewrites(value: unknown, where: string, problems: string[]): DatabaseRewrite[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push(`${where} must be an array`);
    return [];
  }
  return value.map((entry: unknown, index) => {
    if (!isRecord(entry)) {
      problems.push(`${where}[${index}] must be an object`);
      return { files: [], from: '', to: '' };
    }
    const to = entry.to;
    if (typeof to !== 'string') problems.push(`${where}[${index}].to must be a string`);
    return {
      files: readPathArray(entry.files, `${where}[${index}].files`, problems),
      from: readString(entry.from, `${where}[${index}].from`, problems),
      to: typeof to === 'string' ? to : '',
    };
  });
}

export function readEnvExamples(
  value: unknown,
  where: string,
  problems: string[],
): DatabaseEnvExample[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push(`${where} must be an array`);
    return [];
  }
  return value.map((entry: unknown, index) => {
    if (!isRecord(entry)) {
      problems.push(`${where}[${index}] must be an object`);
      return { path: '', lines: [] };
    }
    const path = readString(entry.path, `${where}[${index}].path`, problems);
    if (!isRelativePath(path)) {
      problems.push(`${where}[${index}].path must be a relative posix path inside the project`);
    }
    return { path, lines: readStringArray(entry.lines, `${where}[${index}].lines`, problems) };
  });
}
