import {
  DOCKER_OPTION_ID,
  LOCALE_OPTION_LOCALES,
  PACKAGE_MANAGER_SPEC,
  PRODUCTION_OPTION_ID,
} from '../constants/index.js';
import { MOBILE_IDENTITY_FIELDS } from '../constants/mobile.js';
import { isRecord } from '../manifest/read.js';

/** Every key a version 4 answers file may carry, by the dotted path of its object. */
const ANSWERS_FILE_KEYS: Record<string, readonly string[]> = {
  '': ['schemaVersion', 'packageManager', 'rules', 'installer', 'template', 'answers'],
  rules: ['policy'],
  installer: ['name', 'version'],
  template: ['sha256', 'commit'],
  answers: ['targets', 'database', 'features', 'options', 'locales', 'mobile'],
  'answers.mobile': MOBILE_IDENTITY_FIELDS,
};

/** Options a replay maps back. A locale option travels through `locales` as well. */
const REPLAYED_OPTION_IDS: readonly string[] = [
  DOCKER_OPTION_ID,
  PRODUCTION_OPTION_ID,
  ...Object.keys(LOCALE_OPTION_LOCALES),
];

function valueAt(root: Record<string, unknown>, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.').filter(Boolean)) {
    node = isRecord(node) ? node[key] : undefined;
  }
  return node;
}

function unknownKeys(value: Record<string, unknown>, problems: string[]): void {
  for (const [path, allowed] of Object.entries(ANSWERS_FILE_KEYS)) {
    const node = valueAt(value, path);
    if (!isRecord(node)) continue;
    for (const key of Object.keys(node)) {
      if (allowed.includes(key)) continue;
      problems.push(`unknown key "${path === '' ? key : `${path}.${key}`}"`);
    }
  }
}

function unknownOptions(value: Record<string, unknown>, problems: string[]): void {
  const options = valueAt(value, 'answers.options');
  if (!Array.isArray(options)) return;
  for (const option of options) {
    if (REPLAYED_OPTION_IDS.some((id) => id === option)) continue;
    problems.push(
      `answers.options must hold only ${REPLAYED_OPTION_IDS.join(', ')}, got ${JSON.stringify(option)}`,
    );
  }
}

/**
 * What a version 4 answers file must satisfy before `--config` replays it, on
 * top of the shared reader. Older files read by `add rules` never come here.
 */
export function strictAnswersProblems(value: Record<string, unknown>): string[] {
  const problems: string[] = [];
  unknownKeys(value, problems);
  unknownOptions(value, problems);
  if (value.packageManager !== PACKAGE_MANAGER_SPEC) {
    problems.push(
      `packageManager must be ${PACKAGE_MANAGER_SPEC}, got ${JSON.stringify(value.packageManager)}`,
    );
  }
  return problems;
}
