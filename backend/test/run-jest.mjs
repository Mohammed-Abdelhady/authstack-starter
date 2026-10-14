import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  childExitCode,
  countActiveRuns,
  normalizeWorkerArguments,
  processExists,
  processStartIdentity,
  processStartIdentityToken,
  removeFile,
  requestedWorkerCount,
  resolveJestCli,
  runWithMarker,
  selectWorkerCount,
} from './run-jest-support.mjs';

const INSTANCE_COUNT_ENV = 'BACKEND_TEST_MONGO_INSTANCE_COUNT';
const RUN_DIRECTORY_NAME = 'backend-jest-active-runs';
const backendDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const runDirectory = join(tmpdir(), RUN_DIRECTORY_NAME);
const identityToken = processStartIdentityToken(
  processStartIdentity(process.pid),
);
const markerPath = join(
  runDirectory,
  `${process.pid}-${identityToken}-${randomUUID()}.lock`,
);
// Worker admission respects CPU and process-available memory.
// Overlapping runs use one worker and
// one database instance.
const defaultWorkerCount = Math.max(1, availableParallelism() - 1);

mkdirSync(runDirectory, { recursive: true });
writeFileSync(markerPath, String(process.pid), { flag: 'wx' });

await runWithMarker(() => {
  const activeRuns = countActiveRuns(runDirectory, (pid) =>
    processExists(pid, (candidate) => process.kill(candidate, 0)),
  );
  const requestedWorkers = requestedWorkerCount(
    process.argv.slice(2),
    defaultWorkerCount,
    availableParallelism(),
  );
  const workerCount = selectWorkerCount(
    activeRuns,
    requestedWorkers,
    process.availableMemory(),
  );
  const args = normalizeWorkerArguments(process.argv.slice(2), workerCount);
  const environment = {
    ...process.env,
    [INSTANCE_COUNT_ENV]: String(workerCount),
  };

  console.info(
    `[jest-mongo-run] activeRuns=${activeRuns} maxWorkers=${workerCount} instances=${workerCount}`,
  );
  return runJest(args, environment);
}, removeMarker).then((code) => {
  process.exitCode = code;
});

function runJest(args, environment) {
  const jestPackagePath = join(
    backendDirectory,
    'node_modules',
    'jest',
    'package.json',
  );
  const jestCli = resolveJestCli(jestPackagePath);
  const child = spawn(process.execPath, [jestCli, ...args], {
    cwd: backendDirectory,
    env: environment,
    stdio: 'inherit',
  });
  const forwardSignal = (signal) => child.kill(signal);
  const removeSignalForwarders = () => {
    process.removeListener('SIGINT', forwardSignal);
    process.removeListener('SIGTERM', forwardSignal);
  };
  process.once('SIGINT', forwardSignal);
  process.once('SIGTERM', forwardSignal);

  return new Promise((resolveRun, rejectRun) => {
    child.once('error', (error) => {
      removeSignalForwarders();
      rejectRun(error);
    });
    child.once('exit', (code, signal) => {
      removeSignalForwarders();
      resolveRun(childExitCode(code, signal));
    });
  });
}

function removeMarker() {
  removeFile(markerPath);
}
