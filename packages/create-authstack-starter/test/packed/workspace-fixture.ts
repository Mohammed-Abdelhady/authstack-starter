import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished } from 'vitest';
import { isolatedGit } from '../support/answers-helpers.js';
import {
  createDescendantPipe,
  DESCENDANT_PIPE_ENV,
  WORKER_PIPE_ENV,
} from '../support/descendant-pipe.js';

const LOADER = createRequire(import.meta.url).resolve('ts-node/esm');
const FIXTURE = fileURLToPath(new URL('./fixtures/workspace-signal.ts', import.meta.url));
const FIXTURE_HANDSHAKE_TIMEOUT_MS = 10_000;

interface VitestDeathPipes {
  descendant: ReturnType<typeof createDescendantPipe>;
  worker: ReturnType<typeof createDescendantPipe>;
}

type VitestFixtureMode = 'cancellation' | 'early-failure';

interface WorkspaceHandshake {
  workspace: string;
  pid: number;
  descendantPid: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isPid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 1;
}

function parseWorkspaceHandshake(value: unknown): WorkspaceHandshake {
  if (
    !isRecord(value) ||
    typeof value.workspace !== 'string' ||
    !isPid(value.pid) ||
    !isPid(value.descendantPid)
  ) {
    throw new Error('Invalid fixture handshake.');
  }
  return { workspace: value.workspace, pid: value.pid, descendantPid: value.descendantPid };
}

export function killFixtureProcesses(pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
    }
  }
}

export async function startWorkspaceFixture(
  mode: 'running' | 'exited' | 'escaped',
  psMode: 'system' | 'working' | 'failing' | 'timeout' = 'system',
): Promise<{
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
  const child = spawn(process.execPath, ['--loader', LOADER, FIXTURE, root, mode, psMode], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      ...isolatedGit(root).env,
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
  const ready = await new Promise<WorkspaceHandshake>((resolve, reject) => {
    child.once('message', (value: unknown) => {
      try {
        resolve(parseWorkspaceHandshake(value));
      } catch (error) {
        reject(error);
      }
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`Fixture exited before handshake: ${stderr}`)));
  });
  pids.push(ready.pid, ready.descendantPid);
  await death.ready;
  return { child, closed, ...ready, descendantEnded: death.ended, stderr: () => stderr };
}

function readVitestWorkspace(
  child: ChildProcess,
  pids: number[],
  output: { text: string },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`Vitest fixture handshake timed out: ${output.text}`));
    }, FIXTURE_HANDSHAKE_TIMEOUT_MS);
    function finish(error?: Error, workspace?: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.stdout?.off('data', onData);
      if (error === undefined && workspace !== undefined) resolve(workspace);
      else reject(error ?? new Error('Missing Vitest fixture workspace.'));
    }
    const onError = (error: Error): void => finish(error);
    const onExit = (): void => {
      finish(new Error(`Vitest exited before handshake: ${output.text}`));
    };
    const onData = (chunk: string): void => {
      stdout += chunk;
      output.text += chunk;
      const handshake = /WORKSPACE_READY ([^\n]*)\n/.exec(stdout)?.[1];
      if (handshake === undefined) return;
      try {
        const value: unknown = JSON.parse(handshake);
        const ready = parseWorkspaceHandshake(value);
        if (!isRecord(value) || !isPid(value.workerPid)) {
          throw new Error('Invalid Vitest fixture worker pid.');
        }
        pids.push(ready.pid, ready.descendantPid, value.workerPid);
        finish(undefined, ready.workspace);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    child.once('error', onError);
    child.once('exit', onExit);
    child.stdout?.setEncoding('utf8').on('data', onData);
  });
}

function spawnVitestFixture(
  root: string,
  mode: VitestFixtureMode,
  death: VitestDeathPipes | undefined,
): ChildProcess {
  return spawn(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      `test/packed/fixtures/workspace-${mode}.case.ts`,
      '--pool',
      'forks',
      '--config',
      'test/packed/fixtures/workspace-cancellation.config.ts',
    ],
    {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      detached: true,
      env: {
        ...isolatedGit(root).env,
        WORKSPACE_FIXTURE_ROOT: root,
        ...(death === undefined
          ? {}
          : {
              [DESCENDANT_PIPE_ENV]: death.descendant.path,
              [WORKER_PIPE_ENV]: death.worker.path,
            }),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
}

export function startVitestWorkspaceFixture(mode: VitestFixtureMode = 'cancellation'): {
  child: ChildProcess;
  closed: Promise<void>;
  ready: Promise<string>;
  cancelling: Promise<void>;
  death: VitestDeathPipes | undefined;
  cleanup: () => Promise<void>;
} {
  const root = mkdtempSync(join(tmpdir(), 'cna-vitest-signal-test-'));
  const death =
    mode === 'early-failure'
      ? {
          descendant: createDescendantPipe(root),
          worker: createDescendantPipe(root, 'worker-death.pipe'),
        }
      : undefined;
  const child = spawnVitestFixture(root, mode, death);
  const pgid = child.pid;
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const pids: number[] = [];
  let release: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    if (release !== undefined) return release;
    if (pgid !== undefined) killFixtureProcesses([-pgid]);
    killFixtureProcesses(pids);
    release = closed.then(() => rmSync(root, { recursive: true, force: true }));
    return release;
  };
  onTestFinished(async () => {
    try {
      await cleanup();
    } finally {
      death?.descendant.close();
      death?.worker.close();
    }
  });
  const output = { text: '' };
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    output.text += chunk;
  });
  const ready = readVitestWorkspace(child, pids, output).catch(async (error: unknown) => {
    await cleanup();
    throw error;
  });
  const cancelling = new Promise<void>((resolve, reject) => {
    child.once('message', () => resolve());
    child.once('close', () =>
      reject(new Error(`Vitest exited before cancellation: ${output.text}`)),
    );
  });
  void ready.catch(() => {});
  void cancelling.catch(() => {});
  return { child, closed, ready, cancelling, death, cleanup };
}
