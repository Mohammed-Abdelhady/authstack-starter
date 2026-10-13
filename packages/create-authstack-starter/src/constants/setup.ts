import { INSTALL_COMMAND, PACKAGE_MANAGER_VERSION } from './index.js';

export const SETUP_STATUS = {
  UPDATED: 'updated',
  REMOVED: 'removed',
  CREATED: 'created',
  FAILED: 'failed',
  NOT_REQUESTED: 'not-requested',
  INSTALLED: 'installed',
  BLOCKED: 'blocked',
} as const;

export const SETUP_CHECK = {
  PRUNING: 'template pruning',
  REFERENCES: 'dangling references',
  PACKAGE_MANAGER: 'pnpm version',
  LOCKFILE: 'lockfile update',
  GIT: 'git repository and first commit',
  INSTALL: 'dependency installation',
  LINT: 'lint',
  TYPECHECK: 'typecheck',
  TESTS: 'tests',
  BUILD: 'build',
  BANS: 'banned-construct scan',
  LENGTH: 'file length ceiling',
} as const;

export const HOOK_ACTIVATION = {
  GIT_AND_INSTALL: 'git init && pnpm install',
  GIT_AND_HUSKY: 'git init && pnpm exec husky',
  INSTALL: INSTALL_COMMAND,
  HUSKY: 'pnpm exec husky',
} as const;

export const COREPACK_ACTIVATION_COMMAND = `corepack enable && corepack prepare pnpm@${PACKAGE_MANAGER_VERSION} --activate`;
