import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, join, posix } from 'node:path';
import { expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';
import { isRecord } from '../../src/manifest/read.js';
import { commandEnvironment } from '../../src/utils/exec.js';
import { toPosix } from '../../src/utils/fs.js';
import { BUILD_TIMEOUT, type Packed, scaffold } from './packed-cli.js';
import { writePnpmBoundary } from '../support/pnpm-boundary.js';
import { assertWorkspaceEdgesResolve } from '../support/workspace-assertions.js';

const MOBILE_IMPORTERS = [
  'mobile/adapters',
  'mobile/auth',
  'mobile/cli',
  'mobile/device-key',
  'mobile/expo',
  'mobile/metro',
  'mobile/ui',
];

function expectLockfileImportersMatchWorkspace(project: string): void {
  const workspace: unknown = parse(readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8'));
  if (!isRecord(workspace) || !Array.isArray(workspace.packages)) {
    throw new Error('The generated pnpm workspace package list is missing.');
  }
  const patterns = workspace.packages.filter(
    (pattern: unknown): pattern is string => typeof pattern === 'string',
  );
  if (patterns.length !== workspace.packages.length) {
    throw new Error('The generated pnpm workspace package list is invalid.');
  }
  const expected = [
    '.',
    ...globSync(
      patterns.map((pattern) => `${pattern}/package.json`),
      { cwd: project },
    ).map((file) => posix.dirname(toPosix(file))),
  ].sort();
  const documents = parseAllDocuments(readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8'));
  const projectLock: unknown = documents[1]?.toJS();
  if (!isRecord(projectLock) || !isRecord(projectLock.importers)) {
    throw new Error('The generated project lockfile importers are missing.');
  }
  expect(Object.keys(projectLock.importers).sort()).toEqual(expected);
}

export function packageManagerCases(getPacked: () => Packed): void {
  it('updates the default lockfile before a git commit and leaves the tree clean', async () => {
    const packed = getPacked();
    const binaryDirectory = mkdtempSync(join(packed.workspace, 'pnpm-boundary-'));
    const project = join(packed.workspace, 'default-lock-importers');
    try {
      await writePnpmBoundary(binaryDirectory, '', undefined, true, MOBILE_IMPORTERS);
      const path = [binaryDirectory, process.env.PATH ?? ''].filter(Boolean).join(delimiter);
      const result = spawnSync(process.execPath, [packed.cli, project, '--yes'], {
        cwd: packed.workspace,
        env: { ...process.env, PATH: path },
        encoding: 'utf8',
        timeout: BUILD_TIMEOUT,
      });
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Updating pnpm lockfile');
      expect(result.stdout).toContain('pnpm lockfile updated');
      expect(readFileSync(join(binaryDirectory, 'calls'), 'utf8')).toBe(
        '--version\ninstall --lockfile-only\ninstall --frozen-lockfile\n',
      );
      expectLockfileImportersMatchWorkspace(project);
      const committedFiles = execFileSync('git', ['ls-tree', '--name-only', 'HEAD'], {
        cwd: project,
        env: commandEnvironment(),
        encoding: 'utf8',
      })
        .trimEnd()
        .split('\n');
      expect(committedFiles).toEqual(expect.arrayContaining(['AGENTS.md', 'CLAUDE.md']));
      expect(
        execFileSync('git', ['status', '--short'], {
          cwd: project,
          env: commandEnvironment(),
          encoding: 'utf8',
        }),
      ).toBe('');
    } finally {
      rmSync(binaryDirectory, { recursive: true, force: true });
    }
  });

  it('prunes lockfile importers with the mobile workspace', async () => {
    const packed = getPacked();
    const binaryDirectory = mkdtempSync(join(packed.workspace, 'pnpm-boundary-'));
    const project = join(packed.workspace, 'mobile-pruned-lock-importers');
    try {
      await writePnpmBoundary(binaryDirectory, '', undefined, false, MOBILE_IMPORTERS);
      const result = spawnSync(
        process.execPath,
        [packed.cli, project, '--yes', '--features', 'email-password', '--no-install', '--no-git'],
        {
          cwd: packed.workspace,
          env: { ...process.env, PATH: binaryDirectory },
          encoding: 'utf8',
          timeout: BUILD_TIMEOUT,
        },
      );
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      expectLockfileImportersMatchWorkspace(project);
      assertWorkspaceEdgesResolve(project);
      expect(readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8')).not.toContain('mobile/*');
      expect(readFileSync(join(binaryDirectory, 'calls'), 'utf8')).toBe(
        '--version\ninstall --lockfile-only\n',
      );
    } finally {
      rmSync(binaryDirectory, { recursive: true, force: true });
    }
  });

  it('removes the lockfile and reports a failed update', async () => {
    const packed = getPacked();
    const binaryDirectory = mkdtempSync(join(packed.workspace, 'pnpm-boundary-'));
    const project = join(packed.workspace, 'failed-update');
    try {
      await writePnpmBoundary(binaryDirectory, '--lockfile-only');
      const result = spawnSync(
        process.execPath,
        [packed.cli, project, '--yes', '--no-git', '--no-install'],
        {
          cwd: packed.workspace,
          env: { ...process.env, PATH: binaryDirectory },
          encoding: 'utf8',
          timeout: BUILD_TIMEOUT,
        },
      );
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
      expect(existsSync(join(project, 'pnpm-lock.yaml'))).toBe(false);
      expect(`${result.stdout}${result.stderr}`).toContain('pnpm-lock.yaml removed');
      expect(`${result.stdout}${result.stderr}`).toContain('pnpm lockfile update failed');
      expect(`${result.stdout}${result.stderr}`).toContain('pnpm install');
      assertWorkspaceEdgesResolve(project);
      expect(readFileSync(join(binaryDirectory, 'calls'), 'utf8')).toBe(
        '--version\ninstall --lockfile-only\n',
      );
    } finally {
      rmSync(binaryDirectory, { recursive: true, force: true });
    }
  });

  it('scaffolds without pnpm when installation is disabled', () => {
    const packed = getPacked();
    const result = scaffold(packed, 'without-pnpm', 'email-password', {
      env: { ...process.env, PATH: '' },
    });
    const project = join(packed.workspace, 'without-pnpm');
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
    expect(String(result.stdout)).toContain('pnpm install');
    expect(String(result.stdout)).toContain('pnpm-lock.yaml removed');
    expect(String(result.stdout)).not.toContain('--frozen-lockfile');
    const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
      packageManager: string;
    };
    const answers = JSON.parse(
      readFileSync(join(project, '.create-nest-next-auth.json'), 'utf8'),
    ) as { packageManager: string };
    const workspace = parse(readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8')) as {
      packages: string[];
      allowBuilds: Record<string, boolean>;
      overrides: Record<string, string>;
    };
    expect({
      packageManager: manifest.packageManager,
      recordedPackageManager: answers.packageManager,
      packages: workspace.packages,
      allowBuilds: workspace.allowBuilds,
      overrides: workspace.overrides,
      lockfilePresent: existsSync(join(project, 'pnpm-lock.yaml')),
    }).toEqual({
      packageManager: 'pnpm@12.6.0',
      recordedPackageManager: 'pnpm@12.6.0',
      packages: ['backend', 'frontend', 'shared/*'],
      allowBuilds: {
        '@parcel/watcher': true,
        '@scarf/scarf': false,
        '@swc/core': true,
        bcrypt: true,
        fsevents: true,
        'mongodb-memory-server': true,
        'unrs-resolver': true,
      },
      overrides: { diff: '>=8.0.3', lodash: '^4.18.1', '@nestjs/platform-express>multer': '2.4.0' },
      lockfilePresent: false,
    });
  });

  it('keeps the scaffold but removes the lockfile when install is requested without pnpm', () => {
    const packed = getPacked();
    const project = join(packed.workspace, 'missing-pnpm');
    const result = spawnSync(process.execPath, [packed.cli, project, '--yes', '--no-git'], {
      cwd: packed.workspace,
      env: { ...process.env, PATH: '' },
      encoding: 'utf8',
      timeout: BUILD_TIMEOUT,
    });
    expect(result.status).toBe(1);
    expect(existsSync(project)).toBe(true);
    expect(existsSync(join(project, 'pnpm-lock.yaml'))).toBe(false);
    expect(`${result.stdout}${result.stderr}`).toContain('pnpm-lock.yaml removed');
    expect(`${result.stdout}${result.stderr}`).toContain('pnpm install');
    expect(`${result.stdout}${result.stderr}`).toContain('dependency installation was skipped');
    expect(`${result.stdout}${result.stderr}`).not.toContain('pnpm install failed');
    assertWorkspaceEdgesResolve(project);
  });

  it('skips a requested installation when the lockfile update fails', async () => {
    const packed = getPacked();
    const binaryDirectory = mkdtempSync(join(packed.workspace, 'pnpm-boundary-'));
    const project = join(packed.workspace, 'failed-update-install-requested');
    try {
      await writePnpmBoundary(binaryDirectory, 'lockfile');
      const result = spawnSync(process.execPath, [packed.cli, project, '--yes', '--no-git'], {
        cwd: packed.workspace,
        env: { ...process.env, PATH: binaryDirectory },
        encoding: 'utf8',
        timeout: BUILD_TIMEOUT,
      });
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
      expect(existsSync(join(project, 'pnpm-lock.yaml'))).toBe(false);
      expect(`${result.stdout}${result.stderr}`).toContain('pnpm lockfile update failed');
      expect(`${result.stdout}${result.stderr}`).toContain('dependency installation was skipped');
      expect(`${result.stdout}${result.stderr}`).toContain('pnpm install');
      expect(`${result.stdout}${result.stderr}`).not.toContain('pnpm install failed');
      expect(readFileSync(join(binaryDirectory, 'calls'), 'utf8')).toBe(
        '--version\ninstall --lockfile-only\n',
      );
    } finally {
      rmSync(binaryDirectory, { recursive: true, force: true });
    }
  });
}
