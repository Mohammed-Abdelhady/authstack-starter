import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  BACKEND_TEST_POSTGRES_DATA_PREFIX,
  removeOrphanedPostgresData,
} from './postgres-orphans.mjs';

const DEAD_OWNER = 4001;
const LIVE_OWNER = 4002;
const POSTMASTER = 5001;

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'postgres-orphans-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const folder = (owner, postmasterPid) => {
    const name = `${BACKEND_TEST_POSTGRES_DATA_PREFIX}${owner}-abc123`;
    mkdirSync(join(parent, name));
    if (postmasterPid !== undefined) {
      writeFileSync(
        join(parent, name, 'postmaster.pid'),
        `${postmasterPid}\n${parent}\n`,
      );
    }
    return name;
  };
  return { parent, folder };
}

function probes({ alive, commands = {} }) {
  const signals = [];
  return {
    signals,
    isAlive: (pid) => alive.includes(pid),
    commandOf: (pid) => commands[pid],
    signal: (pid, signal) => signals.push([pid, signal]),
  };
}

test('a dead owner with a running server: the server is stopped and the folder removed', (t) => {
  const { parent, folder } = fixture(t);
  const name = folder(DEAD_OWNER, POSTMASTER);
  const fake = probes({
    alive: [POSTMASTER],
    commands: { [POSTMASTER]: `postgres -D ${join(parent, name)} -p 5999` },
  });

  const result = removeOrphanedPostgresData(parent, fake);

  assert.deepEqual(
    { result, signals: fake.signals, left: existsSync(join(parent, name)) },
    {
      result: { stopped: [POSTMASTER], removed: [name] },
      signals: [[POSTMASTER, 'SIGQUIT']],
      left: false,
    },
  );
});

test('a live owner keeps its folder and its server', (t) => {
  const { parent, folder } = fixture(t);
  const name = folder(LIVE_OWNER, POSTMASTER);
  const fake = probes({
    alive: [LIVE_OWNER, POSTMASTER],
    commands: { [POSTMASTER]: `postgres -D ${join(parent, name)}` },
  });

  const result = removeOrphanedPostgresData(parent, fake);

  assert.deepEqual(
    { result, signals: fake.signals, left: existsSync(join(parent, name)) },
    { result: { stopped: [], removed: [] }, signals: [], left: true },
  );
});

test('a recorded pid that now belongs to another program is not signalled', (t) => {
  const { parent, folder } = fixture(t);
  const name = folder(DEAD_OWNER, POSTMASTER);
  const fake = probes({
    alive: [POSTMASTER],
    commands: { [POSTMASTER]: 'vim notes.txt' },
  });

  const result = removeOrphanedPostgresData(parent, fake);

  assert.deepEqual(
    { result, signals: fake.signals },
    { result: { stopped: [], removed: [name] }, signals: [] },
  );
});

test('a recorded pid whose command line cannot be read is not signalled', (t) => {
  const { parent, folder } = fixture(t);
  const name = folder(DEAD_OWNER, POSTMASTER);
  const fake = probes({ alive: [POSTMASTER] });

  const result = removeOrphanedPostgresData(parent, fake);

  assert.deepEqual(
    { result, signals: fake.signals },
    { result: { stopped: [], removed: [name] }, signals: [] },
  );
});

test('a dead owner with no server left, or no pid file, only loses its folder', (t) => {
  const { parent, folder } = fixture(t);
  const stopped = folder(DEAD_OWNER, POSTMASTER);
  const fake = probes({ alive: [] });

  const result = removeOrphanedPostgresData(parent, fake);

  assert.deepEqual(
    { result, signals: fake.signals },
    {
      result: { stopped: [], removed: [stopped] },
      signals: [],
    },
  );
});

test('a pid file that is not a number and folders of other tools are left to their rules', (t) => {
  const { parent, folder } = fixture(t);
  const name = folder(DEAD_OWNER, 'not-a-pid');
  mkdirSync(join(parent, 'backend-jest-mongo-4001-abc'));
  mkdirSync(join(parent, `${BACKEND_TEST_POSTGRES_DATA_PREFIX}nopid`));
  const fake = probes({ alive: [] });

  const result = removeOrphanedPostgresData(parent, fake);

  assert.deepEqual(
    {
      result,
      signals: fake.signals,
      mongoLeft: existsSync(join(parent, 'backend-jest-mongo-4001-abc')),
      unownedLeft: existsSync(
        join(parent, `${BACKEND_TEST_POSTGRES_DATA_PREFIX}nopid`),
      ),
    },
    {
      result: { stopped: [], removed: [name] },
      signals: [],
      mongoLeft: true,
      unownedLeft: true,
    },
  );
});
