import { expect } from 'vitest';
import {
  installProject,
  runTool,
  typecheck,
  typecheckFrontendWithPrunedShared,
  writePrunedSharedTsconfig,
} from '../support/combination-helpers.js';

export async function expectTypechecks(project: string, signal?: AbortSignal): Promise<void> {
  const backend = await typecheck(project, 'backend', signal);
  expect(backend.ok, backend.output).toBe(true);
  const frontend = await typecheck(project, 'frontend', signal);
  expect(frontend.ok, frontend.output).toBe(true);
  const shared = await typecheck(project, 'shared/core', signal);
  expect(shared.ok, shared.output).toBe(true);
  const sdk = await typecheck(project, 'shared/sdk', signal);
  expect(sdk.ok, sdk.output).toBe(true);
}

/**
 * Runs the backend drift spec in the generated project. Feature pruning strips
 * marked error codes from both the backend enum and the shared package, so a
 * missing marker on either side shows up here, not in the typecheck.
 */
export async function expectDriftMatches(project: string): Promise<void> {
  const drift = await runTool(
    'pnpm',
    [
      '--filter',
      'backend',
      'exec',
      'jest',
      '--runInBand',
      '--runTestsByPath',
      'src/common/constants/shared-core-drift.spec.ts',
    ],
    { cwd: project },
  );
  expect(drift.ok, drift.output).toBe(true);
}

/**
 * Typechecks the generated frontend against its own pruned `shared/*` sources
 * through tsconfig paths. The plain typecheck reaches the same sources through
 * the linked node_modules, so this one guards the mapping a bundler would use.
 */
export async function expectPrunedShared(project: string): Promise<void> {
  await writePrunedSharedTsconfig(project);
  const pruned = await typecheckFrontendWithPrunedShared(project);
  expect(pruned.ok, pruned.output).toBe(true);
}

export async function expectLints(project: string, signal?: AbortSignal): Promise<void> {
  for (const workspaceName of ['backend', 'frontend']) {
    const lint = await runTool('pnpm', ['--filter', workspaceName, 'run', 'lint'], {
      cwd: project,
      signal,
    });
    expect(lint.ok, lint.output).toBe(true);
  }
}

/** Runs the generated frontend's own unit suite. */
export async function expectFrontendUnitTests(project: string): Promise<void> {
  const tests = await runTool('pnpm', ['--filter', 'frontend', 'run', 'test'], { cwd: project });
  expect(tests.ok, tests.output).toBe(true);
}

/** Runs the generated project's root configuration tests. */
export async function expectConfigTests(project: string, signal?: AbortSignal): Promise<void> {
  const tests = await runTool('pnpm', ['run', 'test:config'], { cwd: project, signal });
  expect(tests.ok, tests.output).toBe(true);
}

/**
 * Runs the generated backend's unit suite without a database. Integration and
 * concurrency specs both boot a MongoDB replica set, which the root backend e2e
 * gate covers; the rest is the honest unit subset.
 */
export async function expectBackendUnitTests(project: string): Promise<void> {
  const tests = await runTool(
    'pnpm',
    [
      '--filter',
      'backend',
      'exec',
      'jest',
      '--runInBand',
      '--testPathIgnorePatterns',
      '(integration|concurrency)\\.spec\\.ts$',
    ],
    { cwd: project },
  );
  expect(tests.ok, tests.output).toBe(true);
}

/**
 * Installs the way a user would, then typechecks, lints and builds. The signal
 * is the test's own: when the case runs out of time, the step in flight and
 * everything it started are stopped.
 */
export async function expectInstallsLintsBuilds(
  project: string,
  store: string,
  signal?: AbortSignal,
): Promise<void> {
  const install = await installProject(project, store, signal);
  expect(install.ok, install.output).toBe(true);

  await expectTypechecks(project, signal);
  await expectLints(project, signal);

  for (const workspaceName of ['backend', 'frontend']) {
    const build = await runTool('pnpm', ['--filter', workspaceName, 'run', 'build'], {
      cwd: project,
      signal,
    });
    expect(build.ok, build.output).toBe(true);
  }
}
