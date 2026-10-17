import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Test fixtures use the same declaring workspace as repository lint commands.
const TOOL_MODULES = fileURLToPath(new URL('../../../backend/node_modules/', import.meta.url));
const ROOT_MODULES = fileURLToPath(new URL('../../../node_modules/', import.meta.url));

export function installWorkspaceTools(root, workspace) {
  const target = join(root, workspace, 'node_modules');
  mkdirSync(target, { recursive: true });
  for (const name of ['eslint', 'typescript-eslint']) {
    symlinkSync(join(TOOL_MODULES, name), join(target, name), 'dir');
  }
}

export function installHookTools(root) {
  const target = join(root, 'node_modules');
  mkdirSync(join(target, '@commitlint'), { recursive: true });
  mkdirSync(join(target, '.bin'), { recursive: true });
  for (const name of [
    '@commitlint/cli',
    '@commitlint/config-conventional',
    'lint-staged',
    'prettier',
  ]) {
    symlinkSync(join(ROOT_MODULES, name), join(target, name), 'dir');
  }
  for (const name of ['commitlint', 'lint-staged', 'prettier']) {
    symlinkSync(join(ROOT_MODULES, '.bin', name), join(target, '.bin', name));
  }
}
