import { lstat } from 'node:fs/promises';
import { isErrnoException } from '../utils/fs.js';
import { dirname, join } from 'node:path';
import { parseDocument } from 'yaml';
import { isRecord } from '../manifest/read.js';
import { inspectWorkspacePaths } from './workspaces.js';
import { ADD_RULES_LOCKFILES, ADD_RULES_UNSUPPORTED_LOCKFILES } from '../constants/rules.js';
import type { RulesLayout } from '../types/add-rules.js';
import { checkPath, inspectFile } from './paths.js';

export async function inspectLayout(root: string): Promise<RulesLayout> {
  await checkPath(root, '');
  const guards = new Map<string, boolean>();
  const observations = new Map<string, string | undefined>();
  const read = async (path: string): Promise<string | undefined> => {
    const content = await inspectFile(root, path);
    observations.set(path, content);
    return content;
  };
  const source = await read('package.json');
  if (source === undefined)
    throw new Error('No root package.json. Rules are not active; run from the project root.');
  const manifest: unknown = JSON.parse(source);
  if (!isRecord(manifest)) throw new Error('Root package.json must be an object.');
  const managerField = manifest.packageManager;
  if (
    managerField !== undefined &&
    (typeof managerField !== 'string' ||
      !/^(pnpm|npm)@\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(managerField))
  ) {
    throw new Error(
      'Unsupported package manager. Only pnpm and npm are supported. Rules are not active.',
    );
  }
  const locks = await Promise.all(
    Object.entries(ADD_RULES_LOCKFILES).map(async ([manager, path]) => ({
      manager,
      exists: await checkPath(root, path),
    })),
  );
  const unsupported = await Promise.all(
    ADD_RULES_UNSUPPORTED_LOCKFILES.map((path) => checkPath(root, path)),
  );
  for (const { manager, exists } of locks)
    guards.set(ADD_RULES_LOCKFILES[manager as keyof typeof ADD_RULES_LOCKFILES], exists);
  ADD_RULES_UNSUPPORTED_LOCKFILES.forEach((path, index) => guards.set(path, unsupported[index]));
  const declared = typeof managerField === 'string' ? managerField.split('@')[0] : undefined;
  if (
    unsupported.some(Boolean) ||
    locks.filter(({ exists }) => exists).length > 1 ||
    (declared && locks.some(({ exists, manager }) => exists && manager !== declared))
  ) {
    throw new Error('Conflicting or unsupported lockfiles. Rules are not active.');
  }
  const manager = declared ?? locks.find(({ exists }) => exists)?.manager;
  if (manager !== 'pnpm' && manager !== 'npm')
    throw new Error(
      'Declare pnpm or npm in packageManager, or supply its lockfile. Rules are not active.',
    );
  const repository = await checkPath(root, '.git');
  guards.set('.git', repository);
  if (!repository) {
    let parent = dirname(root);
    while (parent !== dirname(parent)) {
      try {
        await lstat(join(parent, '.git'));
        throw new Error(
          'Nested repository directory refused. Run from the repository project root.',
        );
      } catch (error) {
        if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
      }
      parent = dirname(parent);
    }
  }
  let patterns: unknown = manifest.workspaces;
  if (isRecord(patterns)) patterns = patterns.packages;
  const workspaceSource = await read('pnpm-workspace.yaml');
  if (workspaceSource !== undefined) {
    const document = parseDocument(workspaceSource, { uniqueKeys: true });
    if (document.errors.length) throw new Error('Invalid pnpm workspace document.');
    const value: unknown = document.toJS();
    if (!isRecord(value)) throw new Error('Invalid pnpm workspace document.');
    patterns = value.packages;
  }
  if (
    patterns !== undefined &&
    (!Array.isArray(patterns) || !patterns.every((p: unknown) => typeof p === 'string'))
  )
    throw new Error('Invalid workspace list.');
  const workspacePatterns: string[] = Array.isArray(patterns)
    ? patterns.filter((p): p is string => typeof p === 'string')
    : [];
  if (workspacePatterns.some((pattern) => /[{}[\]\\]/.test(pattern)))
    throw new Error('Unsupported workspace glob syntax.');
  for (const pattern of workspacePatterns) await checkPath(root, pattern.replace(/^!/, ''));
  // Walk only regular entries. Matching symlinks must be refused, never followed.
  const workspaces = await inspectWorkspacePaths(root, workspacePatterns);
  for (const workspace of workspaces) await read(join(workspace, 'package.json'));
  return {
    manager,
    version:
      typeof managerField === 'string' ? managerField.slice(manager.length + 1) : 'not pinned',
    manifest,
    workspaces,
    observations,
    guards,
    repository,
  };
}
