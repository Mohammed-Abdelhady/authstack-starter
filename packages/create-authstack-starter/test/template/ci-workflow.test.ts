import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../src/manifest/read.js';
import {
  CHECKOUT_ACTION,
  jobsOf,
  PNPM_SETUP_ACTION,
  PNPM_SETUP_WITH,
  readWorkflow,
  SETUP_NODE_ACTION,
  stepsOf,
} from '../support/ci-workflow-helpers.js';

const WORKFLOW = new URL('../../../../.github/workflows/ci.yml', import.meta.url);

/** The commands a job's steps run, in order. */
function runsOf(job: unknown): unknown[] {
  return stepsOf(job)
    .filter((step) => step.run)
    .map((step) => step.run);
}

describe('CI workflow contract', () => {
  it('uses fork-safe branch events with read-only permissions and ref concurrency', () => {
    const workflow = readWorkflow(WORKFLOW);
    expect(workflow.on).toEqual({
      pull_request: {
        branches: ['staging', 'master'],
        types: ['opened', 'synchronize', 'reopened'],
      },
      push: { branches: ['staging', 'master'] },
    });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency).toEqual({
      group:
        "${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}-${{ github.event_name == 'push' && github.run_id || '' }}",
      'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
    });
  });

  it('keeps the range scan independent of installation and checks event head with full history', () => {
    const scan = jobsOf(readWorkflow(WORKFLOW))['range-scan'];
    expect(scan).toMatchObject({ if: 'github.event.deleted != true' });
    expect(isRecord(scan) && scan.needs).toBeUndefined();
    const steps = stepsOf(scan);
    expect(steps.map((step) => step.run).filter(Boolean)).toEqual(['node scripts/ci.mjs --range']);
    expect(steps[0].with).toEqual({
      'fetch-depth': 0,
      ref: '${{ github.event.pull_request.head.sha || github.sha }}',
      'persist-credentials': false,
    });
    expect(steps[1].with).toEqual({ 'node-version-file': '.nvmrc' });
  });

  it('pins actions and keeps package-manager commands in the shared entry point', () => {
    const jobs = jobsOf(readWorkflow(WORKFLOW));
    expect(Object.keys(jobs)).toEqual([
      'range-scan',
      'quality',
      'api',
      'installer',
      'installer-postgres',
      'installer-mongodb',
      'browser',
      'dependency-audit',
    ]);
    for (const [id, job] of Object.entries(jobs)) {
      const steps = stepsOf(job);
      expect(steps[0].uses).toBe(CHECKOUT_ACTION);
      expect(steps[1].uses).toBe(SETUP_NODE_ACTION);
      for (const step of steps) {
        if (step.uses === PNPM_SETUP_ACTION)
          expect(step.with).toEqual(id === 'dependency-audit' ? undefined : PNPM_SETUP_WITH);
        if (typeof step.run !== 'string') continue;
        expect(step.run).toMatch(
          /^(?:node scripts\/ci\.mjs --(range|cache|install|quality|api|installer|installer-postgres|installer-mongodb|browser)|node scripts\/ci\/dependency-audit\.mjs)$/,
        );
      }
    }
    const rootPackage = JSON.parse(
      readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
    ) as { packageManager: string };
    expect(rootPackage.packageManager).toBe('pnpm@12.6.0');
    expect(stepsOf(jobs.quality)[2]).toMatchObject({
      uses: PNPM_SETUP_ACTION,
      with: PNPM_SETUP_WITH,
    });
    expect(stepsOf(jobs.installer)[2]).toMatchObject({
      uses: PNPM_SETUP_ACTION,
      with: PNPM_SETUP_WITH,
    });
    expect(
      stepsOf(jobs.quality)
        .filter((step) => step.run)
        .map((step) => step.run),
    ).toEqual([
      'node scripts/ci.mjs --cache',
      'node scripts/ci.mjs --install',
      'node scripts/ci.mjs --quality',
    ]);
    expect(
      stepsOf(jobs.installer)
        .filter((step) => step.run)
        .map((step) => step.run),
    ).toEqual([
      'node scripts/ci.mjs --cache',
      'node scripts/ci.mjs --install',
      'node scripts/ci.mjs --installer',
    ]);
    expect(runsOf(jobs['dependency-audit'])).toEqual(['node scripts/ci/dependency-audit.mjs']);
    expect(stepsOf(jobs['dependency-audit'])[2]).toEqual({ uses: PNPM_SETUP_ACTION });
    expect(runsOf(jobs.api)).toEqual([
      'node scripts/ci.mjs --cache',
      'node scripts/ci.mjs --install',
      'node scripts/ci.mjs --api',
    ]);
    expect(runsOf(jobs.browser)).toEqual([
      'node scripts/ci.mjs --install',
      'node scripts/ci.mjs --browser',
    ]);
    // The PostgreSQL projects start the server their own dependency carries.
    expect(runsOf(jobs['installer-postgres'])).toEqual([
      'node scripts/ci.mjs --install',
      'node scripts/ci.mjs --installer-postgres',
    ]);
    expect(runsOf(jobs['installer-mongodb'])).toEqual([
      'node scripts/ci.mjs --cache',
      'node scripts/ci.mjs --install',
      'node scripts/ci.mjs --installer-mongodb',
    ]);
    for (const id of ['api', 'installer', 'installer-postgres', 'installer-mongodb', 'browser']) {
      const job = jobs[id];
      expect(job).toMatchObject({ if: 'github.event.deleted != true' });
      expect(isRecord(job) && job.needs).toBeUndefined();
      expect(stepsOf(job)[2]).toMatchObject({ uses: PNPM_SETUP_ACTION, with: PNPM_SETUP_WITH });
    }
  });
});

const TRUSTED = new URL('../../../../.github/workflows/trusted-scan.yml', import.meta.url);

it('uses only base code in the read-only trusted scan', () => {
  const workflow = readWorkflow(TRUSTED);
  expect(workflow.on).toEqual({
    pull_request_target: {
      branches: ['staging', 'master'],
      types: ['opened', 'synchronize', 'reopened', 'edited'],
    },
  });
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(workflow.concurrency).toEqual({
    group: '${{ github.workflow }}-${{ github.event.pull_request.number }}',
    'cancel-in-progress': true,
  });
  const jobs = jobsOf(workflow);
  expect(Object.keys(jobs)).toEqual(['trusted-range']);
  const steps = stepsOf(jobs['trusted-range']);
  expect(steps[0]).toMatchObject({
    uses: CHECKOUT_ACTION,
    with: {
      ref: '${{ github.event.pull_request.base.sha }}',
      'fetch-depth': 0,
      'persist-credentials': false,
    },
  });
  expect(steps[1]).toMatchObject({
    uses: SETUP_NODE_ACTION,
    with: { 'node-version-file': '.nvmrc' },
  });
  expect(steps[2]).toMatchObject({
    id: 'fetch',
    env: {
      BASE_REF: '${{ github.event.pull_request.base.ref }}',
      HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
      GITHUB_TOKEN: '${{ github.token }}',
    },
    run: 'node scripts/ci.mjs --fetch',
  });
  expect(steps[3]).toMatchObject({
    env: {
      BASE_SHA: '${{ github.event.pull_request.base.sha }}',
      HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
      CURRENT_BASE_SHA: '${{ steps.fetch.outputs.base }}',
    },
    run: 'node scripts/ci.mjs --range "$BASE_SHA" "$HEAD_SHA" "$CURRENT_BASE_SHA"',
  });
  expect(steps).toHaveLength(4);
  expect(readFileSync(TRUSTED, 'utf8')).not.toMatch(/\$\{\{\s*secrets\./);
});
