import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DESCENDANT = fileURLToPath(new URL('./workspace-descendant.ts', import.meta.url));

const [handshake, mode] = process.argv.slice(2);
if (mode === 'failed') process.exit(7);
const descendant = spawn(process.execPath, ['--experimental-strip-types', DESCENDANT], {
  detached: mode === 'escaped',
  stdio: ['ignore', 'inherit', 'inherit'],
});
descendant.once('spawn', () => {
  writeFileSync(
    handshake,
    `${JSON.stringify({ pid: process.pid, descendantPid: descendant.pid })}\n`,
  );
  if (mode === 'exited') process.exit(0);
});
if (mode !== 'exited') setInterval(() => {}, 60_000);
