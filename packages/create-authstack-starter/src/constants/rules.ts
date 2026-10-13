import TEMPLATE_TEST_POLICY from './template-tests.json' with { type: 'json' };

export const RULES_HOOK_PATHS = [
  '.husky/pre-commit',
  '.husky/pre-push',
  '.husky/commit-msg',
] as const;
export const RULES_WORKFLOW_PATH = '.github/workflows/ci.yml';
export const RULES_TRUSTED_WORKFLOW_PATH = '.github/workflows/trusted-scan.yml';
export const RULES_GATES_PATH = 'scripts/ci/gates.json';
export const RULES_POLICY_PATH = TEMPLATE_TEST_POLICY.POLICY_PATH;
export const RULES_SCANNER_ENTRY = 'scripts/check-hard-bans.mjs';
export const RULES_SCAN_GATE = 'Full-tree hard bans';
export const RULES_RANGE_JOB = 'range-scan';
export const RULES_SCAN_SCRIPT = 'check:bans';
export const RULES_QUALITY_DOC_PATH = TEMPLATE_TEST_POLICY.DOC_PATH;
export const RULES_DOC_INDEX_PATH = 'docs/README.md';
export const RULES_STANDARD_DOC_TEXT =
  "# Code quality\n\nSee `AGENTS.md` for this project's rules level, checks, commit format, and enforcement.\n";

export const ADD_RULES_RECEIPT = '.create-authstack-starter.rules.json';
export const LEGACY_ADD_RULES_RECEIPT = '.create-nest-next-auth.rules.json';
export const ADD_RULES_AGENT_COPY = 'AGENTS.rules.md';
export const ADD_RULES_SCRIPT_NAMES = ['lint', 'typecheck', 'test', 'build'] as const;
export const ADD_RULES_SETUP_PATHS = [
  '.husky',
  '.lintstagedrc',
  '.lintstagedrc.json',
  '.lintstagedrc.yaml',
  '.lintstagedrc.yml',
  '.lintstagedrc.js',
  '.lintstagedrc.cjs',
  '.lintstagedrc.mjs',
  '.lintstagedrc.ts',
  '.lintstagedrc.cts',
  '.lintstagedrc.mts',
  'package.yaml',
  'package.yml',
  'lint-staged.config.js',
  'lint-staged.config.cjs',
  'lint-staged.config.mjs',
  'lint-staged.config.ts',
  'lint-staged.config.cts',
  'lint-staged.config.mts',
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.yaml',
  '.commitlintrc.yml',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  '.commitlintrc.mjs',
  '.commitlintrc.ts',
  '.commitlintrc.cts',
  '.commitlintrc.mts',
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.mjs',
  'commitlint.config.ts',
  'commitlint.config.cts',
  'commitlint.config.mts',
] as const;
export const ADD_RULES_DEPENDENCIES = [
  'husky@^9.1.7',
  'lint-staged@^15.5.2',
  'prettier@^3.9.9',
  '@commitlint/cli@^18.6.1',
  '@commitlint/config-conventional@^18.6.3',
] as const;
/** How many folder levels are compared with the policy's capped folders. */
export const ADD_RULES_CEILING_DEPTH = 4;
export const ADD_RULES_ANY_SCOPE = 'any. The commit check does not restrict scopes.';
/** The entry husky 9.1 ships. The printed command and the tests that run it share it. */
export const ADD_RULES_HUSKY_ENTRY = 'node_modules/husky/bin.js';
export const ADD_RULES_HOOK_ACTIVATION = `node ${ADD_RULES_HUSKY_ENTRY}`;
export const ADD_RULES_LOCKFILES = {
  pnpm: 'pnpm-lock.yaml',
  npm: ['package', 'lock.json'].join('-'),
} as const;
export const ADD_RULES_UNSUPPORTED_LOCKFILES = ['yarn.lock', 'bun.lock', 'bun.lockb'] as const;

export const RULES_COMMIT_CONFIG = 'commitlint.config.cjs';
export const RULES_STAGED_CONFIG = '.lintstagedrc.cjs';
export const RULES_CI_ENTRY = 'scripts/ci.mjs';

export const ADD_RULES_GIT_BINARY = '/usr/bin/git';
