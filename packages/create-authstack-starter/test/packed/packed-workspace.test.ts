import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';
import { preparePackedWorkspace } from './packed-workspace.js';
import { startWorkspaceProbe } from './workspace-probe.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('packed workspace setup failures', () => {
  it.each(['mkdirSync', 'writeFileSync', 'chmodSync'] as const)(
    'removes the workspace and propagates a %s failure',
    (step) => {
      const root = mkdtempSync(join(tmpdir(), 'cna-setup-test-'));
      roots.push(root);
      const failure = new Error('Setup failed');
      const filesystem = {
        mkdirSync,
        writeFileSync,
        chmodSync,
        [step]: () => {
          throw failure;
        },
      };

      let caught: unknown;
      try {
        preparePackedWorkspace(root, filesystem);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(failure);
      expect(readdirSync(root)).toEqual([]);
    },
  );
});

describe('packed commands', () => {
  function workspace(): ReturnType<typeof preparePackedWorkspace> {
    const packed = preparePackedWorkspace();
    onTestFinished(packed.cleanup);
    return packed;
  }

  it('passes cwd and environment, closes stdin, and separates stdout from stderr', async () => {
    const packed = workspace();
    const result = await packed.runCommand(
      process.execPath,
      [
        '-e',
        `process.stdin.on('end', () => {
        process.stdout.write([process.cwd() === process.argv[1] ? 'workspace' : 'wrong',
          process.env.PACKED_COMMAND_ENV, 'eof'].join(':'));
        process.stderr.write('diagnostic');
      }).resume();`,
        realpathSync(packed.workspace),
      ],
      { cwd: packed.workspace, env: { PACKED_COMMAND_ENV: 'probe' } },
    );
    expect(result).toEqual({
      ok: true,
      stdout: 'workspace:probe:eof',
      output: 'workspace:probe:eofdiagnostic',
    });
  });

  it.each([
    [8_388_607, 8_388_607],
    [8_388_608, 8_388_608],
  ] as const)('accepts %i characters within the shared output limit', async (size, expected) => {
    const result = await workspace().runCommand(process.execPath, [
      '-e',
      "process.stdout.write('x'.repeat(Number(process.argv[1])));",
      String(size),
    ]);
    expect({ ok: result.ok, length: result.stdout?.length }).toEqual({
      ok: true,
      length: expected,
    });
  });

  it('stops commands that exceed the shared output limit', async () => {
    const result = await workspace().runCommand(process.execPath, [
      '-e',
      "process.stdout.write('x'.repeat(16_777_216));",
    ]);
    expect({
      ok: result.ok,
      capped: result.output.includes('Wrote more than 8388608 bytes'),
    }).toEqual({ ok: false, capped: true });
  });

  it('reports a failed command with separate stdout and diagnostic output', async () => {
    const result = await workspace().runCommand(process.execPath, [
      '-e',
      "process.stdout.write('details'); process.stderr.write('failed'); process.exitCode = 7;",
    ]);
    expect({
      ok: result.ok,
      stdout: result.stdout,
      diagnostic: result.output.endsWith('\nExit code 7\ndetails\nfailed'),
    }).toEqual({ ok: false, stdout: 'details', diagnostic: true });
  });

  it('rejects readiness when the command fails before its handshake', async () => {
    const probe = startWorkspaceProbe(workspace(), 'failed');
    onTestFinished(probe.close);
    await expect(probe.ready).rejects.toThrow('Exit code 7');
  });

  it('reports a missing executable', async () => {
    const result = await workspace().runCommand('/nonexistent/authstack-test-command', []);
    expect({
      ok: result.ok,
      stdout: result.stdout,
      missing: result.output.includes('ENOENT'),
    }).toEqual({ ok: false, stdout: '', missing: true });
  });
});
