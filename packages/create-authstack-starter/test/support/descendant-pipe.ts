import { execFileSync } from 'node:child_process';
import { closeSync, createReadStream, openSync } from 'node:fs';
import { join } from 'node:path';

export const DESCENDANT_PIPE_ENV = 'AUTHSTACK_DESCENDANT_PIPE';
export const WORKER_PIPE_ENV = 'AUTHSTACK_WORKER_PIPE';

export function createDescendantPipe(
  root: string,
  name = 'descendant-death.pipe',
): {
  path: string;
  ready: Promise<void>;
  ended: Promise<string>;
  close: () => void;
} {
  const path = join(root, name);
  execFileSync('mkfifo', [path]);
  let bootstrap: number | undefined = openSync(path, 'r+');
  const reader = createReadStream(path, { fd: openSync(path, 'r'), encoding: 'utf8' });
  const releaseBootstrap = (): void => {
    if (bootstrap === undefined) return;
    closeSync(bootstrap);
    bootstrap = undefined;
  };
  const ready = new Promise<void>((resolve, reject) => {
    let payload = '';
    reader.once('error', reject);
    reader.on('data', (chunk) => {
      payload += String(chunk);
      if (!payload.includes('\n')) return;
      if (payload !== 'ready\n') {
        reject(new Error('Invalid descendant pipe handshake.'));
        return;
      }
      // After the descendant opens its writer, the test must release its own copy.
      releaseBootstrap();
      resolve();
    });
  });
  const ended = new Promise<string>((resolve, reject) => {
    reader.once('end', () => resolve('eof'));
    reader.once('error', reject);
  });
  void ended.catch(() => {});
  return {
    path,
    ready,
    ended,
    close: () => {
      releaseBootstrap();
      reader.destroy();
    },
  };
}
