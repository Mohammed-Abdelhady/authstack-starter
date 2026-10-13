import type { Buffer } from 'node:buffer';

export function templateContent(relativePath: string, bytes: Buffer): Buffer;
/** Paths Git tracks under `root`, which must be the root of a repository. */
export function trackedFiles(root: string): string[];
export function isExcluded(relativePath: string, name: string, isDirectory: boolean): boolean;
