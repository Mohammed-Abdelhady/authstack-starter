import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PROCESS_PROBE_TIMEOUT_MS = 500;
const UNKNOWN_START_TOKEN = 'x';
const IDENTITY_MARKER_NAME =
  /^(\d+)-([a-f0-9]{16}|x)-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.lock$/;

export function processStartIdentityToken(identity) {
  return identity
    ? createHash('sha256').update(identity).digest('hex').slice(0, 16)
    : UNKNOWN_START_TOKEN;
}

export function processStartIdentity(
  pid,
  runPs = execFileSync,
  readStat = readFileSync,
) {
  try {
    const stat = readStat(`/proc/${pid}/stat`, 'utf8');
    // comm may contain spaces and parentheses; field 3 follows its last ')'.
    const commEnd = stat.lastIndexOf(')');
    if (commEnd < 0) return undefined;
    const startTicks = stat
      .slice(commEnd + 1)
      .trim()
      .split(/\s+/)[19];
    return /^\d+$/.test(startTicks ?? '') ? startTicks : undefined;
  } catch (error) {
    if (errorCode(error) !== 'ENOENT' && errorCode(error) !== 'ENOTDIR') {
      return undefined;
    }
  }
  try {
    return (
      runPs('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: PROCESS_PROBE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

export function countActiveRuns(
  runDirectory,
  isProcessAlive,
  probeStartIdentity = processStartIdentity,
) {
  let activeRuns = 0;
  for (const filename of readdirSync(runDirectory)) {
    if (!filename.endsWith('.lock')) continue;
    const path = resolve(runDirectory, filename);
    let markerContents;
    try {
      markerContents = readFileSync(path, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      throw error;
    }
    const pid = /^\d+$/.test(markerContents)
      ? Number(markerContents)
      : Number.NaN;
    if (!Number.isInteger(pid) || pid < 1 || !isProcessAlive(pid)) {
      removeFile(path);
      continue;
    }
    const identityMarker = IDENTITY_MARKER_NAME.exec(filename);
    const recordedToken =
      identityMarker && Number(identityMarker[1]) === pid
        ? identityMarker[2]
        : undefined;
    let currentStartId;
    if (recordedToken && recordedToken !== UNKNOWN_START_TOKEN) {
      try {
        currentStartId = probeStartIdentity(pid);
      } catch {
        // An unavailable identity leaves the pid-only liveness check in force.
      }
      if (
        currentStartId &&
        processStartIdentityToken(currentStartId) !== recordedToken
      ) {
        removeFile(path);
        continue;
      }
    }
    activeRuns += 1;
  }
  return activeRuns;
}

// A run that was interrupted never reaches global teardown, so its data
// directories are swept by the next run once their owning process is gone.
export function removeOrphanedDataDirectories(
  parentDirectory,
  prefix,
  isProcessAlive,
) {
  const removed = [];
  for (const entry of readdirSync(parentDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const owner = /^(\d+)-./.exec(entry.name.slice(prefix.length));
    const pid = owner ? Number(owner[1]) : Number.NaN;
    if (!Number.isInteger(pid) || pid < 1 || isProcessAlive(pid)) continue;
    rmSync(resolve(parentDirectory, entry.name), {
      recursive: true,
      force: true,
    });
    removed.push(entry.name);
  }
  return removed;
}

export function processExists(pid, checkProcess) {
  try {
    checkProcess(pid);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

export function requestedWorkerCount(args, fallback, parallelism) {
  if (args.includes('--runInBand')) return 1;
  const optionIndex = args.findIndex(
    (value) => value === '--maxWorkers' || value === '-w',
  );
  const inlineOption = args.find((value) => value.startsWith('--maxWorkers='));
  const value =
    inlineOption?.slice('--maxWorkers='.length) ??
    (optionIndex >= 0 ? args[optionIndex + 1] : undefined);
  if (value === undefined) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (value.trim().endsWith('%') && parsed > 0 && parsed <= 100) {
    return Math.max(1, Math.floor((parsed / 100) * parallelism));
  }
  return parsed > 0 ? parsed : fallback;
}

const WORKER_MEMORY_BUDGET_BYTES = 2 * 1024 ** 3;

export function selectWorkerCount(
  activeRuns,
  requestedWorkers,
  freeMemoryBytes,
) {
  if (activeRuns > 1) return 1;
  if (freeMemoryBytes === undefined) return requestedWorkers;
  const memoryWorkers = Number.isFinite(freeMemoryBytes)
    ? Math.max(1, Math.floor(freeMemoryBytes / WORKER_MEMORY_BUDGET_BYTES))
    : 1;
  return Math.min(requestedWorkers, memoryWorkers);
}

export function normalizeWorkerArguments(args, workerCount) {
  const normalized = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--') continue;
    if (value === '--runInBand' || value.startsWith('--maxWorkers=')) continue;
    if (value === '--maxWorkers' || value === '-w') {
      index += 1;
      continue;
    }
    normalized.push(value);
  }

  if (args.includes('--runInBand')) {
    normalized.push('--runInBand');
  } else {
    normalized.push(`--maxWorkers=${workerCount}`);
  }
  return normalized;
}

export function resolveJestCli(packageJsonPath) {
  const packageMetadata = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const binPath =
    typeof packageMetadata.bin === 'string'
      ? packageMetadata.bin
      : packageMetadata.bin?.jest;
  if (typeof binPath !== 'string') {
    throw new Error('Jest package metadata does not declare a CLI binary');
  }
  return resolve(dirname(packageJsonPath), binPath);
}

export async function runWithMarker(operation, removeMarker) {
  try {
    return await operation();
  } finally {
    removeMarker();
  }
}

export function childExitCode(code, signal) {
  if (signal) return 128 + (signal === 'SIGINT' ? 2 : 15);
  return code ?? 1;
}

export function removeFile(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

export function errorCode(error) {
  if (
    error === null ||
    typeof error !== 'object' ||
    !('code' in error) ||
    typeof error.code !== 'string'
  ) {
    return undefined;
  }
  return error.code;
}
