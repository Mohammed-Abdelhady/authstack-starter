import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProtectedPath, isTextContent } from './guardrails/scanner/checker.mjs';
import { gitEnvironment } from './guardrails/git/git-environment.mjs';
import {
  PROTECTED_FILE_PATTERN,
  PROTECTED_EXTENSION,
  SKIPPED_DIRECTORY_PARTS,
} from './guardrails/policy.mjs';
import { decodeContent, isUtf16 } from './guardrails/scanner/text-content.mjs';

const LEGACY_MANAGER = 'n' + 'pm';
const LEGACY_LOCKFILE = 'package' + '-lock';
const LEGACY_EXEC = 'np' + 'x';
const LEGACY_YARN = 'y' + 'arn';
const LEGACY_BUN = 'b' + 'un';
const LEGACY_BUN_EXEC = LEGACY_BUN + 'x';
const LEGACY_MANAGER_VERBS = [
  'run',
  'ci',
  'install',
  'test',
  'start',
  'i',
  'exec',
  'audit',
  'update',
  'add',
  'remove',
  'uninstall',
  'rebuild',
  'link',
  'dedupe',
  'prune',
].join('|');
const FORBIDDEN_REFERENCE = new RegExp(
  `\\b(?:${LEGACY_MANAGER} (?:${LEGACY_MANAGER_VERBS})\\b|${LEGACY_EXEC}\\b|${LEGACY_YARN} (?:add|install|run|dev)\\b|${LEGACY_BUN_EXEC}\\b|${LEGACY_BUN} (?:install|run)\\b|${LEGACY_LOCKFILE})`,
  'g',
);
const PUBLICATION_PATHS = new Set(['packages/create-nest-next-auth/test/packed/packed-cli.ts']);
const SKIPPED_DIRECTORIES = new Set([
  ...SKIPPED_DIRECTORY_PARTS,
  '.git',
  'template',
  'coverage',
  'out',
  '.ssh',
  '.aws',
  '.kube',
]);

function protectedPath(file) {
  const parts = file.split('/');
  return (
    parts.some(
      (part, index) =>
        (part === '.env' || part.startsWith('.env.')) &&
        (index < parts.length - 1 || !part.endsWith('.example')),
    ) ||
    PROTECTED_FILE_PATTERN.test(file) ||
    PROTECTED_EXTENSION.test(file) ||
    isProtectedPath(file)
  );
}

function exempt(file) {
  return PUBLICATION_PATHS.has(file) || /(?:^|\/)changelog(?:[.-][^/]*)?\.md$/i.test(file);
}

export function legacyReferences(file, text) {
  if (exempt(file)) return [];
  if (file.includes(LEGACY_LOCKFILE)) return [{ file, line: 1, reference: LEGACY_LOCKFILE }];
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (file.endsWith('.gitignore') && line.trim() === `${LEGACY_LOCKFILE}.json`) return [];
    return [...line.matchAll(FORBIDDEN_REFERENCE)].map((match) => ({
      file,
      line: index + 1,
      reference: match[0],
    }));
  });
}

function packageScripts(root, files) {
  return new Set(
    files
      .filter((file) => file === 'package.json' || file.endsWith('/package.json'))
      .flatMap((file) => {
        const path = join(root, file);
        if (!existsSync(path) || !lstatSync(path).isFile()) return [];
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        const declaredScripts = manifest?.scripts;
        if (
          !declaredScripts ||
          typeof declaredScripts !== 'object' ||
          Array.isArray(declaredScripts)
        )
          return [];
        return Object.keys(declaredScripts);
      }),
  );
}

function missingDocumentedScripts(file, text, scripts) {
  if (!file.endsWith('.md') || exempt(file)) return [];
  return text.split(/\r?\n/).flatMap((line, index) =>
    [...line.matchAll(/\bpnpm (?:--filter \S+ )?run ([A-Za-z0-9][A-Za-z0-9:_.-]*)\b/g)]
      .filter((match) => !scripts.has(match[1]))
      .map((match) => ({
        file,
        line: index + 1,
        reference: match[1],
        kind: 'missing-script',
      })),
  );
}

function filesWithoutGit(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (protectedPath(file) || file === '.config/gcloud') return [];
    if (entry.isDirectory()) return filesWithoutGit(root, file);
    return entry.isFile() ? [file] : [];
  });
}

export function checkPackageManager(root) {
  const files = existsSync(join(root, '.git'))
    ? execFileSync('git', ['ls-files', '-z'], {
        cwd: root,
        env: gitEnvironment(),
        encoding: 'utf8',
      })
        .split('\0')
        .filter(Boolean)
    : filesWithoutGit(root);
  const scripts = packageScripts(root, files);
  return files.sort().flatMap((file) => {
    if (protectedPath(file) || exempt(file)) return [];
    const path = join(root, file);
    if (!existsSync(path) || !lstatSync(path).isFile()) return [];
    const content = readFileSync(path);
    if (!isUtf16(content) && !isTextContent(file, content)) return [];
    const text = decodeContent(content);
    return [
      ...legacyReferences(file, text),
      ...missingDocumentedScripts(file, text, scripts),
    ];
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = checkPackageManager(process.cwd());
  for (const finding of findings) {
    const message =
      finding.kind === 'missing-script'
        ? `pnpm run ${finding.reference} is not defined in any package.json`
        : `legacy package-manager reference ${finding.reference}`;
    console.error(`${finding.file}:${finding.line}: ${message}`);
  }
  const missingScriptCount = findings.filter((finding) => finding.kind === 'missing-script').length;
  const legacyCount = findings.length - missingScriptCount;
  console.log(
    `Package-manager inventory: ${legacyCount} legacy references, ${missingScriptCount} missing pnpm scripts`,
  );
  process.exitCode = findings.length ? 1 : 0;
}
