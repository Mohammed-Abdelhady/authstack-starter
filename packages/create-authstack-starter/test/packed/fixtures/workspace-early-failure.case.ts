import { spawn } from 'node:child_process';
import { openSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { WORKER_PIPE_ENV } from '../../support/descendant-pipe.js';

const DESCENDANT = fileURLToPath(new URL('./workspace-descendant.ts', import.meta.url));

it('fails before reporting ready with a child in the Vitest group', async () => {
  const workerPipe = process.env[WORKER_PIPE_ENV];
  if (workerPipe === undefined) throw new Error('A worker death pipe is required.');
  const writer = openSync(workerPipe, 'w');
  writeSync(writer, 'ready\n');
  const child = spawn(process.execPath, ['--experimental-strip-types', DESCENDANT], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  await new Promise<void>((resolve, reject) => {
    child.once('message', (message: unknown) => {
      if (message !== 'ready') {
        reject(new Error('Invalid descendant readiness message.'));
        return;
      }
      child.disconnect();
      child.unref();
      resolve();
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Descendant exited before opening its death pipe.')));
  });
  throw new Error('Intentional failure before WORKSPACE_READY.');
});
