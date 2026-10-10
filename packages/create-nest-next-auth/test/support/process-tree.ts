import { spawnSync } from 'node:child_process';

const KILL_SIGNAL = 'SIGKILL';
const POLL_INTERVAL_MS = 25;
/** How long a killed process tree may take to leave the process table. */
export const PROCESS_TREE_STOP_TIMEOUT_MS = 10_000;

interface ProcessRow {
  pid: number;
  parent: number;
  group: number;
  exited: boolean;
}

function processTable(): ProcessRow[] {
  const listed = spawnSync('ps', ['-Ao', 'pid=,ppid=,pgid=,stat='], { encoding: 'utf8' });
  if (listed.error) throw listed.error;
  return listed.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length === 4)
    .map(([pid, parent, group, state]) => ({
      pid: Number(pid),
      parent: Number(parent),
      group: Number(group),
      // A zombie has already exited and only waits for its parent to collect it.
      exited: state.startsWith('Z'),
    }));
}

/** Whether a process is in the table and has not exited. */
export function isRunning(pid: number): boolean {
  return processTable().some((row) => row.pid === pid && !row.exited);
}

/** Adds the leader's process group and every descendant of a process already owned. */
function claim(owned: Set<number>, leader: number, table: ProcessRow[]): void {
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of table) {
      if (owned.has(row.pid) || row.pid === process.pid) continue;
      if (row.group !== leader && !owned.has(row.parent)) continue;
      owned.add(row.pid);
      grew = true;
    }
  }
}

function kill(pid: number): void {
  try {
    process.kill(pid, KILL_SIGNAL);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
  }
}

/**
 * Stops everything a process-group leader started, then waits until none of it
 * is running. A group signal is not enough: pnpm gives each script its own
 * process group, so a hook's lint or test run outlives its hook.
 */
export function stopProcessTree(leader: number, timeout = PROCESS_TREE_STOP_TIMEOUT_MS): void {
  // 0 and 1 would claim this process group or every orphan on the machine.
  if (!Number.isSafeInteger(leader) || leader <= 1 || leader === process.pid)
    throw new RangeError(`Process ${leader} cannot be stopped as a process-group leader.`);
  // Not seeded with the leader: once it has exited, an unrelated process can hold its number.
  const owned = new Set<number>();
  const signalled = new Set<number>();
  const deadline = Date.now() + timeout;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const table = processTable();
    claim(owned, leader, table);
    const running = table.filter((row) => owned.has(row.pid) && !row.exited);
    if (running.length === 0) return;
    if (Date.now() > deadline) {
      const pids = running.map((row) => row.pid).join(', ');
      throw new Error(`Processes ${pids} were still running ${timeout} ms after being killed.`);
    }
    for (const row of running) {
      // Once only: a second signal could reach a process that took over the number.
      if (signalled.has(row.pid)) continue;
      signalled.add(row.pid);
      kill(row.pid);
    }
    Atomics.wait(pause, 0, 0, POLL_INTERVAL_MS);
  }
}
