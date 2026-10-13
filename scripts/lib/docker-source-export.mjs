import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ARTIFACT_DIRS = new Set([
  '.git',
  '.hyperflow',
  '.claude',
  '.codex',
  '.agents',
  '.kilocode',
  'openspec',
  'node_modules',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '.turbo',
  'output',
  'test-results',
  'playwright-report',
  'blob-report',
  '.auth',
  '.mongodb-binaries',
  'mongodb-memory-server',
]);
export const EXAMPLES = new Set(['.env.docker.example', 'backend/.env.example', 'frontend/.env.example']);

export function prohibitedPath(path) {
  return (
    path
      .split('/')
      .some(
        (name) =>
          /^\.env(?:\.|$)/.test(name) ||
          /\.(pem|key|crt)$/i.test(name) ||
          ['.ssh', '.aws', '.kube', 'ssl'].includes(name),
      ) || /(^|\/)\.config\/gcloud(\/|$)/.test(path)
  );
}

export function excludedPath(path) {
  return (
    prohibitedPath(path) ||
    path.split('/').some((name) => ARTIFACT_DIRS.has(name)) ||
    /\.(log|tgz|tsbuildinfo)$/.test(path) ||
    path === 'packages/create-authstack-starter/template' ||
    path.startsWith('packages/create-authstack-starter/template/')
  );
}

// Filter names before opening content. Symlinks never enter the export.
export async function exportSource(source, target, prefix = '') {
  for (const entry of await readdir(join(source, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (excludedPath(path)) continue;
    if (entry.isDirectory()) {
      await mkdir(join(target, path), { recursive: true });
      await exportSource(source, target, path);
    } else if (entry.isFile()) {
      await copyFile(join(source, path), join(target, path));
    }
  }
}
