import GIT_ENVIRONMENT from './git-environment.json' with { type: 'json' };
import PACKAGE_MANAGER_CONFIG from './package-manager.json' with { type: 'json' };
import type { FeatureKind, RulesPolicy } from '../types.js';

/** Every kind a user can pick from the prompt. */
type PromptedKind = Exclude<FeatureKind, 'hidden'>;

export const CLI_NAME = 'create-authstack-starter';

export const MANIFEST_FILE = 'template.manifest.json';
/** Each database's rewrites, beside the manifest and read with it. */
export const REWRITES_FILE = 'template.rewrites.json';

export const TEMPLATE_DIR_NAME = 'template';

/** Manifest version this package writes and understands. */
export const MANIFEST_VERSION = 2;

/** Preset applied when none was named. Used only when the manifest defines it. */
export const DEFAULT_PRESET_ID = 'standard';

/** The target whose sign-in pages a native shell borrows. */
export const WEB_TARGET_ID = 'web';

/** Synthetic plan entry for the browser sign-in pages a native shell needs. */
export const SIGN_IN_SITE_ID = 'web-sign-in-pages';

export const SIGN_IN_SITE_LABEL = 'web sign-in pages';

/** Option ids toggled by dedicated flags. */
export const DOCKER_OPTION_ID = 'docker';

export const PRODUCTION_OPTION_ID = 'production';

export const LOCALE_AR_OPTION_ID = 'locale-ar';

/** Locale every generated project ships. Not owned by an option. */
export const REQUIRED_LOCALE_ID = 'en';

/** Which locale each manifest option switches on, keyed by the option id. */
export const LOCALE_OPTION_LOCALES: Record<string, string> = {
  [LOCALE_AR_OPTION_ID]: 'ar',
};

/** Locales a generated project can carry today. */
export const LOCALE_IDS: readonly string[] = [
  REQUIRED_LOCALE_ID,
  ...Object.values(LOCALE_OPTION_LOCALES),
];

/**
 * Frame for errors that mean the published package itself is damaged, and the
 * hint every one of them ends with.
 */
export const BROKEN_PACKAGE = 'This copy of create-authstack-starter is broken';

export const REINSTALL_HINT = 'Reinstall it and try again.';

/** Exit code for every usage error: bad flags, bad config, bad selection. */
export const USAGE_EXIT_CODE = 2;

/** Exit code when the installed package itself is damaged, not the input. */
export const BROKEN_PACKAGE_EXIT_CODE = 3;

/** Preset keywords, kept together so validation and resolution agree. */
export const PRESET_KEYWORDS = ['available', 'defaults'] as const;

/** Env example files the pruner edits, relative to a generated project. */
export const ENV_EXAMPLE_FILES = [
  'backend/.env.example',
  '.env.docker.example',
  'frontend/.env.example',
] as const;

/** Root manifest whose scripts can belong to a project option. */
export const ROOT_PACKAGE_JSON = 'package.json';

/** Frontend manifest whose scripts the scaffold rewrites. */
export const FRONTEND_PACKAGE_JSON = 'frontend/package.json';

export const PLAYWRIGHT_SCRIPT_NAMES = [
  'test:e2e',
  'test:e2e:ui',
  'test:e2e:headed',
  'test:e2e:debug',
] as const;

export const BROWSER_STACK_PACKAGES = [
  '@playwright/test',
  'playwright',
  '@axe-core/playwright',
] as const;

/** Backend manifest the scaffold strips repository-only tooling from. */
export const BACKEND_PACKAGE_JSON = 'backend/package.json';

/**
 * The mobile engine, which the backend needs only for the suites that drive it
 * against the real server. Those suites are in alwaysRemoveFiles too.
 */
export const ENGINE_SUITE_PACKAGES = ['@app/native-auth'] as const;

/**
 * Marks lines that only choose between databases. A generated project carries
 * one database, so these lines are removed from every one.
 */
export const DATABASE_CHOICE_MARKER_ID = 'database-choice';

/** The setting that chooses between databases, gone with those lines. */
export const DATABASE_CHOICE_ENV_VARS = ['DATABASE_TYPE'] as const;

/** Words that name that setting in the comment above it. */
export const DATABASE_CHOICE_WORDS = ['database'];

export const PACKAGE_DEPENDENCY_GROUPS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/** Env var written into backend/.env.example with the enabled feature ids. */
export const FEATURE_FLAG_VAR = 'AUTH_FEATURES';

/** File a generated project gets at its root, recording how it was made. */
export const ANSWERS_FILE_NAME = '.create-authstack-starter.json';
export const LEGACY_ANSWERS_FILE_NAME = '.create-nest-next-auth.json';

/** Version of that file's shape. Bumped only when the contract changes. */
export const ANSWERS_SCHEMA_VERSION = 3;
export const PREVIOUS_ANSWERS_SCHEMA_VERSION = 2;
export const RULES_POLICY = { STRICT: 'strict', STANDARD: 'standard' } as const;
export const RULES_POLICIES = [RULES_POLICY.STRICT, RULES_POLICY.STANDARD] as const;
export const DEFAULT_RULES_POLICY: RulesPolicy = RULES_POLICY.STRICT;

/** Build artifact next to `template/`: the SHA-256 of the shipped template. */
export const TEMPLATE_IDENTITY_FILE = 'template.identity.json';

/** Shape of a hex SHA-256 digest, wherever one is read. */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Names npm strips from a tarball. sync-template.mjs writes the left side. */
export const RESTORED_FILENAMES: Record<string, string> = {
  _gitignore: '.gitignore',
  _npmrc: '.npmrc',
  [PACKAGE_MANAGER_CONFIG.PACKED_PNPM_LOCKFILE]: PACKAGE_MANAGER_CONFIG.PNPM_LOCKFILE,
};

/** Kinds shown in the prompt, in order. `hidden` is deliberately absent. */
export const FEATURE_KIND_ORDER: PromptedKind[] = [
  'credential',
  'oauth',
  'passwordless',
  'second-factor',
];

export const FEATURE_KIND_LABELS: Record<PromptedKind, string> = {
  credential: 'Credentials',
  oauth: 'OAuth providers',
  passwordless: 'Passwordless',
  'second-factor': 'Second factor',
};

/** Extensions scanned by the post-prune reference check. */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/**
 * Extensions scanned for `feature:` markers. Code only: JSON has no comments
 * and markdown is pruned by its own doc rules.
 */
export const MARKER_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** Extensions whose comments start with `#` and may carry `# feature:` markers. */
export const HASH_MARKER_EXTENSIONS = ['.yml', '.yaml', '.sh'] as const;

/** Files without such an extension that take `# feature:` markers too. */
export const HASH_MARKER_FILENAMES = ['Dockerfile', '.dockerignore', '.gitignore'] as const;

/** The `@/` alias in the generated frontend, and what it points at. */
export const FRONTEND_ALIAS = '@/';

export const FRONTEND_SOURCE = 'frontend/src';

/**
 * `@app/<name>` and `@app/<name>/<subpath>` name the workspace at
 * shared/<name>. Names and subpath segments are npm-style: no dots, so `..`
 * and a file extension never match.
 */
export const SHARED_PACKAGE_SPECIFIER = /^@app\/([a-z0-9-]+)((?:\/[a-z0-9-]+)*)$/;

export const SHARED_PACKAGES_ROOT = 'shared';

/** Where the root export points when the package manifest is gone or names none. */
export const SHARED_PACKAGE_ENTRY = 'src/index';

export const PACKAGE_MANIFEST = 'package.json';

export const ROOT_EXPORT = '.';

/** Directories the pruner never walks into. */
export const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'out', 'coverage']);

export const DEFAULT_COMMIT_MESSAGE = 'chore: scaffold from create-authstack-starter';

export const GIT_FALLBACK_NAME = CLI_NAME;

export const GIT_FALLBACK_EMAIL = `${CLI_NAME}@users.noreply.github.com`;

export const GIT_PUSH_TIMEOUT_MS = 30_000;
export const GIT_PUSH_KILL_SIGNAL = 'SIGKILL';

/** Repository-local paths and config overrides must not escape the caller. */
export const GIT_REPOSITORY_ENV_VARS: readonly string[] = GIT_ENVIRONMENT.variables;
export const GIT_REPOSITORY_ENV_PREFIXES: readonly string[] = GIT_ENVIRONMENT.prefixes;

export const {
  PACKAGE_MANAGER,
  PACKAGE_MANAGER_VERSION,
  PNPM_WORKSPACE_FILE,
  PNPM_LOCKFILE,
  PACKED_PNPM_LOCKFILE,
} = PACKAGE_MANAGER_CONFIG;
export const PACKAGE_MANAGER_SPEC = `${PACKAGE_MANAGER}@${PACKAGE_MANAGER_VERSION}`;
export const LOCKFILE_UPDATE_COMMAND = 'pnpm install --lockfile-only';
export const FROZEN_INSTALL_COMMAND = 'pnpm install --frozen-lockfile';
export const INSTALL_COMMAND = 'pnpm install';
export const INSTALL_DIAGNOSTIC_LINES = 5;
export const MISSING_PNPM_MESSAGE = `pnpm@${PACKAGE_MANAGER_VERSION} is required to update the lockfile. Enable pnpm with Corepack and run ${INSTALL_COMMAND} to regenerate it.`;
