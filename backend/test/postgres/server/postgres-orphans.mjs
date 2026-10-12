import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  processExists,
  removeOrphanedDataDirectories,
} from '../../run-jest-support.mjs';

export const BACKEND_TEST_POSTGRES_DATA_PREFIX = 'backend-jest-postgres-';

const POSTMASTER_PID_FILE = 'postmaster.pid';
// Immediate shutdown: the server exits without a checkpoint and frees its memory.
const POSTMASTER_STOP_SIGNAL = 'SIGQUIT';

export const systemProbes = {
  isAlive: (pid) =>
    processExists(pid, (candidate) => process.kill(candidate, 0)),
  // The process's command line, or nothing when it cannot be read.
  commandOf: (pid) => {
    try {
      return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
        encoding: 'utf8',
      });
    } catch {
      return undefined;
    }
  },
  signal: (pid, signal) => process.kill(pid, signal),
};

function ownerOf(directory, prefix) {
  const owner = /^(\d+)-./.exec(directory.slice(prefix.length));
  return owner ? Number(owner[1]) : Number.NaN;
}

function postmasterOf(dataDirectory) {
  let firstLine;
  try {
    firstLine = readFileSync(join(dataDirectory, POSTMASTER_PID_FILE), 'utf8')
      .split('\n')[0]
      .trim();
  } catch {
    return Number.NaN;
  }
  return /^\d+$/.test(firstLine) ? Number(firstLine) : Number.NaN;
}

// Stops servers whose test process is gone. A pid is signalled only when its
// command line names the data directory, so a reused pid is left alone and a
// server that has already exited, which has no command line, is skipped.
export function stopOrphanedPostmasters(parentDirectory, prefix, probes) {
  const stopped = [];
  for (const entry of readdirSync(parentDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const owner = ownerOf(entry.name, prefix);
    if (!Number.isInteger(owner) || owner < 1 || probes.isAlive(owner))
      continue;
    const dataDirectory = join(parentDirectory, entry.name);
    const postmaster = postmasterOf(dataDirectory);
    if (!Number.isInteger(postmaster) || postmaster < 1) continue;
    if (!probes.commandOf(postmaster)?.includes(dataDirectory)) continue;
    probes.signal(postmaster, POSTMASTER_STOP_SIGNAL);
    stopped.push(postmaster);
  }
  return stopped;
}

// Stops abandoned servers, then removes the data folders dead processes left.
export function removeOrphanedPostgresData(
  parentDirectory,
  probes = systemProbes,
) {
  const stopped = stopOrphanedPostmasters(
    parentDirectory,
    BACKEND_TEST_POSTGRES_DATA_PREFIX,
    probes,
  );
  const removed = removeOrphanedDataDirectories(
    parentDirectory,
    BACKEND_TEST_POSTGRES_DATA_PREFIX,
    probes.isAlive,
  );
  return { stopped, removed };
}
