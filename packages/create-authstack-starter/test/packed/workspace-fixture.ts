import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished } from 'vitest';
import { createDescendantPipe, DESCENDANT_PIPE_ENV } from '../support/descendant-pipe.js';

const LOADER = createRequire(import.meta.url).resolve('ts-node/esm');
const FIXTURE = fileURLToPath(new URL('./fixtures/workspace-signal.ts', import.meta.url));

export function killFixtureProcesses(pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
    }
  }
}

export async function startWorkspaceFixture(mode: 'running' | 'exited' | 'escaped'): Promise<{
  child: ChildProcess;
  closed: Promise<string>;
  workspace: string;
  pid: number;
  descendantPid: number;
  descendantEnded: Promise<string>;
  stderr: () => string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'cna-signal-test-'));
  const death = createDescendantPipe(root);
  const child = spawn(process.execPath, ['--loader', LOADER, FIXTURE, root, mode], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      ...process.env,
      TS_NODE_EXPERIMENTAL_RESOLVER: 'true',
      [DESCENDANT_PIPE_ENV]: death.path,
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const closed = new Promise<string>((resolve) => child.once('close', () => resolve('closed')));
  let stderr = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const pids: number[] = [];
  onTestFinished(async () => {
    killFixtureProcesses(pids);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    death.close();
    rmSync(root, { recursive: true, force: true });
  });
  const ready = await new Promise<{ workspace: string; pid: number; descendantPid: number }>(
    (resolve, reject) => {
      child.once('message', (value: unknown) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('workspace' in value) ||
          typeof value.workspace !== 'string' ||
          !('pid' in value) ||
          typeof value.pid !== 'number' ||
          !('descendantPid' in value) ||
          typeof value.descendantPid !== 'number'
        ) {
          reject(new Error('Invalid fixture handshake.'));
          return;
        }
        resolve({ workspace: value.workspace, pid: value.pid, descendantPid: value.descendantPid });
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error(`Fixture exited before handshake: ${stderr}`)));
    },
  );
  pids.push(ready.pid, ready.descendantPid);
  await death.ready;
  return { child, closed, ...ready, descendantEnded: death.ended, stderr: () => stderr };
}

export async function startVitestWorkspaceFixture(): Promise<{
  child: ChildProcess;
  closed: Promise<void>;
  workspace: string;
  cancelling: Promise<void>;
}> {
  const root = mkdtempSync(join(tmpdir(), 'cna-vitest-signal-test-'));
  const child = spawn(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      'test/packed/fixtures/workspace-cancellation.case.ts',
      '--pool',
      'forks',
      '--config',
      'test/packed/fixtures/workspace-cancellation.config.ts',
    ],
    {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { ...process.env, WORKSPACE_FIXTURE_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const pids: number[] = [];
  onTestFinished(async () => {
    killFixtureProcesses(pids);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    rmSync(root, { recursive: true, force: true });
  });
  let output = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  const workspace = await new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`Vitest exited before handshake: ${output}`)));
    let stdout = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
      output += chunk;
      const handshake = /WORKSPACE_READY (.+)\n/.exec(stdout)?.[1];
      if (handshake === undefined || pids.length > 0) return;
      try {
        const value: unknown = JSON.parse(handshake);
        if (
          !value ||
          typeof value !== 'object' ||
          !('workspace' in value) ||
          typeof value.workspace !== 'string' ||
          !('workerPid' in value) ||
          typeof value.workerPid !== 'number' ||
          !('pid' in value) ||
          typeof value.pid !== 'number' ||
          !('descendantPid' in value) ||
          typeof value.descendantPid !== 'number'
        ) {
          throw new Error('Invalid Vitest fixture handshake.');
        }
        pids.push(value.pid, value.descendantPid, value.workerPid);
        resolve(value.workspace);
      } catch (error) {
        reject(error);
      }
    });
  });
  const cancelling = new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve());
    child.once('close', () => reject(new Error(`Vitest exited before cancellation: ${output}`)));
  });
  return { child, closed, workspace, cancelling };
}
