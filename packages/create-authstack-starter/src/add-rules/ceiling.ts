import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SKIPPED_DIRS } from '../constants/index.js';
import { ADD_RULES_CEILING_DEPTH, RULES_POLICY_PATH } from '../constants/rules.js';
import { isRecord } from '../manifest/read.js';
import { ProjectPaths } from './project-paths.js';

const PATTERN_NAME = 'CAPPED_PATH';

/** The folder pattern the bundled policy caps, read from the installer's own template. */
export async function readCeilingPattern(template: string): Promise<RegExp> {
  const policy: unknown = await import(pathToFileURL(join(template, RULES_POLICY_PATH)).href);
  const pattern = isRecord(policy) ? policy[PATTERN_NAME] : undefined;
  if (!(pattern instanceof RegExp))
    throw new Error(`${RULES_POLICY_PATH} must export ${PATTERN_NAME} as a pattern`);
  return pattern;
}

/**
 * The project's folders that the policy pattern covers, outermost only. Folder
 * names are read; nothing in them is opened, and a symbolic link is not entered.
 */
export async function ceilingFolders(root: string, pattern: RegExp): Promise<string[]> {
  const found: string[] = [];
  const paths = await ProjectPaths.open(root);
  async function walk(path: string, depth: number): Promise<void> {
    for (const entry of await paths.entries(path)) {
      if (!entry.isDirectory() || SKIPPED_DIRS.has(entry.name)) continue;
      const child = path ? posix.join(path, entry.name) : entry.name;
      if (pattern.test(`${child}/`)) found.push(child);
      else if (depth < ADD_RULES_CEILING_DEPTH) await walk(child, depth + 1);
    }
  }
  try {
    await walk('', 1);
    return found.sort();
  } finally {
    await paths.close();
  }
}

/** One plain statement of where the ceiling applies, for the plan and AGENTS.md. */
export function ceilingScopeText(folders: readonly string[]): string {
  const source = `The folders and individual files are listed in \`${PATTERN_NAME}\` and \`CAPPED_FILES\` in \`${RULES_POLICY_PATH}\`.`;
  if (folders.length === 0)
    return `None of this project's source folders match the ceiling's folder pattern. The bundled guardrail files are also covered. ${source} Edit the folder pattern to cover your source folders.`;
  const listed = folders.map((folder) => `\`${folder}\``).join(', ');
  return `The file length ceiling applies to these project folders: ${listed}. The bundled guardrail files are also covered. ${source}`;
}

/** Replace only the bundled ceiling sentence, leaving the shared template untouched. */
export function specializeCeilingText(agents: string, folders?: readonly string[]): string {
  if (folders === undefined) return agents;
  const baseline =
    'The checker applies this limit to the source files it covers. Split long files to stay within it.';
  const scope = ceilingScopeText(folders);
  return agents.replace(
    baseline,
    folders.length === 0 ? scope : `${scope} Split long files to stay within it.`,
  );
}
