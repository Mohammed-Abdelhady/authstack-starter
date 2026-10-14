import { execFileSync } from 'node:child_process';
import { createReadStream, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { CommandResult } from '../support/run-tool.js';
import type { preparePackedWorkspace } from './packed-workspace.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/workspace-command.ts', import.meta.url));
const HANDSHAKE = 'command-ready.json';

export function startWorkspaceProbe(
  workspace: ReturnType<typeof preparePackedWorkspace>,
  mode = 'running',
  start = workspace.runCommand,
): {
  ready: Promise<{ pid: number; descendantPid: number }>;
  result: Promise<CommandResult>;
  close: () => void;
} {
  const handshake = join(workspace.workspace, HANDSHAKE);
  execFileSync('mkfifo', [handshake]);
  const descriptor = openSync(handshake, 'r+');
  const reader = createReadStream(handshake, { fd: descriptor, encoding: 'utf8' });
  const close = (): void => {
    if (reader.destroyed) return;
    // Wake an outstanding FIFO read before closing its descriptor.
    writeSync(descriptor, '\n');
    reader.destroy();
  };
  let rejectReady: (error: Error) => void = () => {};
  let received = false;
  const ready = new Promise<{ pid: number; descendantPid: number }>((resolve, reject) => {
    rejectReady = reject;
    let payload = '';
    reader.once('error', reject);
    reader.on('data', (chunk) => {
      payload += String(chunk);
      const boundary = payload.indexOf('\n');
      if (boundary === -1) return;
      received = true;
      close();
      try {
        const value: unknown = JSON.parse(payload.slice(0, boundary));
        if (
          !value ||
          typeof value !== 'object' ||
          !('pid' in value) ||
          !('descendantPid' in value) ||
          typeof value.pid !== 'number' ||
          typeof value.descendantPid !== 'number' ||
          !Number.isSafeInteger(value.pid) ||
          value.pid <= 1 ||
          !Number.isSafeInteger(value.descendantPid) ||
          value.descendantPid <= 1
        ) {
          throw new Error('Invalid command handshake.');
        }
        resolve({ pid: value.pid, descendantPid: value.descendantPid });
      } catch (error) {
        reject(error);
      }
    });
  }).then(async (pids) => {
    if (mode === 'exited') {
      for (;;) {
        try {
          process.kill(pids.pid, 0);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ESRCH') break;
          throw error;
        }
        await setImmediate();
      }
    }
    return pids;
  });
  const result = start(process.execPath, ['--experimental-strip-types', FIXTURE, handshake, mode]);
  void result.then(
    (completed) => {
      if (!received) rejectReady(new Error(completed.output));
      close();
    },
    (error: Error) => {
      rejectReady(error);
      close();
    },
  );
  return { ready, result, close };
}
