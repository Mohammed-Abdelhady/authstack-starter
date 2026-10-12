// Runs one PostgreSQL server for a test suite and stops it when the suite's
// process goes away. Usage: node postgres-server.mjs <owner-pid>
//
// It removes data folders that dead test processes left, creates its own, and
// prints one line of JSON once the server accepts connections:
// {"port": number, "password": string, "dataDirectory": string}.
// Closing its standard input stops the server and removes the data folder, so
// a dead parent never leaves a server behind.
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import {
  BACKEND_TEST_POSTGRES_DATA_PREFIX,
  removeOrphanedPostgresData,
} from './postgres-orphans.mjs';

const HOST = '127.0.0.1';
const USER = 'postgres';
const LOG_LINES_KEPT = 50;
// Durability is off: the data lives for one suite and is then deleted.
const SERVER_FLAGS = [
  '-c',
  `listen_addresses=${HOST}`,
  '-c',
  'fsync=off',
  '-c',
  'synchronous_commit=off',
  '-c',
  'full_page_writes=off',
];

const ownerPid = process.argv[2];
if (!/^\d+$/.test(ownerPid ?? '')) {
  console.error('postgres-server: the owning process id is required');
  process.exit(2);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const serverLog = [];
const remember = (message) => {
  serverLog.push(String(message));
  if (serverLog.length > LOG_LINES_KEPT) serverLog.shift();
};

const swept = removeOrphanedPostgresData(tmpdir());
if (swept.removed.length > 0) {
  console.error(
    `[jest-postgres] removed orphaned data=${swept.removed.join(',')}`,
  );
}

const dataDirectory = await mkdtemp(
  join(tmpdir(), `${BACKEND_TEST_POSTGRES_DATA_PREFIX}${ownerPid}-`),
);
const password = randomBytes(24).toString('hex');
const port = await freePort();
const server = new EmbeddedPostgres({
  databaseDir: dataDirectory,
  port,
  user: USER,
  password,
  authMethod: 'scram-sha-256',
  persistent: false,
  postgresFlags: SERVER_FLAGS,
  onLog: remember,
  onError: remember,
});

let stopping;
function stop(exitCode) {
  stopping ??= server
    .stop()
    .catch(() => undefined)
    .then(() => rm(dataDirectory, { recursive: true, force: true }))
    .catch(() => undefined)
    .then(() => process.exit(exitCode));
  return stopping;
}

process.stdin.on('end', () => stop(0));
process.stdin.on('close', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
process.stdin.resume();

try {
  await server.initialise();
  await server.start();
  process.stdout.write(
    `${JSON.stringify({ port, password, dataDirectory })}\n`,
  );
} catch (error) {
  console.error(
    `postgres-server: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error(serverLog.join(''));
  await stop(1);
}
