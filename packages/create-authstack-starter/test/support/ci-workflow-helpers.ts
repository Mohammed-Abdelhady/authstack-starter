import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { parseDocument } from 'yaml';
import { isRecord } from '../../src/manifest/read.js';

export const CHECKOUT_ACTION = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683';
export const SETUP_NODE_ACTION = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
export const PNPM_SETUP_ACTION = 'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413';
export const CACHE_ACTION = 'actions/cache@5a3ec84eff668545956fd18022155c47e93e2684';

const ACTION_INPUT_KEYS_BY_PINNED_REF: Record<string, readonly string[]> = {
  [CHECKOUT_ACTION]: [
    'repository',
    'ref',
    'token',
    'ssh-key',
    'ssh-known-hosts',
    'ssh-strict',
    'ssh-user',
    'persist-credentials',
    'path',
    'clean',
    'filter',
    'sparse-checkout',
    'sparse-checkout-cone-mode',
    'fetch-depth',
    'fetch-tags',
    'show-progress',
    'lfs',
    'submodules',
    'set-safe-directory',
    'github-server-url',
  ],
  [SETUP_NODE_ACTION]: [
    'always-auth',
    'node-version',
    'node-version-file',
    'architecture',
    'check-latest',
    'registry-url',
    'scope',
    'token',
    'cache',
    'cache-dependency-path',
    'mirror',
    'mirror-token',
  ],
  [PNPM_SETUP_ACTION]: [
    'version',
    'dest',
    'run_install',
    'cache',
    'cache_dependency_path',
    'package_json_file',
    'standalone',
  ],
  [CACHE_ACTION]: [
    'path',
    'key',
    'restore-keys',
    'upload-chunk-size',
    'enableCrossOsArchive',
    'fail-on-cache-miss',
    'lookup-only',
    'save-always',
  ],
};

export const PNPM_SETUP_WITH = {
  version: '12.6.0',
  run_install: false,
  cache: true,
  cache_dependency_path: 'pnpm-lock.yaml',
};

export function readWorkflow(path: URL | string): Record<string, unknown> {
  const document = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.join('\n'));
  const value: unknown = document.toJS();
  if (!isRecord(value)) throw new Error('Workflow must be a mapping');
  return value;
}

export function jobsOf(workflow: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(workflow.jobs)) throw new Error('Workflow jobs must be a mapping');
  return workflow.jobs;
}

export function stepsOf(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.steps)) throw new Error('Job steps missing');
  return value.steps.map((step: unknown) => {
    if (!isRecord(step)) throw new Error('Step must be a mapping');
    return step;
  });
}

export function expectSupportedActionInputs(
  workflows: readonly { name: string; workflow: Record<string, unknown> }[],
): void {
  for (const { name, workflow } of workflows) {
    for (const [jobName, job] of Object.entries(jobsOf(workflow))) {
      for (const [stepIndex, step] of stepsOf(job).entries()) {
        if (typeof step.uses !== 'string') continue;
        const allowedInputs = Object.hasOwn(ACTION_INPUT_KEYS_BY_PINNED_REF, step.uses)
          ? ACTION_INPUT_KEYS_BY_PINNED_REF[step.uses]
          : undefined;
        if (allowedInputs === undefined) {
          throw new Error(`${name} job ${jobName} step ${stepIndex} has an unlisted action ref`);
        }
        if (step.with === undefined) continue;
        if (!isRecord(step.with)) {
          throw new Error(`${name} job ${jobName} step ${stepIndex} inputs must be a mapping`);
        }
        for (const input of Object.keys(step.with)) {
          expect(
            allowedInputs,
            `${name} job ${jobName} step ${stepIndex} uses ${step.uses}`,
          ).toContain(input);
        }
      }
    }
  }
}
