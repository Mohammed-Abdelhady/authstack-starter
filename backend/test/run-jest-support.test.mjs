import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import './run-jest-memory.test.mjs';
import {
  childExitCode,
  countActiveRuns,
  processExists,
  normalizeWorkerArguments,
  removeOrphanedDataDirectories,
  requestedWorkerCount,
  resolveJestCli,
  runWithMarker,
  selectWorkerCount,
} from './run-jest-support.mjs';

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'backend-jest-support-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeMarker(directory, filename, contents) {
  const path = join(directory, filename);
  writeFileSync(path, contents);
  return path;
}

function removeMarker(path) {
  unlinkSync(path);
}

test('resolves Jest from its package bin even when exports omit that path', (t) => {
  const packageDirectory = temporaryDirectory(t);
  const packagePath = join(packageDirectory, 'package.json');
  mkdirSync(join(packageDirectory, 'bin'));
  writeFileSync(
    packagePath,
    JSON.stringify({ exports: { '.': './index.js' }, bin: './bin/jest.js' }),
  );

  assert.equal(
    resolveJestCli(packagePath),
    join(packageDirectory, 'bin', 'jest.js'),
  );
});

test('removes dead and malformed markers without counting them', (t) => {
  const directory = temporaryDirectory(t);
  const staleMarker = writeMarker(directory, '101-stale.lock', '101');
  const malformedMarker = writeMarker(
    directory,
    '133-garbage.lock',
    '133garbage',
  );
  const scientificMarker = writeMarker(directory, '100-exponent.lock', '1e2');
  const liveMarker = writeMarker(directory, '202-live.lock', '202');

  const activeRuns = countActiveRuns(
    directory,
    (pid) => pid === 100 || pid === 133 || pid === 202,
  );

  assert.deepEqual(
    {
      activeRuns,
      staleMarkerExists: existsSync(staleMarker),
      malformedMarkerExists: existsSync(malformedMarker),
      scientificMarkerExists: existsSync(scientificMarker),
      liveMarkerExists: existsSync(liveMarker),
    },
    {
      activeRuns: 1,
      staleMarkerExists: false,
      malformedMarkerExists: false,
      scientificMarkerExists: false,
      liveMarkerExists: true,
    },
  );
});

test('removes markers whose PID lookup rejects the PID', (t) => {
  const directory = temporaryDirectory(t);
  const invalidMarker = writeMarker(
    directory,
    '2147483648-invalid.lock',
    '2147483648',
  );
  const liveMarker = writeMarker(directory, '202-live.lock', '202');

  const activeRuns = countActiveRuns(directory, (pid) =>
    processExists(pid, (candidate) => {
      if (candidate === 2147483648) {
        throw Object.assign(
          new TypeError('PID is outside the supported range'),
          {
            code: 'ERR_INVALID_ARG_TYPE',
          },
        );
      }
      if (candidate === 202) {
        throw Object.assign(new Error('PID exists but is not accessible'), {
          code: 'EPERM',
        });
      }
    }),
  );

  assert.deepEqual(
    {
      activeRuns,
      invalidMarkerExists: existsSync(invalidMarker),
      liveMarkerExists: existsSync(liveMarker),
    },
    {
      activeRuns: 1,
      invalidMarkerExists: false,
      liveMarkerExists: true,
    },
  );
});

test('two live markers make the next run use one worker', (t) => {
  const directory = temporaryDirectory(t);
  writeMarker(directory, '303-live.lock', '303');
  writeMarker(directory, '404-live.lock', '404');

  const activeRuns = countActiveRuns(
    directory,
    (pid) => pid === 303 || pid === 404,
  );
  const workerCount = selectWorkerCount(activeRuns, 11);

  assert.deepEqual(
    { activeRuns, workerCount },
    { activeRuns: 2, workerCount: 1 },
  );
});

test('worker options and percentages select the requested counts', () => {
  const counts = [
    requestedWorkerCount([], 11, 9),
    requestedWorkerCount(['--runInBand', '--maxWorkers', '3'], 11, 9),
    requestedWorkerCount(['--maxWorkers', '3'], 11, 9),
    requestedWorkerCount(['-w', '4'], 11, 9),
    requestedWorkerCount(['--maxWorkers=5'], 11, 9),
    requestedWorkerCount(['--maxWorkers=33%'], 11, 9),
    requestedWorkerCount(['--maxWorkers=1%'], 11, 8),
    requestedWorkerCount(['--maxWorkers=100%'], 11, 8),
    requestedWorkerCount(['--maxWorkers=0%'], 11, 8),
  ];

  assert.deepEqual(counts, [11, 1, 3, 4, 5, 2, 1, 8, 11]);
});

test('worker normalization keeps other arguments and replaces worker flags', () => {
  const normalized = [
    normalizeWorkerArguments(['--runInBand', '--maxWorkers', '4', 'suite'], 1),
    normalizeWorkerArguments(['-w', '4', '--config', 'jest.json'], 6),
    normalizeWorkerArguments(['--maxWorkers=50%', 'suite'], 3),
  ];

  assert.deepEqual(normalized, [
    ['suite', '--runInBand'],
    ['--config', 'jest.json', '--maxWorkers=6'],
    ['suite', '--maxWorkers=3'],
  ]);
});

test('removes the marker after a nonzero Jest exit', async (t) => {
  const directory = temporaryDirectory(t);
  const marker = writeMarker(directory, '501-run.lock', '501');

  const exitCode = await runWithMarker(
    async () => 7,
    () => removeMarker(marker),
  );

  assert.deepEqual(
    { exitCode, markerExists: existsSync(marker) },
    { exitCode: 7, markerExists: false },
  );
});

test('removes the marker after Jest exits from a signal', async (t) => {
  const directory = temporaryDirectory(t);
  const marker = writeMarker(directory, '502-run.lock', '502');

  const exitCode = await runWithMarker(
    async () => childExitCode(null, 'SIGTERM'),
    () => removeMarker(marker),
  );

  assert.deepEqual(
    { exitCode, markerExists: existsSync(marker) },
    { exitCode: 143, markerExists: false },
  );
});

test('removes the marker when Jest cannot start', async (t) => {
  const directory = temporaryDirectory(t);
  const marker = writeMarker(directory, '503-run.lock', '503');
  const launchError = new Error('Jest failed to start');

  const result = await runWithMarker(
    async () => {
      throw launchError;
    },
    () => removeMarker(marker),
  ).then(
    () => undefined,
    (error) => error,
  );

  assert.deepEqual(
    { sameError: result === launchError, markerExists: existsSync(marker) },
    { sameError: true, markerExists: false },
  );
});

const DATA_PREFIX = 'backend-jest-mongo-';

function writeDataDirectory(directory, name) {
  const path = join(directory, name);
  mkdirSync(join(path, 'journal'), { recursive: true });
  writeFileSync(join(path, 'journal', 'WiredTigerLog.0000000001'), 'log');
  return path;
}

test('removes data directories of dead runs and keeps every live one', (t) => {
  const directory = temporaryDirectory(t);
  const dead = writeDataDirectory(directory, 'backend-jest-mongo-101-AbC123');
  const live = writeDataDirectory(directory, 'backend-jest-mongo-202-AbC123');
  const secondLive = writeDataDirectory(
    directory,
    'backend-jest-mongo-202-XyZ789',
  );

  const removed = removeOrphanedDataDirectories(
    directory,
    DATA_PREFIX,
    (pid) => pid === 202,
  );
  assert.deepEqual(
    removeOrphanedDataDirectories(directory, DATA_PREFIX, (pid) => pid === 202),
    [],
  );

  assert.deepEqual(
    {
      removed,
      deadExists: existsSync(dead),
      liveExists: existsSync(live),
      secondLiveExists: existsSync(secondLive),
    },
    {
      removed: ['backend-jest-mongo-101-AbC123'],
      deadExists: false,
      liveExists: true,
      secondLiveExists: true,
    },
  );
});

test('keeps a data directory whose PID exists but is not accessible', (t) => {
  const directory = temporaryDirectory(t);
  const guarded = writeDataDirectory(
    directory,
    'backend-jest-mongo-303-AbC123',
  );
  const gone = writeDataDirectory(directory, 'backend-jest-mongo-404-AbC123');

  const removed = removeOrphanedDataDirectories(directory, DATA_PREFIX, (pid) =>
    processExists(pid, (candidate) => {
      throw Object.assign(new Error('lookup failed'), {
        code: candidate === 303 ? 'EPERM' : 'ESRCH',
      });
    }),
  );

  assert.deepEqual(
    {
      removed,
      guardedExists: existsSync(guarded),
      goneExists: existsSync(gone),
    },
    {
      removed: ['backend-jest-mongo-404-AbC123'],
      guardedExists: true,
      goneExists: false,
    },
  );
});

test('leaves entries it cannot attribute to a run', (t) => {
  const directory = temporaryDirectory(t);
  const link = join(directory, 'backend-jest-mongo-606-link');
  const target = writeDataDirectory(directory, 'unrelated-target');
  symlinkSync(target, link, 'dir');
  const kept = [
    link,
    target,
    writeDataDirectory(directory, 'backend-jest-mongo-abc-AbC123'),
    writeDataDirectory(directory, 'backend-jest-mongo-0-AbC123'),
    writeDataDirectory(directory, 'backend-jest-mongo-505'),
    writeDataDirectory(directory, 'backend-jest-mongo-1e2-AbC123'),
    writeDataDirectory(directory, 'other-backend-jest-mongo-505-AbC123'),
    writeMarker(directory, 'backend-jest-mongo-505-file', 'not a directory'),
  ];

  const removed = removeOrphanedDataDirectories(
    directory,
    DATA_PREFIX,
    () => false,
  );

  assert.deepEqual(
    { removed, kept: kept.map((path) => existsSync(path)) },
    { removed: [], kept: [true, true, true, true, true, true, true, true] },
  );
});
