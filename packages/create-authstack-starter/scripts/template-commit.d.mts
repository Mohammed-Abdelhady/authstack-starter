import type { Buffer } from 'node:buffer';

export type TemplateGit = (root: string, args: string[]) => string;

/** A file the build copied or read, as it was on disk before any rewrite. */
export interface CopiedEntry {
  /** Repository-relative, with `/` separators. */
  path: string;
  /** The lstat mode. */
  mode: number;
  bytes: Buffer;
}

export interface TemplateBuild {
  copied: CopiedEntry[];
  isTemplateSource: (path: string) => boolean;
}

export function templateCommit(git: TemplateGit, root: string, build: TemplateBuild): string | null;
