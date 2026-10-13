import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import {
  FRONTEND_ALIAS,
  FRONTEND_SOURCE,
  PACKAGE_MANIFEST,
  ROOT_EXPORT,
  SHARED_PACKAGE_ENTRY,
  SHARED_PACKAGE_SPECIFIER,
  SHARED_PACKAGES_ROOT,
  SOURCE_EXTENSIONS,
} from '../constants/index.js';
import { isRecord } from '../manifest/read.js';
import type { DanglingReference } from '../types.js';
import { docReferences } from './docs.js';
import { isErrnoException, listFiles } from '../utils/fs.js';
import { parseJson } from '../utils/parse-json.js';

// from '...' | import('...') | require('...')
const SPECIFIER = new RegExp(
  ['(?:from|import|require)', '\\s*\\(?\\s*', '[\'"]', '([^\'"]+)', '[\'"]'].join(''),
  'g',
);

function isSourceFile(path: string): boolean {
  return (SOURCE_EXTENSIONS as readonly string[]).includes(extname(path));
}

/** Strips .ts and friends. Leaves other dots alone, as in google-oauth.strategy. */
function withoutExtension(path: string): string {
  const extension = extname(path);
  const isSource = (SOURCE_EXTENSIONS as readonly string[]).includes(extension);
  return isSource ? path.slice(0, -extension.length) : path;
}

/** First path segment of a file, which is the workspace it belongs to. */
function workspaceOf(importer: string): string {
  return importer.split('/')[0];
}

/** Export key (`.`, `./errors`) to the project path it points at, for one shared package. */
type SharedExports = Map<string, string>;
type SharedPackages = (name: string) => Promise<SharedExports | undefined>;

/**
 * Reads what each shared/<name> exports, once per name. A name with no
 * manifest on disk is not a shared package, unless the pruner just deleted
 * that manifest: then only the root export is known, by convention.
 */
function sharedPackages(root: string, deletedFiles: string[]): SharedPackages {
  const loaded = new Map<string, Promise<SharedExports | undefined>>();

  async function load(name: string): Promise<SharedExports | undefined> {
    const directory = posix.join(SHARED_PACKAGES_ROOT, name);
    const manifest = posix.join(directory, PACKAGE_MANIFEST);
    const exported: SharedExports = new Map([
      [ROOT_EXPORT, posix.join(directory, SHARED_PACKAGE_ENTRY)],
    ]);
    let declared: unknown;
    try {
      const parsed: unknown = JSON.parse(await readFile(join(root, manifest), 'utf8'));
      declared =
        typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'exports') : {};
    } catch {
      return deletedFiles.includes(manifest) ? exported : undefined;
    }
    if (typeof declared !== 'object' || declared === null) return exported;
    for (const [key, target] of Object.entries(declared)) {
      if (typeof target === 'string' && isSourceFile(target)) {
        exported.set(key, withoutExtension(posix.join(directory, target)));
      }
    }
    return exported;
  }

  return (name) => {
    const known = loaded.get(name) ?? load(name);
    loaded.set(name, known);
    return known;
  };
}

/**
 * Turns an import into a project path. Relative specifiers resolve against the
 * importer; `@/x` is the frontend alias for frontend/src/x, `@app/<name>` and
 * `@app/<name>/<subpath>` point at what shared/<name> exports under that key,
 * and `src/x` is the baseUrl form inside a workspace. Anything else, a subpath
 * the package does not export included, is a package name.
 */
async function resolveSpecifier(
  importer: string,
  specifier: string,
  shared: SharedPackages,
): Promise<string | undefined> {
  if (specifier.startsWith('.')) {
    return withoutExtension(posix.normalize(posix.join(posix.dirname(importer), specifier)));
  }
  const sharedPackage = SHARED_PACKAGE_SPECIFIER.exec(specifier);
  if (sharedPackage !== null) {
    const [, name, subpath] = sharedPackage;
    return (await shared(name))?.get(`${ROOT_EXPORT}${subpath}`);
  }
  if (specifier.startsWith(FRONTEND_ALIAS)) {
    return withoutExtension(posix.join(FRONTEND_SOURCE, specifier.slice(FRONTEND_ALIAS.length)));
  }
  if (specifier.startsWith('src/')) {
    return withoutExtension(posix.join(workspaceOf(importer), specifier));
  }
  return undefined;
}

/**
 * Reports imports and scripts into deleted files, and missing relative Markdown
 * targets. Shared references to feature-owned files need the same feature marker.
 */
export async function findDanglingReferences(
  root: string,
  deletedFiles: string[],
): Promise<DanglingReference[]> {
  const deletedSources = deletedFiles.filter(isSourceFile).map(withoutExtension);
  const byPath = new Map(deletedSources.map((path) => [path, path]));
  for (const path of deletedSources) {
    // An index file is imported through its directory.
    if (path.endsWith('/index')) byPath.set(path.slice(0, -'/index'.length), path);
  }
  const dangling: DanglingReference[] = [];
  const shared = sharedPackages(root, deletedFiles);
  const files = await listFiles(root);
  const projectRoot = resolve(root);

  for (const file of files.filter(isSourceFile)) {
    const lines = (await readFile(join(root, file), 'utf8')).split('\n');

    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(SPECIFIER)) {
        const specifier = match[1];
        const resolved = await resolveSpecifier(file, specifier, shared);
        const target = resolved === undefined ? undefined : byPath.get(resolved);
        if (target === undefined) continue;
        dangling.push({ file, line: index + 1, specifier, target });
      }
    }
  }

  for (const file of files.filter((path) => path.endsWith('.md'))) {
    const references = docReferences(file, await readFile(join(root, file), 'utf8'));
    for (const reference of references) {
      const target = resolve(projectRoot, reference.target);
      const fromRoot = relative(projectRoot, target);
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        dangling.push(reference);
        continue;
      }
      try {
        await stat(target);
      } catch (error) {
        if (!isErrnoException(error) || error.code !== 'ENOENT') throw error;
        dangling.push(reference);
      }
    }
  }

  for (const file of files.filter((path) => path.endsWith('package.json'))) {
    const parsed = parseJson(await readFile(join(root, file), 'utf8'), file);
    if (!isRecord(parsed) || !isRecord(parsed.scripts)) continue;
    for (const [name, command] of Object.entries(parsed.scripts)) {
      if (typeof command !== 'string') continue;
      const target = deletedFiles.find((path) => command.includes(path));
      if (target === undefined) continue;
      dangling.push({ file, line: 1, specifier: name, target, script: name });
    }
  }

  return dangling;
}
