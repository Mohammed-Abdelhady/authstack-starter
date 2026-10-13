import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The one token grammar both code and markdown markers use. */
export const MARKER_TOKEN = /^[a-z0-9][a-z0-9-]*(?:,[a-z0-9][a-z0-9-]*)*(?::(?:start|end))?$/;

export type MarkerKind = 'line' | 'start' | 'end';

export interface ParsedMarker {
  ids: string[];
  kind: MarkerKind;
  /** Where the marker starts, including the whitespace in front of it. */
  at: number;
}

/** Reads and validates a marker token, or throws through `error`. */
export function readMarkerToken(
  token: string,
  file: string,
  line: number,
  known: Set<string>,
  error: (file: string, line: number, problem: string) => Error,
  labels: { id: string; malformed: string },
): { ids: string[]; kind: MarkerKind } {
  if (!MARKER_TOKEN.test(token)) {
    throw error(file, line, `has a malformed ${labels.malformed} marker: ${token}`);
  }

  const [list, suffix] = token.split(':');
  const ids = list.split(',');
  for (const id of ids) {
    if (!known.has(id)) {
      throw error(file, line, `marks ${labels.id}"${id}", which the manifest does not list`);
    }
  }

  const kind: MarkerKind = suffix === 'start' || suffix === 'end' ? suffix : 'line';
  return { ids, kind };
}

export interface Stripper {
  /** Parses a marker on this line, or returns undefined. */
  parse(
    line: string,
    file: string,
    lineNumber: number,
    known: Set<string>,
  ): ParsedMarker | undefined;
  /** Track fenced code blocks and ignore markers inside them. */
  fences: boolean;
  error(file: string, line: number, problem: string): Error;
  /** A line that contains this and parsed no marker fails loudly. */
  leftover?: RegExp;
  /** The problem text for a leftover marker line. */
  leftoverProblem?: string;
}

interface Frame {
  ids: string[];
  keep: boolean;
  opened: number;
}

// A fenced code block opens with three or more backticks or tildes.
const FENCE = /^\s*(`{3,}|~{3,})/;
const FENCE_END = /^\s*(`{3,}|~{3,})\s*$/;

/**
 * The shared stack machine: it drops the lines and blocks marked for an id that
 * was not selected, and takes the marker comments off the lines that stay.
 */
export function stripWithMarkers(
  content: string,
  file: string,
  kept: Set<string>,
  known: Set<string>,
  stripper: Stripper,
): { content: string; removedLines: number } {
  const lines = content.split('\n');
  const output: string[] = [];
  const stack: Frame[] = [];
  let droppedBlocks = 0;
  let fence: string | null = null;

  lines.forEach((line, index) => {
    const number = index + 1;
    const dropping = droppedBlocks > 0;

    if (stripper.fences && fence === null) {
      const open = FENCE.exec(line);
      if (open !== null) {
        fence = open[1][0];
        if (!dropping) output.push(line);
        return;
      }
    } else if (stripper.fences) {
      const close = FENCE_END.exec(line);
      if (close !== null && close[1][0] === fence) fence = null;
      if (!dropping) output.push(line);
      return;
    }

    const marker = stripper.parse(line, file, number, known);
    if (marker === undefined) {
      if (!dropping && stripper.leftover?.test(line)) {
        throw stripper.error(
          file,
          number,
          stripper.leftoverProblem ?? 'has a marker that is not alone at the end of its line',
        );
      }
      if (!dropping) output.push(line);
      return;
    }

    if (marker.kind === 'start') {
      const keep = marker.ids.some((id) => kept.has(id));
      stack.push({ ids: marker.ids, keep, opened: number });
      if (!keep) droppedBlocks += 1;
      return;
    }

    if (marker.kind === 'end') {
      const frame = stack.pop();
      if (frame === undefined) {
        throw stripper.error(file, number, 'closes a block that never opened');
      }
      if (!frame.keep) droppedBlocks -= 1;
      if (frame.ids.join(',') !== marker.ids.join(',')) {
        throw stripper.error(
          file,
          number,
          `closes ${marker.ids.join(',')} while ${frame.ids.join(',')} is open from line ${frame.opened}`,
        );
      }
      return;
    }

    if (dropping) return;
    if (!marker.ids.some((id) => kept.has(id))) return;

    const stripped = line.slice(0, marker.at);
    if (stripped.trim().length > 0) output.push(stripped + (line.endsWith('\r') ? '\r' : ''));
  });

  const unclosed = stack[stack.length - 1];
  if (unclosed !== undefined) {
    throw stripper.error(
      file,
      unclosed.opened,
      `opens ${unclosed.ids.join(',')} and never closes it`,
    );
  }

  return { content: output.join('\n'), removedLines: lines.length - output.length };
}

export interface MarkerFileResult {
  editedFiles: string[];
  removedLines: number;
}

/**
 * Applies one stripper to the given files under `root`. Files with no marker are
 * left untouched, so the result differs from the template only where a marker
 * sat.
 */
export async function stripMarkedFiles(
  root: string,
  files: string[],
  strip: (content: string, file: string) => { content: string; removedLines: number },
): Promise<MarkerFileResult> {
  const editedFiles: string[] = [];
  let removedLines = 0;

  for (const file of files) {
    const path = join(root, file);
    const content = await readFile(path, 'utf8');
    if (!content.includes('feature:')) continue;

    const result = strip(content, file);
    if (result.content === content) continue;

    editedFiles.push(file);
    removedLines += result.removedLines;
    await writeFile(path, result.content, 'utf8');
  }

  return { editedFiles, removedLines };
}
