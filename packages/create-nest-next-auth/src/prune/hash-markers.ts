import { posix } from 'node:path';
import { HASH_MARKER_EXTENSIONS, HASH_MARKER_FILENAMES } from '../constants/index.js';
import { listFiles } from '../utils/fs.js';
import {
  type MarkerFileResult,
  type ParsedMarker,
  readMarkerToken,
  stripMarkedFiles,
  stripWithMarkers,
  type Stripper,
} from './strip-markers.js';

// `# feature:mongodb`, `# feature:mongodb:start`, at line end.
const HASH_MARKER = /\s*#\s*feature:([^\r\n]*?)\s*$/;

export class HashMarkerError extends Error {
  constructor(file: string, line: number, problem: string) {
    super(`${file}:${line} ${problem}`);
    this.name = 'HashMarkerError';
  }
}

function parseHashMarker(
  line: string,
  file: string,
  number: number,
  known: Set<string>,
): ParsedMarker | undefined {
  const match = HASH_MARKER.exec(line);
  if (match === null) return undefined;

  const { ids, kind } = readMarkerToken(
    match[1].trim(),
    file,
    number,
    known,
    (f, l, p) => new HashMarkerError(f, l, p),
    { id: '', malformed: 'hash' },
  );
  if (kind !== 'line' && line.slice(0, match.index).trim().length > 0) {
    throw new HashMarkerError(file, number, `puts a ${kind} marker on a line with other text`);
  }
  return { ids, kind, at: match.index };
}

const HASH_STRIPPER: Stripper = {
  parse: parseHashMarker,
  fences: false,
  error: (file, line, problem) => new HashMarkerError(file, line, problem),
  leftover: /#\s*feature:/,
  leftoverProblem: 'has a hash marker that is not alone at the end of its line',
};

/**
 * The marker rules of code, for files whose comments start with `#`: YAML,
 * shell, Dockerfiles and ignore files. In a Dockerfile or an ignore file a `#`
 * only starts a comment at the beginning of a line, so those take block
 * markers and never a marker at the end of a line that carries something.
 */
export function stripHashMarkers(
  content: string,
  file: string,
  kept: Set<string>,
  known: Set<string>,
): { content: string; removedLines: number } {
  return stripWithMarkers(content, file, kept, known, HASH_STRIPPER);
}

/** True for a file whose comments start with `#` and may carry markers. */
export function takesHashMarkers(file: string): boolean {
  const name = posix.basename(file);
  return (
    (HASH_MARKER_FILENAMES as readonly string[]).includes(name) ||
    (HASH_MARKER_EXTENSIONS as readonly string[]).includes(posix.extname(name))
  );
}

/** Applies stripHashMarkers to every such file under `root`. */
export async function removeHashMarkers(
  root: string,
  selected: string[],
  known: string[],
): Promise<MarkerFileResult> {
  const kept = new Set(selected);
  const ids = new Set(known);
  const files = (await listFiles(root)).filter(takesHashMarkers);
  return stripMarkedFiles(root, files, (content, file) =>
    stripHashMarkers(content, file, kept, ids),
  );
}
