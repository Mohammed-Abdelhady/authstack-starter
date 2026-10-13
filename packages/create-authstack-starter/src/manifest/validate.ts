import type { Feature, FeatureKind, Manifest } from '../types.js';
import { MANIFEST_VERSION } from '../constants/index.js';
import {
  isRecord,
  readBoolean,
  readIdPattern,
  readPathArray,
  readStatus,
  readString,
  readStringArray,
} from './read.js';
import { legacyDimensions, readDimensions } from './validate-dimensions.js';
import { checkDimensions, checkRequires } from './validate-rules.js';

const KINDS: FeatureKind[] = ['credential', 'oauth', 'second-factor', 'passwordless', 'hidden'];

export class ManifestError extends Error {
  constructor(public readonly problems: string[]) {
    super(`template.manifest.json is invalid:\n  ${problems.join('\n  ')}`);
    this.name = 'ManifestError';
  }
}

function readFeature(id: string, value: unknown, problems: string[]): Feature {
  if (!isRecord(value)) {
    problems.push(`features.${id} must be an object`);
    return emptyFeature();
  }

  const kind = value.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as FeatureKind)) {
    problems.push(`features.${id}.kind must be one of ${KINDS.join(', ')}`);
  }

  return {
    label: readString(value.label, `features.${id}.label`, problems),
    description: readString(value.description, `features.${id}.description`, problems),
    kind: (KINDS.includes(kind as FeatureKind) ? kind : 'oauth') as FeatureKind,
    default: readBoolean(value.default, `features.${id}.default`, problems),
    files: readPathArray(value.files, `features.${id}.files`, problems),
    envVars: readStringArray(value.envVars, `features.${id}.envVars`, problems),
    packages: readStringArray(value.packages ?? [], `features.${id}.packages`, problems),
    requires: readStringArray(value.requires, `features.${id}.requires`, problems),
    docs: readPathArray(value.docs, `features.${id}.docs`, problems),
    status: readStatus(value.status, `features.${id}.status`, problems) ?? 'available',
    targets:
      value.targets === undefined
        ? undefined
        : readStringArray(value.targets, `features.${id}.targets`, problems),
  };
}

function emptyFeature(): Feature {
  return {
    label: '',
    description: '',
    kind: 'oauth',
    default: false,
    files: [],
    envVars: [],
    packages: [],
    requires: [],
    docs: [],
    status: 'planned',
  };
}

function resolvesVersion(value: Record<string, unknown>): 1 | 2 | undefined {
  if (value.version === undefined || value.version === 1) return 1;
  if (value.version === 2) return 2;
  return undefined;
}

/** Parses and checks the manifest. Throws ManifestError listing every problem. */
export function validateManifest(value: unknown): Manifest {
  const problems: string[] = [];

  if (!isRecord(value)) throw new ManifestError(['the manifest must be a JSON object']);
  if (!isRecord(value.features)) throw new ManifestError(['features must be an object']);

  const version = resolvesVersion(value);
  if (version === undefined) {
    problems.push(`version must be 1, 2 or omitted, got ${JSON.stringify(value.version)}`);
  }

  const features: Record<string, Feature> = {};
  for (const [id, entry] of Object.entries(value.features)) {
    readIdPattern(id, 'features', problems);
    features[id] = readFeature(id, entry, problems);
  }

  const dimensions = version === 2 ? readDimensions(value, problems) : legacyDimensions();
  checkDimensions(dimensions, Object.keys(features), problems);

  for (const [id, feature] of Object.entries(features)) {
    for (const target of feature.targets ?? []) {
      if (!dimensions.targets[target]) {
        problems.push(`features.${id}.targets names "${target}", which does not exist`);
      }
    }
  }

  checkRequires(features, 'features', problems, 'feature');

  const core = isRecord(value.core) ? value.core : undefined;
  if (!core) problems.push('core must be an object with alwaysRemoveFiles');
  const alwaysRemoveFiles = readPathArray(
    core?.alwaysRemoveFiles ?? [],
    'core.alwaysRemoveFiles',
    problems,
  );

  if (problems.length > 0) throw new ManifestError(problems);
  return {
    version: MANIFEST_VERSION,
    features,
    targets: dimensions.targets,
    shared: dimensions.shared,
    databases: dimensions.databases,
    options: dimensions.options,
    presets: dimensions.presets,
    core: { alwaysRemoveFiles },
  };
}
