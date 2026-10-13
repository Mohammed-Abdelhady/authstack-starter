import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { expect } from 'vitest';
import { parse } from 'yaml';
import { PACKAGE_DEPENDENCY_GROUPS, SKIPPED_DIRS } from '../../src/constants/index.js';
import { isRecord } from '../../src/manifest/read.js';
import { toPosix } from '../../src/utils/fs.js';

export function assertWorkspaceEdgesResolve(project: string): void {
  const workspace: unknown = parse(readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8'));
  if (!isRecord(workspace) || !Array.isArray(workspace.packages)) {
    throw new Error('Generated project has no pnpm workspace package list.');
  }
  const patterns = workspace.packages.filter(
    (pattern: unknown): pattern is string => typeof pattern === 'string',
  );
  const manifests = [
    'package.json',
    ...globSync(
      patterns.map((pattern) => `${pattern}/package.json`),
      { cwd: project },
    ),
  ];
  const folders = new Map<string, string>();
  for (const file of manifests) {
    const manifest: unknown = JSON.parse(readFileSync(join(project, file), 'utf8'));
    if (isRecord(manifest) && typeof manifest.name === 'string') {
      folders.set(manifest.name, file === 'package.json' ? '.' : posix.dirname(toPosix(file)));
    }
  }

  for (const file of packageManifests(project)) {
    const manifest: unknown = JSON.parse(readFileSync(join(project, file), 'utf8'));
    if (!isRecord(manifest)) continue;
    for (const group of PACKAGE_DEPENDENCY_GROUPS) {
      const dependencies = manifest[group];
      if (!isRecord(dependencies)) continue;
      for (const [name, version] of Object.entries(dependencies)) {
        if (typeof version !== 'string' || !version.startsWith('workspace:')) continue;
        const folder = folders.get(name);
        expect(folder, `${file} refers to missing workspace package ${name}`).toBeDefined();
        if (folder !== undefined) {
          expect(existsSync(join(project, folder)), `${name} workspace folder`).toBe(true);
        }
      }
    }
  }
}

function packageManifests(project: string, prefix = ''): string[] {
  return readdirSync(join(project, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : packageManifests(project, relative);
    }
    return entry.isFile() && entry.name === 'package.json' ? [relative] : [];
  });
}
