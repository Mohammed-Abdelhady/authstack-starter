import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { CI_TERMINATION_SIGNALS, EXIT_CODES } from '../guardrails/policy.mjs';

export function selectGates(config, mode) {
  if (mode === '--install') return [config.install];
  if (mode === undefined) return config.gates;
  // A job runs one group of the list: `--quality` runs the gates of the group "quality".
  const gates = mode.startsWith('--')
    ? config.gates.filter((gate) => gate.group === mode.slice(2))
    : [];
  if (!gates.length) throw new Error(`Unknown CI mode: ${mode}`);
  return gates;
}

export async function runGates(gates, { cwd, env = process.env, log = console.log } = {}) {
  let child;
  let termination;
  const forward = (signal) => {
    termination = signal;
    if (!child?.pid) return;
    try {
      // Package-manager commands spawn grandchildren; signals must reach them.
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') log(`[ci] Could not forward ${signal}: ${error.message}`);
    }
  };
  const handlers = CI_TERMINATION_SIGNALS.map((signal) => [signal, () => forward(signal)]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    for (const gate of gates) {
      if (termination) return 128 + constants.signals[termination];
      log(`[ci] ${gate.name}`);
      const command = gate.command === 'node' ? process.execPath : gate.command;
      const status = await new Promise((resolve) => {
        let launchFailed = false;
        child = spawn(command, gate.args, {
          cwd,
          env: { ...env, ...gate.env },
          stdio: 'inherit',
          detached: process.platform !== 'win32',
        });
        child.once('error', (error) => {
          launchFailed = true;
          log(`[ci] ${gate.name}: ${error.message}`);
        });
        child.once('close', (code, signal) => {
          child = undefined;
          if (signal) log(`[ci] ${gate.name}: terminated by ${signal}`);
          resolve(
            termination
              ? 128 + constants.signals[termination]
              : launchFailed
                ? EXIT_CODES.ERROR
                : (code ?? EXIT_CODES.ERROR),
          );
        });
      });
      log(`[ci] ${gate.name}: exit ${status}`);
      if (status !== EXIT_CODES.OK) return status;
    }
    return EXIT_CODES.OK;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}
