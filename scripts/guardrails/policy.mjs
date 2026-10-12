export const LINE_ENDINGS = /\r\n|\r|\n/;
export const FILE_LINE_LIMIT = 350;
export const EXIT_CODES = { OK: 0, VIOLATION: 1, ERROR: 2 };
export const CI_EVENT_NAMES = { PULL_REQUEST: 'pull_request', PUSH: 'push' };
export const CI_SCAN_MODES = { RANGE: 'range', ALL: 'all', SKIP: 'skip' };
export const CI_TERMINATION_SIGNALS = ['SIGINT', 'SIGTERM'];
export const SCAN_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.sh',
  '.mts',
  '.cts',
];
export const SKIPPED_DIRECTORY_PARTS = ['node_modules', 'dist', '.next', '.expo'];
export const SKIPPED_PATH_PREFIXES = [
  'mobile/expo/ios/', // feature:native-expo
  'mobile/expo/android/', // feature:native-expo
  '.husky/_/',
];
export const PROTECTED_FILE_PATTERN =
  /(?:^|\/)(?:\.ssh\/.+|\.aws\/(?:credentials|config)|\.kube\/config|\.config\/gcloud\/.+)$/;
export const PROTECTED_EXTENSION = /\.(pem|key|crt)$/;
export const EXEMPT_PATHS = ['scripts/guardrails/policy.mjs', 'scripts/guardrails/scanner/check-hard-bans.test.mjs'];
export const GIT_REPOSITORY_VARIABLES = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_PREFIX',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE',
  'GIT_QUARANTINE_PATH',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_NO_REPLACE_OBJECTS',
];
export const GIT_CWD_RELATIVE_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE'];
export const GIT_BUFFER_LIMIT_MIB = 64;
export const GIT_MAX_BUFFER_BYTES = GIT_BUFFER_LIMIT_MIB * 1024 * 1024;
export const GIT_PATH_BATCH_BYTES = 32 * 1024;
export const BINARY_PROBE_BYTES = 8000;
export const MAX_EXCERPT_LENGTH = 240;
export const COMMIT_ABBREVIATION_LENGTH = 7;
export const EMPTY_PUSH_MESSAGE = 'no ref updates on stdin, nothing to scan';
export const PUSH_FETCH_FIRST_MESSAGE =
  'warning: the tracking ref for the pushed branch is out of date; fetch first, then push again.';
export const EMPTY_TRUSTED_REMOTES_LABEL = '<none>';
export const UNCAPPED_EXTENSIONS = ['.json', '.snap', '.css'];
export const UTF16_BOM_BYTES = 2;
export const UTF16_ENCODINGS = [
  { bom: [255, 254], encoding: 'utf-16le' },
  { bom: [254, 255], encoding: 'utf-16be' },
];
export const REMOTE_REF_PREFIX = 'refs/remotes/';
export const BRANCH_REF_PREFIX = 'refs/heads/';
export const GIT_OBJECT_ID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const GIT_PUSH_TIMEOUT_MS = 30_000;
export const PUSH_BASE_CONFIG = 'guardrails.pushBase';
export const TRUSTED_REMOTES_CONFIG = 'guardrails.trustedRemotes';
export const DEFAULT_TRUSTED_REMOTES = ['origin'];
export const GIT_URL_SUFFIX = '.git';
export const FILE_URL_SCHEME = 'file:';
export const PUSH_REMOTE_BASE_REFS = [
  'refs/remotes/origin/main',
  'refs/remotes/origin/master',
  'refs/remotes/origin/staging',
];
export const PUSH_BASE_REFS = [
  'refs/heads/main',
  'refs/heads/master',
  'refs/heads/staging',
  ...PUSH_REMOTE_BASE_REFS,
];
export const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
export const EXPLICIT_TYPE_RULE = '@typescript-eslint/no-explicit-' + 'a' + 'ny';
export const GITLINK_MODE = '160000';
export const SYMLINK_MODE = '120000';
export const SOURCE_SYMLINK_REASON = 'Source symlinks are refused; commit a regular source file.';
export const GIT_PATH_REPLACEMENT_CHARACTER = '\uFFFD';
export const CI_FETCH_REFS = { HEAD: 'refs/ci/pr-head', BASE: 'refs/ci/current-base' };
export const CI_AUTH_HEADER_NAME = 'extraheader';
export const WORKSPACE_MANIFEST_WARNING =
  'Guardrails warning: cannot read or parse package.json workspace metadata; using repository-root exclusions only.';
export const CI_TRACE2_VARIABLES = ['GIT_TRACE2', 'GIT_TRACE2_EVENT', 'GIT_TRACE2_PERF'];
export const CI_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
export const BINARY_EXTENSIONS = [
  '.png',
  '.bmp',
  '.tif',
  '.tiff',
  '.svg',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.woff',
  '.woff2',
  '.ttf',
  '.mp4',
  '.mp3',
];
// One folder family per line, so a project without a family can drop its line.
const CAPPED_FOLDERS = [
  'backend\\/(src|test|scripts|migrations)',
  'frontend\\/(src|e2e)',
  'packages\\/[^/]+\\/(src|test|scripts)',
  'shared\\/[^/]+\\/src',
  'mobile\\/[^/]+\\/(src|app|test|conformance)', // feature:native-core
  'scripts',
];
export const CAPPED_PATH = new RegExp(`^(${CAPPED_FOLDERS.join('|')})\\/`);
export const DOM_TOKENS = [
  'dangerouslySetInnerHTML',
  'insertAdjacentHTML',
  'document.write',
  'outerHTML',
  'innerHTML',
];
// Whitespace or block comments may sit between the two words of a type escape.
const WORD_GAP = String.raw`(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/)+`;
export const RULE_REASONS = {
  DOM: 'Markup injection bypasses safe text and children.',
  TYPE: 'Type escapes bypass compile-time checking.',
  SUPPRESSION: 'Suppression hides a failing gate instead of fixing its cause.',
  BYPASS: 'Gate bypass flags disable required verification.',
};
export const BANNED_CONSTRUCTS = [
  { token: 'dangerouslySetInnerHTML', reason: RULE_REASONS.DOM },
  { token: 'insertAdjacentHTML', reason: RULE_REASONS.DOM },
  { token: 'eslint-disable-next-line', reason: RULE_REASONS.SUPPRESSION },
  { token: 'eslint-disable-line', reason: RULE_REASONS.SUPPRESSION },
  { token: '@SuppressWarnings', reason: RULE_REASONS.SUPPRESSION },
  {
    token: 'as unknown as',
    pattern:
      /\bas\s+unknown\b|(?<![\w$])(\([^()\r\n]*\bas\s+unknown\b)|(<[^<>\r\n]+>\s*\(\s*<\s*unknown\s*>)/g,
    followingCast: true,
    reason: RULE_REASONS.TYPE,
  },
  {
    token: 'satisfies any',
    pattern: new RegExp(String.raw`\bsatisfies${WORD_GAP}any\b`, 'g'),
    reason: RULE_REASONS.TYPE,
  },
  { token: 'prettier-ignore', reason: RULE_REASONS.SUPPRESSION },
  { token: 'deno-lint-ignore', reason: RULE_REASONS.SUPPRESSION },
  { token: 'oxlint-disable', reason: RULE_REASONS.SUPPRESSION },
  { token: 'stylelint-disable', reason: RULE_REASONS.SUPPRESSION },
  { token: 'biome-ignore', reason: RULE_REASONS.SUPPRESSION },
  { token: 'eslint-disable', reason: RULE_REASONS.SUPPRESSION },
  { token: 'eslint-enable', reason: RULE_REASONS.SUPPRESSION },
  { token: 'document.write', reason: RULE_REASONS.DOM },
  { token: '--no-typecheck', reason: RULE_REASONS.BYPASS },
  { token: '--no-eslint', reason: RULE_REASONS.BYPASS },
  { token: '--no-verify', reason: RULE_REASONS.BYPASS },
  { token: '@ts-expect-error', reason: RULE_REASONS.SUPPRESSION },
  { token: '@ts-nocheck', reason: RULE_REASONS.SUPPRESSION },
  { token: '@ts-ignore', reason: RULE_REASONS.SUPPRESSION },
  { token: 'type: ignore', reason: RULE_REASONS.SUPPRESSION },
  { token: 'pylint: disable', reason: RULE_REASONS.SUPPRESSION },
  { token: 'ruff: noqa', reason: RULE_REASONS.SUPPRESSION },
  { token: '# noqa', reason: RULE_REASONS.SUPPRESSION },
  {
    token: 'as any',
    pattern: new RegExp(String.raw`\bas${WORD_GAP}any\b`, 'g'),
    reason: RULE_REASONS.TYPE,
  },
  { token: 'outerHTML', reason: RULE_REASONS.DOM },
  { token: 'innerHTML', reason: RULE_REASONS.DOM },
];
BANNED_CONSTRUCTS.push(
  { token: 'document.writeln', reason: RULE_REASONS.DOM },
  { token: 'document?.write', reason: RULE_REASONS.DOM },
  { token: "document['write']", reason: RULE_REASONS.DOM },
  { token: 'document["write"]', reason: RULE_REASONS.DOM },
  {
    token: 'inline eslint configuration',
    display: 'description',
    pattern: /\/\*\s*eslint\s+['"]?(?:@[\w-]+\/)?[\w][\w/-]*['"]?\s*:/g,
    reason: RULE_REASONS.SUPPRESSION,
  },
);
const BYPASS_TOKENS = BANNED_CONSTRUCTS.filter(({ reason }) => reason === RULE_REASONS.BYPASS).map(
  ({ token }) => token,
);
// These files are read for the listed tokens only, not for the whole ban list.
export const LIMITED_SCAN_TARGETS = [
  { path: /\.ya?ml$/i, tokens: BYPASS_TOKENS },
  { path: /(?:^|\/)Dockerfile[^/]*$/, tokens: BYPASS_TOKENS },
  { path: /\.css$/i, tokens: ['stylelint-disable'] },
];
const TOOL_NAME = String.raw`(?:cursor(?:\s*agent)?|claude(?:\s+(?:code|opus|sonnet|haiku))?|chatgpt|gpt-[\w.]+|anthropic|openai|(?:github\s+)?copilot)(?:\s+v?\d[\w.-]*)?(?:\s*\([^()]*\))?`;
const TOOL_ADDRESS = String.raw`(?:cursoragent@cursor\.com|noreply@anthropic\.com|noreply@openai\.com|(?:\d+\+)?copilot@users\.noreply\.github\.com)`;
// A trailer split over two lines cannot be removed line by line, so the hook refuses it.
export const FOLDED_ATTRIBUTION = {
  reason: 'tool trailer folded across lines',
  pattern: new RegExp(
    String.raw`^[ \t]*(?:co-authored-by|made-with)[ \t]*:[ \t]*\r?\n[ \t]*(?:${TOOL_NAME}[ \t]*(?:<[^<>\n]*>)?|[^<>\n]*<[ \t]*${TOOL_ADDRESS}[ \t]*>)[ \t]*\r?$`,
    'im',
  ),
};
// Each pattern matches a whole line, so prose that names a tool is never a hit.
export const ATTRIBUTION_RULES = [
  {
    reason: 'tool co-author trailer',
    pattern: new RegExp(
      String.raw`^\s*co-authored-by\s*:\s*(?:${TOOL_NAME}\s*(?:<[^<>]*>)?|[^<>]*<\s*${TOOL_ADDRESS}\s*>)\s*$`,
      'i',
    ),
  },
  {
    reason: 'tool made-with trailer',
    pattern: new RegExp(String.raw`^\s*made-with\s*:\s*${TOOL_NAME}\s*$`, 'i'),
  },
  {
    reason: 'tool generator footer',
    pattern: new RegExp(
      String.raw`^\s*(?:\p{Extended_Pictographic}️?\s*)*generated\s+with\s+(?:\[${TOOL_NAME}\]\([^()\s]*\)|${TOOL_NAME})(?:\s+https?:\/\/\S+)?\s*\.?\s*$`,
      'iu',
    ),
  },
];
