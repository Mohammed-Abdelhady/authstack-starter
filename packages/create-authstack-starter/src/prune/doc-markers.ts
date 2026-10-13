import { listFiles } from '../utils/fs.js';
import {
  type MarkerFileResult,
  type ParsedMarker,
  readMarkerToken,
  stripMarkedFiles,
  stripWithMarkers,
  type Stripper,
} from './strip-markers.js';

// `<!-- feature:docker -->`, `<!-- feature:docker:start -->`, at line end.
const DOC_MARKER = /\s*<!--\s*feature:([^\r\n>]*?)\s*-->\s*$/;

// `| cell | cell | <!-- feature:docker --> |`: the marker is the whole last cell.
// Prettier moves a marker written after a row's closing pipe into this shape.
const CELL_MARKER = /^(\s*\|.*(?<!\\)\|)[ \t]*<!--\s*feature:([^\r\n>]*?)\s*-->[ \t]*\|[ \t]*\r?$/;

const TABLE_ROW = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

// Any marker-looking text, so a malformed or trailing marker fails loudly.
const MARKER_TEXT = /<!--\s*feature:/;

export interface DocMarkerResult {
  editedFiles: string[];
  removedLines: number;
}

export class DocMarkerError extends Error {
  constructor(file: string, line: number, problem: string) {
    super(`${file}:${line} ${problem}`);
    this.name = 'DocMarkerError';
  }
}

/** The 1-based numbers of the lines a separator row follows: table header rows. */
function headerRows(content: string): Set<number> {
  const lines = content.split('\n');
  const headers = new Set<number>();
  for (const [index, line] of lines.entries()) {
    if (index > 0 && TABLE_SEPARATOR.test(line) && TABLE_ROW.test(lines[index - 1])) {
      headers.add(index);
    }
  }
  return headers;
}

function readToken(
  token: string,
  file: string,
  number: number,
  known: Set<string>,
): Pick<ParsedMarker, 'ids' | 'kind'> {
  return readMarkerToken(token, file, number, known, (f, l, p) => new DocMarkerError(f, l, p), {
    id: '',
    malformed: 'doc',
  });
}

// Removing a header or separator row would leave the rows under it without a table.
function rejectTableFrame(row: string, file: string, number: number, headers: Set<number>): void {
  if (!TABLE_ROW.test(row)) return;
  if (headers.has(number)) {
    throw new DocMarkerError(file, number, 'puts a doc marker on a table header row');
  }
  if (TABLE_SEPARATOR.test(row)) {
    throw new DocMarkerError(file, number, 'puts a doc marker on a table separator row');
  }
}

function parseCellMarker(
  line: string,
  file: string,
  number: number,
  known: Set<string>,
): ParsedMarker | undefined {
  const match = CELL_MARKER.exec(line);
  if (match === null || MARKER_TEXT.test(match[1])) return undefined;

  const { ids, kind } = readToken(match[2].trim(), file, number, known);
  if (kind !== 'line') {
    throw new DocMarkerError(file, number, `puts a ${kind} marker on a line with other text`);
  }
  return { ids, kind, at: match[1].length };
}

function parseLineMarker(
  line: string,
  file: string,
  number: number,
  known: Set<string>,
): ParsedMarker | undefined {
  const match = DOC_MARKER.exec(line);
  if (match === null) return undefined;

  const { ids, kind } = readToken(match[1].trim(), file, number, known);
  if (kind !== 'line' && line.slice(0, match.index).trim().length > 0) {
    throw new DocMarkerError(file, number, `puts a ${kind} marker on a line with other text`);
  }

  return { ids, kind, at: match.index };
}

function docStripper(headers: Set<number>): Stripper {
  return {
    parse(line, file, number, known) {
      const marker =
        parseCellMarker(line, file, number, known) ?? parseLineMarker(line, file, number, known);
      if (marker?.kind === 'line')
        rejectTableFrame(line.slice(0, marker.at), file, number, headers);
      return marker;
    },
    fences: true,
    error: (file, line, problem) => new DocMarkerError(file, line, problem),
    leftover: MARKER_TEXT,
    leftoverProblem: 'has a doc marker that is not alone at the end of its line',
  };
}

/**
 * Removes markdown sections marked for options that were not selected and takes
 * the marker comments off the sections that stay. Mirrors the code marker rules
 * so docs can be pruned with the same selection. A table row carries its marker
 * as the whole of one extra last cell, which goes with the marker.
 */
export function stripDocMarkers(
  content: string,
  file: string,
  kept: Set<string>,
  known: Set<string>,
): { content: string; removedLines: number } {
  return stripWithMarkers(content, file, kept, known, docStripper(headerRows(content)));
}

/** Applies stripDocMarkers to every markdown file under `root`. */
export async function removeDocMarkers(
  root: string,
  selected: string[],
  known: string[],
): Promise<DocMarkerResult> {
  const kept = new Set(selected);
  const ids = new Set(known);
  const files = (await listFiles(root)).filter((file) => file.endsWith('.md'));
  const result: MarkerFileResult = await stripMarkedFiles(root, files, (content, file) =>
    stripDocMarkers(content, file, kept, ids),
  );
  return result;
}
