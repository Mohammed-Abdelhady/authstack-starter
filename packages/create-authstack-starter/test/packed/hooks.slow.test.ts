import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { isolatedGit } from '../support/answers-helpers.js';
import { installProject } from '../support/combination-helpers.js';
import { exerciseInstalledHooks } from './packed-hook-cases.js';
import { startPackedCli, type Packed, scaffold } from './packed-cli.js';

let packed: Packed;

beforeAll(async () => {
  const started = startPackedCli();
  packed = started.packed;
  await started.ready;
  expect(packed.ok, packed.reason).toBe(true);
});

afterAll(async () => {
  await packed?.cleanup();
});

describe('packed projects with real installs and each hook alone', () => {
  it.each(['strict', 'standard'] as const)(
    '%s refuses staged lint, commit format and pushed lint errors without advancing refs',
    async (level) => {
      const { env } = isolatedGit(packed.workspace);
      const name = `installed-hooks-${level}`;
      const generated = scaffold(packed, name, 'email-password', {
        git: true,
        env,
        flags: ['--rules', level, '--no-docker', '--no-production'],
      });
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(0);
      const project = join(packed.workspace, name);
      const installed = await packed.runTask((signal) =>
        installProject(project, inject('pnpmStore'), signal),
      );
      expect(installed.ok, installed.output).toBe(true);
      exerciseInstalledHooks(project, env);
    },
  );
});
