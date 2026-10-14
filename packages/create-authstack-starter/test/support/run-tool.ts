import { spawn } from 'node:child_process';
import { commandEnvironment } from '../../src/utils/exec.js';
import { stopProcessTree } from './process-tree.js';

export const BUILD_TIMEOUT = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface CommandResult {
  ok: boolean;
  output: string;
  stdout?: string;
}

export interface ToolOptions {
  cwd?: string;
  timeout?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

/** The leaders of the commands still running, stopped if this process exits first. */
const running = new Map<number, AbortSignal | undefined>();

process.once('exit', () => {
  for (const pid of running.keys()) stopProcessTree(pid);
});

export function killToolGroups(signal: AbortSignal): void {
  let failure: unknown;
  for (const [pid, owner] of running) {
    if (owner !== signal) continue;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') {
        failure ??= error;
      }
    }
  }
  if (failure !== undefined) throw failure;
}

/**
 * Runs a command as the leader of a process group of its own. A timeout or an
 * aborted signal stops everything it started, so a timed-out package manager
 * leaves no test runner behind it.
 */
export function runTool(
  executable: string,
  args: string[],
  options: ToolOptions = {},
): Promise<CommandResult> {
  const command = `${executable} ${args.join(' ')}`;
  if (options.signal?.aborted) {
    return Promise.resolve({
      ok: false,
      output: `Command failed: ${command}\nAborted before start`,
      stdout: '',
    });
  }

  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...commandEnvironment(), ...options.env, npm_config_update_notifier: 'false' },
    });
    const output = { stdout: '', stderr: '' };
    let ended: string | undefined;
    const end = (reason: string): void => {
      if (ended !== undefined) return;
      ended = reason;
      if (child.pid !== undefined) stopProcessTree(child.pid);
    };
    if (child.pid !== undefined) running.set(child.pid, options.signal);
    const timeoutMs = options.timeout ?? BUILD_TIMEOUT;
    const timer = setTimeout(() => end(`Timed out after ${timeoutMs} ms`), timeoutMs);
    const onAbort = (): void => end('Aborted');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', (chunk: string) => {
        output[stream] += chunk;
        if (output.stdout.length + output.stderr.length > MAX_OUTPUT_BYTES) {
          end(`Wrote more than ${MAX_OUTPUT_BYTES} bytes`);
        }
      });
    }

    let exit: number | null = null;
    let spawnError: Error | undefined;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('exit', (code) => {
      exit = code;
    });
    // `close` comes after every holder of the pipes has ended, children included.
    child.once('close', () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (child.pid !== undefined) running.delete(child.pid);
      if (ended === undefined && spawnError === undefined && exit === 0) {
        resolve({ ok: true, output: `${output.stdout}${output.stderr}`, stdout: output.stdout });
        return;
      }
      const reason = ended ?? spawnError?.message ?? `Exit code ${String(exit)}`;
      resolve({
        ok: false,
        stdout: output.stdout,
        output: [`Command failed: ${command}\n${reason}`, output.stdout, output.stderr]
          .map((part) => part.trimEnd())
          .filter(Boolean)
          .join('\n'),
      });
    });
  });
}
