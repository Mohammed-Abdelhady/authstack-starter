import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import {
  RULES_GATES_PATH,
  RULES_QUALITY_DOC_PATH,
  RULES_DOC_INDEX_PATH,
  RULES_STANDARD_DOC_TEXT,
  RULES_HOOK_PATHS,
  RULES_RANGE_JOB,
  RULES_SCAN_GATE,
  RULES_SCAN_SCRIPT,
  RULES_SCANNER_ENTRY,
  RULES_TRUSTED_WORKFLOW_PATH,
  RULES_WORKFLOW_PATH,
} from '../constants/rules.js';
import { ROOT_PACKAGE_JSON, RULES_POLICY } from '../constants/index.js';
import { isRecord } from '../manifest/read.js';
import type { RulesPolicy } from '../types.js';
import { readFileIfExists, removeFile } from '../utils/fs.js';
import { prunePackageScripts } from './package-scripts.js';

const LINE_ENDINGS = /\r\n?/g;

async function rewrite(
  root: string,
  path: string,
  transform: (source: string) => string,
): Promise<void> {
  const file = join(root, path);
  const source = await readFileIfExists(file);
  if (source === undefined) return;
  const rendered = transform(source.replace(LINE_ENDINGS, '\n')).replace(LINE_ENDINGS, '\n');
  if (rendered !== source) await writeFile(file, rendered, 'utf8');
}

function standardHook(source: string): string {
  return source
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith(`node ${RULES_SCANNER_ENTRY} --staged`) &&
        !line.startsWith(`node ${RULES_SCANNER_ENTRY} --push`),
    )
    .join('\n');
}

function standardGates(source: string): string {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || !Array.isArray(value.gates)) {
    throw new Error(`${RULES_GATES_PATH} must contain a gates array`);
  }
  value.gates = value.gates.filter(
    (gate: unknown) => !isRecord(gate) || gate.name !== RULES_SCAN_GATE,
  );
  return `${JSON.stringify(value, null, 2)}\n`;
}

function standardWorkflow(source: string): string {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(document.errors.join('\n'));
  document.deleteIn(['jobs', RULES_RANGE_JOB]);
  return document.toString();
}

/** Applies the choice once, before reference validation. Hooks never read the answers file. */
export async function pruneRules(root: string, level: RulesPolicy): Promise<string[]> {
  for (const path of RULES_HOOK_PATHS) {
    await rewrite(root, path, level === RULES_POLICY.STANDARD ? standardHook : (source) => source);
  }
  await rewrite(
    root,
    RULES_WORKFLOW_PATH,
    level === RULES_POLICY.STANDARD ? standardWorkflow : (source) => source,
  );
  if (level === RULES_POLICY.STRICT) {
    await rewrite(root, RULES_TRUSTED_WORKFLOW_PATH, (source) => source);
    return [];
  }

  await rewrite(root, RULES_GATES_PATH, standardGates);
  await rewrite(root, RULES_QUALITY_DOC_PATH, () => RULES_STANDARD_DOC_TEXT);
  await rewrite(root, RULES_DOC_INDEX_PATH, (source) =>
    source.replace(
      'Local lint, format, hard-ban hooks, and tests on push.',
      'Local lint, format, hooks, and tests on push.',
    ),
  );
  await rewrite(root, ROOT_PACKAGE_JSON, (source) => {
    const manifest: unknown = JSON.parse(source);
    if (!isRecord(manifest)) throw new Error(`${ROOT_PACKAGE_JSON} must be an object`);
    const pruned = prunePackageScripts(manifest, [RULES_SCANNER_ENTRY]);
    if (isRecord(pruned.scripts) && typeof pruned.scripts.check === 'string') {
      pruned.scripts.check = pruned.scripts.check
        .split(' && ')
        .filter((command) => command !== `pnpm run ${RULES_SCAN_SCRIPT}`)
        .join(' && ');
    }
    return `${JSON.stringify(pruned, null, 2)}\n`;
  });
  const trusted = await readFileIfExists(join(root, RULES_TRUSTED_WORKFLOW_PATH));
  if (trusted === undefined) return [];
  await removeFile(root, RULES_TRUSTED_WORKFLOW_PATH);
  // The scanner's static imports are still needed by commit-msg and the CI runner.
  return [RULES_TRUSTED_WORKFLOW_PATH];
}
