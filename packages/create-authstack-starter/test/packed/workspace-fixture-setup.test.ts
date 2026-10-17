import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join, sep } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { startWorkspaceFixture } from './workspace-fixture.js';

const PIPE_FAILURE_EXIT_CODE = 73;

function isOpen(descriptor: number): boolean {
  try {
    fs.fstatSync(descriptor);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EBADF') return false;
    throw error;
  }
}

function installSecondPipeFailure(root: string): string {
  const previousPath = process.env.PATH ?? '';
  const realMkfifo = previousPath
    .split(delimiter)
    .map((directory) => join(directory, 'mkfifo'))
    .find((candidate) => fs.existsSync(candidate));
  if (realMkfifo === undefined) throw new Error('mkfifo is unavailable');
  const bin = join(root, 'bin');
  const counter = join(root, 'mkfifo-called');
  fs.mkdirSync(bin);
  const executable = join(bin, 'mkfifo');
  fs.writeFileSync(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const counter = ${JSON.stringify(counter)};
if (fs.existsSync(counter)) process.exit(${PIPE_FAILURE_EXIT_CODE});
fs.writeFileSync(counter, '');
execFileSync(${JSON.stringify(realMkfifo)}, process.argv.slice(2));
`,
  );
  fs.chmodSync(executable, 0o755);
  return `${bin}${delimiter}${previousPath}`;
}

describe('workspace fixture setup', () => {
  it('releases the first FIFO and root when the second creation fails', async () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'workspace-setup-'));
    const previous = { TMPDIR: process.env.TMPDIR, PATH: process.env.PATH };
    let failingPath: string;
    try {
      failingPath = installSecondPipeFailure(root);
    } catch (error) {
      fs.rmSync(root, { recursive: true, force: true });
      throw error;
    }
    const descriptors: number[] = [];
    let reader: fs.ReadStream | undefined;
    let readerClosed: Promise<void> | undefined;
    let fixtureRoot: string | undefined;
    const realOpen = fs.openSync;
    const realReader = fs.createReadStream;
    const open = vi.spyOn(fs, 'openSync').mockImplementation((...args) => {
      const descriptor = realOpen(...args);
      if (typeof args[0] === 'string' && args[0].startsWith(root + sep)) {
        descriptors.push(descriptor);
      }
      return descriptor;
    });
    const stream = vi.spyOn(fs, 'createReadStream').mockImplementation((...args) => {
      const created = realReader(...args);
      if (typeof args[0] === 'string' && args[0].startsWith(root + sep)) {
        reader = created;
        fixtureRoot = args[0].slice(0, args[0].lastIndexOf(sep));
        readerClosed = new Promise((resolve) => created.once('close', resolve));
      }
      return created;
    });
    onTestFinished(async () => {
      open.mockRestore();
      stream.mockRestore();
      syncBuiltinESMExports();
      try {
        reader?.destroy();
        await readerClosed;
        for (const descriptor of descriptors) if (isOpen(descriptor)) fs.closeSync(descriptor);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        for (const key of ['TMPDIR', 'PATH'] as const) {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        }
      }
    });
    process.env.PATH = failingPath;
    process.env.TMPDIR = root;
    syncBuiltinESMExports();

    await expect(startWorkspaceFixture('running')).rejects.toMatchObject({
      status: PIPE_FAILURE_EXIT_CODE,
    });
    const [bootstrap, input] = descriptors;
    if (fixtureRoot === undefined || bootstrap === undefined || input === undefined) {
      throw new Error('the real first FIFO was not observed');
    }
    expect({ rootExists: fs.existsSync(fixtureRoot), bootstrapOpen: isOpen(bootstrap) }).toEqual({
      rootExists: false,
      bootstrapOpen: false,
    });
    await readerClosed;
    expect(isOpen(input)).toBe(false);
  });
});
