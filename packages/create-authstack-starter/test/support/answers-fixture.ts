import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Files the stand-in template takes from the repository itself. */
const COPIED_FROM_REPOSITORY = [
  '.gitignore',
  'backend/.gitignore',
  'frontend/.gitignore',
  'nginx/.gitignore',
  '.prettierrc',
  'scripts/guardrails/policy.mjs',
];

/** A small tree: one file per prune stage, one the default selection removes. */
const FILES: Record<string, string> = {
  'package.json':
    '{\n  "name": "fixture",\n  "version": "1.0.0",\n  "packageManager": "pnpm@12.6.0",\n  "scripts": {}\n}\n',
  'scripts/ci/gates.json': '{\n  "gates": []\n}\n',
  'commitlint.config.cjs':
    "module.exports = { rules: { 'type-enum': [2, 'always', ['feat']], 'scope-enum': [2, 'always', ['root']], 'subject-max-length': [2, 'always', 100] } };\n",
  'frontend/package.json': '{\n  "name": "fixture-frontend"\n}\n',
  'pnpm-workspace.yaml': 'packages: []\n',
  'backend/src/main.ts': 'export const started = true;\n',
  'backend/src/auth/magic-link/magic-link.controller.ts':
    'export const magicLinkController = true;\n',
};

/**
 * Stands in for the bundled template. The repository's real ignore and prettier
 * files travel with it, so the git and formatting checks see exactly what a
 * generated project ships.
 */
export function writeAnswersTemplate(target: string): void {
  for (const [path, content] of Object.entries(FILES)) {
    const full = join(target, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  for (const path of COPIED_FROM_REPOSITORY) {
    const full = join(target, path);
    mkdirSync(dirname(full), { recursive: true });
    copyFileSync(join(REPO_ROOT, path), full);
  }
}
