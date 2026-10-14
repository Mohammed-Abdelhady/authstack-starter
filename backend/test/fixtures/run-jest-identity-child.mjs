import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs, { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname } from 'node:path';
import { countActiveRuns } from '../run-jest-support.mjs';

const [probe, startId] = process.argv.splice(2);
console.info = () => {};
if (probe === 'matching') {
  childProcess.execFileSync = () => startId;
}
if (probe === 'unavailable') {
  childProcess.execFileSync = () => {
    throw new Error('ps unavailable');
  };
}
if (probe !== 'real') {
  const readFile = fs.readFileSync;
  fs.readFileSync = (path, ...args) => {
    if (String(path).startsWith('/proc/')) {
      throw Object.assign(new Error('proc unavailable'), { code: 'ENOENT' });
    }
    return readFile(path, ...args);
  };
}
let markerPath, contents, oldActiveRuns;
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = (path, ...args) => {
  writeFileSync(path, ...args);
  markerPath = path;
  contents = readFileSync(markerPath, 'utf8');
  const oldPid = /^\d+$/.test(contents) ? Number(contents) : Number.NaN;
  oldActiveRuns =
    Number.isInteger(oldPid) && oldPid > 0 && oldPid === process.pid ? 1 : 0;
  if (!oldActiveRuns) unlinkSync(markerPath);
};
childProcess.spawn = () => {
  const child = new EventEmitter();
  queueMicrotask(() => {
    const token = basename(markerPath).split('-')[1];
    process.stdout.write(
      JSON.stringify({
        ownPid: contents === String(process.pid),
        token,
        activeRuns: countActiveRuns(
          dirname(markerPath),
          (pid) => pid === process.pid,
        ),
        markerExists: existsSync(markerPath),
        oldActiveRuns,
      }),
    );
    child.emit('exit', 0, null);
  });
  return child;
};
syncBuiltinESMExports();
// The runner must load after its builtin mocks are installed.
await import('../run-jest.mjs');
