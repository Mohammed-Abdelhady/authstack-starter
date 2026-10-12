import { extname } from 'node:path';
import { MARKER_EXTENSIONS } from '../constants/index.js';
import { listFiles } from '../utils/fs.js';
import {
  type MarkerFileResult,
  type ParsedMarker,
  readMarkerToken,
  stripMarkedFiles,
  stripWithMarkers,
  type Stripper,
} from './strip-markers.js';

// `// feature:a,b`, `// feature:a:start`, `{/* feature:a:end */}`, at line end.
const MARKER = new RegExp(
  [
    '\\s*(?:',
    '\\/\\/\\s*feature:([^\\r\\n]*?)',
    '|',
    '\\{\\/\\*\\s*feature:([^\\r\\n]*?)\\s*\\*\\/\\}',
    ')\\s*$',
  ].join(''),
);

export interface MarkerResult {
  editedFiles: string[];
  removedLines: number;
}

export class MarkerError extends Error {
  constructor(file: string, line: number, problem: string) {
    super(`${file}:${line} ${problem}`);
    this.name = 'MarkerError';
  }
}

function parseMarker(
  line: string,
  file: string,
  number: number,
  known: Set<string>,
): ParsedMarker | undefined {
  const match = MARKER.exec(line);
  if (match === null) return undefined;

  const token = (match[1] ?? match[2]).trim();
  const { ids, kind } = readMarkerToken(
    token,
    file,
    number,
    known,
    (f, l, p) => new MarkerError(f, l, p),
    { id: 'feature ', malformed: 'feature' },
  );
  if (kind !== 'line' && line.slice(0, match.index).trim().length > 0) {
    throw new MarkerError(file, number, `puts a ${kind} marker on a line that also carries code`);
  }

  return { ids, kind, at: match.index };
}

const CODE_STRIPPER: Stripper = {
  parse: parseMarker,
  fences: false,
  error: (file, line, problem) => new MarkerError(file, line, problem),
  // A comment that mentions `feature:` but did not parse as a marker, such as a
  // bare `/* feature:a */`, is left in the file silently otherwise.
  leftover: /(?:\/\/|\/\*|\{\/\*)\s*feature:/,
  leftoverProblem: 'has a feature marker that is not alone at the end of its line',
};

/**
 * Deletes the lines and blocks marked for features that were not selected, and
 * takes the marker comments off the lines that stay.
 *
 * @throws MarkerError on an unknown feature id, a malformed marker, or a block
 * that is never closed
 */
export function stripFeatureMarkers(
  content: string,
  file: string,
  kept: Set<string>,
  known: Set<string>,
): { content: string; removedLines: number } {
  return stripWithMarkers(content, file, kept, known, CODE_STRIPPER);
}

/**
 * Takes the marker comments off and keeps every marked line, for a file that
 * goes to a project this template's choices do not apply to.
 */
export function withoutMarkerComments(content: string, file: string): string {
  if (!content.includes('feature:')) return content;
  const ids = new Set<string>();
  for (const [index, line] of content.split('\n').entries()) {
    const match = MARKER.exec(line);
    if (match === null) continue;
    const token = (match[1] ?? match[2]).trim();
    const list = token.split(':')[0];
    if (list === '')
      throw new MarkerError(file, index + 1, `has a malformed feature marker: ${token}`);
    for (const id of list.split(',')) ids.add(id);
  }
  return stripFeatureMarkers(content, file, ids, ids).content;
}

/**
 * Applies stripFeatureMarkers to every source file under `root`. Files with no
 * marker are left untouched, so the result differs from the template only where
 * a marker sat.
 */
export async function removeFeatureLines(
  root: string,
  selected: string[],
  known: string[],
): Promise<MarkerResult> {
  const kept = new Set(selected);
  const ids = new Set(known);
  const files = (await listFiles(root)).filter((file) =>
    (MARKER_EXTENSIONS as readonly string[]).includes(extname(file)),
  );
  const result: MarkerFileResult = await stripMarkedFiles(root, files, (content, file) =>
    stripFeatureMarkers(content, file, kept, ids),
  );
  return result;
}
