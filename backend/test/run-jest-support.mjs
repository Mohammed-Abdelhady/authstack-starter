import { readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function countActiveRuns(runDirectory, isProcessAlive) {
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
