import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    combinationRoot: string;
    pnpmStore: string;
  }
}

export default function setup(project: TestProject): () => Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'cna-pnpm-combinations-'));
  project.provide('combinationRoot', root);
  project.provide('pnpmStore', join(root, 'store'));
  // Not rmSync: removing the store takes longer than Vitest waits for the last
  // worker to stop, and a blocked main process cannot finish that handshake.
  return () => rm(root, { recursive: true, force: true });
}
