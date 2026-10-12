import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { commandEnvironment } from '../../src/utils/exec.js';
import { writePnpmBoundary } from '../support/pnpm-boundary.js';
import { isolatedGit } from '../support/answers-helpers.js';

export async function setupFixture(
  roots: string[],
  inherited: NodeJS.ProcessEnv,
  failure = '',
): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'cna-setup-flow-'));
  roots.push(workspace);
  const root = join(workspace, 'app');
  const files = {
    'package.json': '{"name":"app"}',
    'backend/package.json': '{"scripts":{"start:dev":"node app.js"}}',
    'frontend/package.json': '{"scripts":{"dev":"next dev"}}',
    'AGENTS.md': '# Rules',
    'CLAUDE.md': 'See AGENTS.md',
    '.husky/pre-commit': '#!/bin/sh\n',
    '.husky/pre-push': '#!/bin/sh\n',
    '.husky/commit-msg': '#!/bin/sh\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9',
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const bin = join(workspace, 'bin');
  await mkdir(bin);
  await writePnpmBoundary(bin, failure);
  process.env = isolatedGit(workspace).env;
  process.env.PATH = `${bin}${delimiter}${inherited.PATH ?? ''}`;
  process.env = commandEnvironment();
  return root;
}
