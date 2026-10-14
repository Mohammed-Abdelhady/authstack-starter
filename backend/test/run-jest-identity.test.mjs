import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as support from './run-jest-support.mjs';

const START_ID = 'Wed Oct 14 09:00:00 2026';
const START_TOKEN = '464640571f55217a';
const MARKER_UUID = '12345678-1234-1234-1234-123456789abc';

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'backend-jest-identity-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeMarker(directory, pid, token = START_TOKEN) {
  const prefix = token ? `${pid}-${token}` : String(pid);
  const path = join(directory, `${prefix}-${MARKER_UUID}.lock`);
  writeFileSync(path, String(pid));
  return path;
}

test('counts a live marker with a matching start identity', (t) => {
  const directory = temporaryDirectory(t);
  const marker = writeMarker(directory, 202);
  const activeRuns = support.countActiveRuns(
    directory,
    (pid) => pid === 202,
    (pid) => (pid === 202 ? START_ID : undefined),
  );

  assert.deepEqual(
    { activeRuns, markerExists: existsSync(marker) },
    { activeRuns: 1, markerExists: true },
  );
});

test('removes a reused pid and preserves the requested worker ceiling', (t) => {
  const directory = temporaryDirectory(t);
  const staleMarker = writeMarker(directory, 202);
  const ownMarker = writeMarker(directory, 303);
  const activeRuns = support.countActiveRuns(
    directory,
    (pid) => pid === 202 || pid === 303,
    (pid) => (pid === 202 ? 'Wed Oct 14 10:00:00 2026' : START_ID),
  );

  assert.deepEqual(
    {
      activeRuns,
      workerCount: support.selectWorkerCount(activeRuns, 4),
      staleMarkerExists: existsSync(staleMarker),
      ownMarkerExists: existsSync(ownMarker),
    },
    {
      activeRuns: 1,
      workerCount: 4,
      staleMarkerExists: false,
      ownMarkerExists: true,
    },
  );
});

for (const [name, probe, token = START_TOKEN] of [
  [
    'throwing',
    () => {
      throw new Error('probe failed');
    },
  ],
  ['undefined', () => undefined],
  ['null', () => null],
  ['empty', () => ''],
  ['legacy filename', () => 'different-start', ''],
  ['placeholder filename', () => START_ID, 'x'],
]) {
  test(`uses pid-only counting for ${name}`, (t) => {
    const directory = temporaryDirectory(t);
    const marker = writeMarker(directory, 202, token);
    const activeRuns = support.countActiveRuns(
      directory,
      (pid) => pid === 202,
      probe,
    );

    assert.deepEqual(
      { activeRuns, markerExists: existsSync(marker) },
      { activeRuns: 1, markerExists: true },
    );
  });
}

test('removes a dead pid even when the identity probe is unavailable', (t) => {
  const directory = temporaryDirectory(t);
  const marker = writeMarker(directory, 202);
  const activeRuns = support.countActiveRuns(
    directory,
    () => false,
    () => undefined,
  );

  assert.deepEqual(
    { activeRuns, markerExists: existsSync(marker) },
    { activeRuns: 0, markerExists: false },
  );
});

test('keeps a matching live run after more than seven minutes', (t) => {
  const directory = temporaryDirectory(t);
  const startedAt = new Date('2026-10-14T09:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: startedAt });
  const marker = writeMarker(directory, 202);
  utimesSync(marker, startedAt, startedAt);
  writeMarker(directory, 303);
  t.mock.timers.tick(8 * 60 * 1000);
  const activeRuns = support.countActiveRuns(
    directory,
    (pid) => pid === 202 || pid === 303,
    () => START_ID,
  );

  assert.deepEqual(
    {
      activeRuns,
      workerCount: support.selectWorkerCount(activeRuns, 4),
      markerExists: existsSync(marker),
    },
    { activeRuns: 2, workerCount: 1, markerExists: true },
  );
});

function runnerMarker(t, probe = 'real') {
  const directory = temporaryDirectory(t);
  const fixture = new URL(
    './fixtures/run-jest-identity-child.mjs',
    import.meta.url,
  );
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(fixture), probe, START_ID],
    {
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: directory },
      timeout: 5000,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

for (const [probe, expectedToken] of [
  ['real', undefined],
  ['matching', START_TOKEN],
  ['unavailable', 'x'],
]) {
  test(`runner marker with ${probe} probe survives old and new scans`, (t) => {
    const { token, ...marker } = runnerMarker(t, probe);
    if (probe === 'real') assert.match(token, /^(?:x|[a-f0-9]{16})$/);
    else assert.equal(token, expectedToken);
    assert.deepEqual(marker, {
      ownPid: true,
      activeRuns: 1,
      markerExists: true,
      oldActiveRuns: 1,
    });
  });
}

test('missing proc falls back to trimmed, bounded ps execution', () => {
  let invocation;
  const identity = support.processStartIdentity(
    202,
    (command, args, options) => {
      invocation = {
        command,
        args,
        encoding: options.encoding,
        timeout: options.timeout,
        killSignal: options.killSignal,
        stdio: options.stdio,
        locale: options.env.LC_ALL,
        timezone: options.env.TZ,
      };
      return `  ${START_ID}\n`;
    },
    missingProc,
  );

  assert.deepEqual(
    { identity, invocation },
    {
      identity: START_ID,
      invocation: {
        command: 'ps',
        args: ['-o', 'lstart=', '-p', '202'],
        encoding: 'utf8',
        timeout: 500,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'pipe', 'ignore'],
        locale: 'C',
        timezone: 'UTC',
      },
    },
  );
});

for (const code of ['ETIMEDOUT', 'ENOENT', 'EPERM']) {
  test(`the OS probe returns nothing for ${code}`, () => {
    assert.equal(
      support.processStartIdentity(
        202,
        () => {
          throw Object.assign(new Error('ps failed'), { code });
        },
        missingProc,
      ),
      undefined,
    );
  });
}

test('the OS probe returns nothing for blank ps output', () => {
  assert.equal(
    support.processStartIdentity(202, () => ' \n', missingProc),
    undefined,
  );
});

function missingProc() {
  throw Object.assign(new Error('proc unavailable'), { code: 'ENOENT' });
}

test('reads exact Linux start ticks after the last comm parenthesis', () => {
  let invocation;
  const identity = support.processStartIdentity(
    202,
    () => START_ID,
    (path, encoding) => {
      invocation = { path, encoding };
      return '202 (worker (pool) ) name) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 9876543210123456789 20\n';
    },
  );
  assert.deepEqual(
    { identity, invocation },
    {
      identity: '9876543210123456789',
      invocation: { path: '/proc/202/stat', encoding: 'utf8' },
    },
  );
});

for (const line of [
  '',
  '202 (worker) S 1',
  '202 worker S 1',
  '202 (worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 nope 20',
]) {
  test(`malformed proc stat returns nothing: ${line}`, () => {
    assert.equal(
      support.processStartIdentity(
        202,
        () => START_ID,
        () => line,
      ),
      undefined,
    );
  });
}

for (const [code, expected] of [
  ['ENOTDIR', START_ID],
  ['EPERM', undefined],
  ['EIO', undefined],
]) {
  test(`proc read failure ${code} preserves the fallback policy`, () => {
    assert.equal(
      support.processStartIdentity(
        202,
        () => START_ID,
        () => {
          throw Object.assign(new Error('proc failed'), { code });
        },
      ),
      expected,
    );
  });
}
