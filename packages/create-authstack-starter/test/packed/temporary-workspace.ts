import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function allocatePackedWorkspace(root = tmpdir()): {
  workspace: string;
  cleanup: () => void;
} {
  const workspace = mkdtempSync(join(root, 'cna-e2e-'));
  let released = false;

  function cleanup(): void {
    if (released) return;
    rmSync(workspace, { recursive: true, force: true });
    released = true;
  }

  return { workspace, cleanup };
}
