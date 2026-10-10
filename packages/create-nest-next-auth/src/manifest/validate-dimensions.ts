import type {
  CatalogueKeyRule,
  Database,
  Preset,
  ProjectOption,
  SharedModule,
  Target,
  TargetRequires,
} from '../types.js';
import {
  isRecord,
  readBoolean,
  readIdPattern,
  readOptionalBoolean,
  readPathArray,
  readPresetValue,
  readStatus,
  readString,
  readStringArray,
} from './read.js';
import { readEnvExamples, readJsonKeys, readRenames, readRewrites } from './read-database.js';

export interface Dimensions {
  targets: Record<string, Target>;
  shared: Record<string, SharedModule>;
  databases: Record<string, Database>;
  options: Record<string, ProjectOption>;
  presets: Record<string, Preset>;
}

function readTargetRequires(value: unknown, where: string, problems: string[]): TargetRequires {
  if (value === undefined) return { shared: [], targets: [] };
  if (!isRecord(value)) {
    problems.push(`${where} must be an object with shared and targets lists`);
    return { shared: [], targets: [] };
  }
  return {
    shared: readStringArray(value.shared ?? [], `${where}.shared`, problems),
    targets: readStringArray(value.targets ?? [], `${where}.targets`, problems),
  };
}

function readTarget(id: string, value: unknown, problems: string[]): Target {
  if (!isRecord(value)) {
    problems.push(`targets.${id} must be an object`);
    return emptyTarget();
  }
  return {
    label: readString(value.label, `targets.${id}.label`, problems),
    ...(value.description === undefined
      ? {}
      : { description: readString(value.description, `targets.${id}.description`, problems) }),
    default: readBoolean(value.default, `targets.${id}.default`, problems),
    files: readPathArray(value.files ?? [], `targets.${id}.files`, problems),
    workspaces: readStringArray(value.workspaces ?? [], `targets.${id}.workspaces`, problems),
    envFiles: readPathArray(value.envFiles ?? [], `targets.${id}.envFiles`, problems),
    requires: readTargetRequires(value.requires, `targets.${id}.requires`, problems),
    needsSignInSite: readOptionalBoolean(
      value.needsSignInSite,
      `targets.${id}.needsSignInSite`,
      problems,
    ),
    status: readStatus(value.status, `targets.${id}.status`, problems),
  };
}

function emptyTarget(): Target {
  return {
    label: '',
    default: false,
    files: [],
    workspaces: [],
    envFiles: [],
    requires: { shared: [], targets: [] },
    status: 'planned',
  };
}

function readShared(id: string, value: unknown, problems: string[]): SharedModule {
  if (!isRecord(value)) {
    problems.push(`shared.${id} must be an object`);
    return { files: [], workspaces: [] };
  }
  return {
    ...(value.label === undefined
      ? {}
      : { label: readString(value.label, `shared.${id}.label`, problems) }),
    files: readPathArray(value.files ?? [], `shared.${id}.files`, problems),
    workspaces: readStringArray(value.workspaces ?? [], `shared.${id}.workspaces`, problems),
  };
}

function readDatabase(id: string, value: unknown, problems: string[]): Database {
  if (!isRecord(value)) {
    problems.push(`databases.${id} must be an object`);
    return emptyDatabase();
  }
  const where = `databases.${id}`;
  return {
    label: readString(value.label, `${where}.label`, problems),
    default: readBoolean(value.default, `${where}.default`, problems),
    files: readPathArray(value.files ?? [], `${where}.files`, problems),
    docs: readPathArray(value.docs ?? [], `${where}.docs`, problems),
    envVars: readStringArray(value.envVars ?? [], `${where}.envVars`, problems),
    composeServices: readStringArray(
      value.composeServices ?? [],
      `${where}.composeServices`,
      problems,
    ),
    packages: readStringArray(value.packages ?? [], `${where}.packages`, problems),
    scripts: readStringArray(value.scripts ?? [], `${where}.scripts`, problems),
    jsonKeys: readJsonKeys(value.jsonKeys, `${where}.jsonKeys`, problems),
    buildApprovals: readStringArray(
      value.buildApprovals ?? [],
      `${where}.buildApprovals`,
      problems,
    ),
    renames: readRenames(value.renames, `${where}.renames`, problems),
    rewrites: readRewrites(value.rewrites, `${where}.rewrites`, problems),
    envExamples: readEnvExamples(value.envExamples, `${where}.envExamples`, problems),
    status: readStatus(value.status, `${where}.status`, problems),
  };
}

export function emptyDatabase(): Database {
  return {
    label: '',
    default: false,
    files: [],
    docs: [],
    envVars: [],
    composeServices: [],
    packages: [],
    scripts: [],
    jsonKeys: {},
    buildApprovals: [],
    renames: {},
    rewrites: [],
    envExamples: [],
    status: 'planned',
  };
}

function readCatalogueKeys(value: unknown, where: string, problems: string[]): CatalogueKeyRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push(`${where} must be an array`);
    return [];
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      problems.push(`${where}[${index}] must be an object`);
      return { path: '', keys: [] };
    }
    return {
      path: readString(entry.path, `${where}[${index}].path`, problems),
      keys: readStringArray(entry.keys, `${where}[${index}].keys`, problems),
    };
  });
}

function readOption(id: string, value: unknown, problems: string[]): ProjectOption {
  if (!isRecord(value)) {
    problems.push(`options.${id} must be an object`);
    return emptyOption();
  }
  return {
    label: readString(value.label, `options.${id}.label`, problems),
    default: readBoolean(value.default, `options.${id}.default`, problems),
    files: readPathArray(value.files ?? [], `options.${id}.files`, problems),
    requires: readStringArray(value.requires ?? [], `options.${id}.requires`, problems),
    docs: readPathArray(value.docs ?? [], `options.${id}.docs`, problems),
    catalogueKeys: readCatalogueKeys(
      value.catalogueKeys ?? [],
      `options.${id}.catalogueKeys`,
      problems,
    ),
    status: readStatus(value.status, `options.${id}.status`, problems),
  };
}

function emptyOption(): ProjectOption {
  return {
    label: '',
    default: false,
    files: [],
    requires: [],
    docs: [],
    catalogueKeys: [],
    status: 'planned',
  };
}

const PRESET_KEYS = new Set(['targets', 'features', 'options']);

function readPreset(id: string, value: unknown, problems: string[]): Preset {
  if (!isRecord(value)) {
    problems.push(`presets.${id} must be an object`);
    return { targets: [], features: [], options: [] };
  }
  for (const key of Object.keys(value)) {
    if (!PRESET_KEYS.has(key)) problems.push(`presets.${id} has unknown key "${key}"`);
  }
  return {
    targets: readPresetValue(value.targets, `presets.${id}.targets`, problems),
    features: readPresetValue(value.features, `presets.${id}.features`, problems),
    options: readPresetValue(value.options, `presets.${id}.options`, problems),
  };
}

function readDimension<T>(
  value: unknown,
  where: string,
  read: (id: string, entry: unknown, problems: string[]) => T,
  problems: string[],
): Record<string, T> {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    problems.push(`${where} must be an object`);
    return {};
  }
  const entries: Record<string, T> = {};
  for (const [id, entry] of Object.entries(value)) {
    readIdPattern(id, where, problems);
    entries[id] = read(id, entry, problems);
  }
  return entries;
}

/** Reads the version 2 dimensions. Missing dimensions read as empty. */
export function readDimensions(value: Record<string, unknown>, problems: string[]): Dimensions {
  return {
    targets: readDimension(value.targets, 'targets', readTarget, problems),
    shared: readDimension(value.shared, 'shared', readShared, problems),
    databases: readDimension(value.databases, 'databases', readDatabase, problems),
    options: readDimension(value.options, 'options', readOption, problems),
    presets: readDimension(value.presets, 'presets', readPreset, problems),
  };
}

export function legacyDimensions(): Dimensions {
  return {
    targets: {
      web: {
        label: 'Web app (Next.js)',
        default: true,
        files: [],
        workspaces: [],
        envFiles: [],
        requires: { shared: [], targets: [] },
      },
    },
    shared: {},
    databases: {
      mongodb: { ...emptyDatabase(), label: 'MongoDB', default: true, status: undefined },
    },
    options: {},
    presets: {},
  };
}
