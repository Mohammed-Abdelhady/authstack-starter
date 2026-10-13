import { readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { DanglingReference } from '../types.js';
import { listFiles, toPosix } from '../utils/fs.js';

const LIST_OR_ROW = /^\s*(?:[-*+]|\d+[.)]|\|)/;
const INLINE_LINK = /\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g;
const REFERENCE = /^\s{0,3}\[([^\]]+)\]:\s*(<[^>]+>|[^\s]+)/;
const REFERENCE_LINK = /\[([^\]]+)\](?:\[([^\]]*)\])?/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export interface DocPruneResult {
  removedLines: number;
  editedFiles: string[];
}

function targetPath(target: string): string | undefined {
  const unwrapped = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(unwrapped)) return undefined;
  const path = unwrapped.split(/[?#]/, 1)[0];
  return path === '' ? undefined : path;
}

function isRemovedTarget(file: string, target: string, removed: Set<string>): boolean {
  const path = targetPath(target);
  if (path === undefined) return false;
  return removed.has(posix.normalize(posix.join(posix.dirname(file), path)));
}

function fencedLines(lines: string[]): boolean[] {
  let opening: { character: string; length: number } | undefined;
  return lines.map((line) => {
    const marker = FENCE.exec(line);
    if (opening !== undefined) {
      if (
        marker !== null &&
        marker[1][0] === opening.character &&
        marker[1].length >= opening.length &&
        marker[2].trim() === ''
      ) {
        opening = undefined;
      }
      return true;
    }
    if (marker === null || (marker[1][0] === '`' && marker[2].includes('`'))) return false;
    opening = { character: marker[1][0], length: marker[1].length };
    return true;
  });
}

function referenceTargets(lines: string[], fenced: boolean[]): Map<string, string> {
  const targets = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue;
    const definition = REFERENCE.exec(line);
    if (definition !== null) targets.set(definition[1].trim().toLowerCase(), definition[2]);
  }
  return targets;
}

/** Uses the same link and fence rules as documentation pruning. */
export function docReferences(file: string, content: string): DanglingReference[] {
  const lines = content.split('\n');
  const fenced = fencedLines(lines);
  const references = referenceTargets(lines, fenced);
  const found: DanglingReference[] = [];
  const add = (specifier: string, line: number): void => {
    const path = targetPath(specifier);
    if (path === undefined) return;
    found.push({
      file,
      line,
      specifier,
      target: posix.normalize(posix.join(posix.dirname(file), path)),
    });
  };
  for (const [index, line] of lines.entries()) {
    if (fenced[index] || REFERENCE.test(line)) continue;
    const withoutInline = line.replace(INLINE_LINK, (_match, _label: string, target: string) => {
      add(target, index + 1);
      return '';
    });
    for (const match of withoutInline.matchAll(REFERENCE_LINK)) {
      const target = references.get((match[2] || match[1]).trim().toLowerCase());
      if (target !== undefined) add(target, index + 1);
    }
  }
  return found;
}

function pruneListLine(
  file: string,
  line: string,
  references: Map<string, string>,
  removed: Set<string>,
): string | undefined {
  if (!LIST_OR_ROW.test(line)) return line;
  let foundRemoved = false;
  let survivingLinks = 0;
  const inline = line.replace(INLINE_LINK, (match, label: string, target: string) => {
    if (isRemovedTarget(file, target, removed)) {
      foundRemoved = true;
      return label;
    }
    survivingLinks += 1;
    return match;
  });
  const referenced = inline.replace(
    REFERENCE_LINK,
    (match, label: string, id: string | undefined, offset: number, source: string) => {
      if (source[offset + match.length] === '(') return match;
      const key = (id || label).trim().toLowerCase();
      const target = references.get(key);
      if (target === undefined) return match;
      if (isRemovedTarget(file, target, removed)) {
        foundRemoved = true;
        return label;
      }
      survivingLinks += 1;
      return match;
    },
  );
  if (!foundRemoved) return line;
  return survivingLinks === 0 ? undefined : referenced;
}

/** Removes dead links from list items and rows while preserving links that survive. */
export async function removeDocLinks(root: string, docPaths: string[]): Promise<DocPruneResult> {
  if (docPaths.length === 0) return { removedLines: 0, editedFiles: [] };

  const removed = new Set(docPaths.map((path) => posix.normalize(toPosix(path))));
  const markdown = (await listFiles(root)).filter((file) => file.endsWith('.md'));
  const editedFiles: string[] = [];
  let removedLines = 0;

  for (const file of markdown) {
    const path = join(root, file);
    const original = (await readFile(path, 'utf8')).split('\n');
    const fenced = fencedLines(original);
    const references = referenceTargets(original, fenced);
    // Prose links remain for the dangling check, including their definitions.
    const proseTargets = new Set(
      docReferences(file, original.join('\n'))
        .filter((reference) => !LIST_OR_ROW.test(original[reference.line - 1]))
        .map((reference) => reference.specifier),
    );
    const kept: string[] = [];
    for (const [index, line] of original.entries()) {
      if (fenced[index]) {
        kept.push(line);
        continue;
      }
      const definition = REFERENCE.exec(line);
      if (
        definition !== null &&
        isRemovedTarget(file, definition[2], removed) &&
        !proseTargets.has(definition[2])
      ) {
        removedLines += 1;
        continue;
      }
      const result = pruneListLine(file, line, references, removed);
      if (result === undefined) {
        removedLines += 1;
        continue;
      }
      kept.push(result);
    }
    if (kept.length === original.length && kept.every((line, index) => line === original[index]))
      continue;
    editedFiles.push(file);
    await writeFile(path, kept.join('\n'), 'utf8');
  }

  return { removedLines, editedFiles };
}
