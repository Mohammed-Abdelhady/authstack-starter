'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const NODE_MODULES = 'node_modules';
const PROJECT_MANIFEST = 'package.json';
const WORKSPACE_PROTOCOL = 'workspace:';
/** A shell can import its own development tools. A dependency's tools are not its to import. */
const SHELL_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const DEPENDENCY_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'];
/** Packages that break when a bundle holds two copies. */
const SINGLETON_PACKAGES = ['react', 'react-native'];

/**
 * @typedef {(context: ResolutionContext, moduleName: string, platform: string | null) => unknown} ResolveRequest
 * @typedef {{ originModulePath: string, resolveRequest: ResolveRequest, [key: string]: unknown }} ResolutionContext
 * @typedef {{ nodeModulesPaths?: readonly string[], resolveRequest?: ResolveRequest | null, [key: string]: unknown }} ResolverConfig
 * @typedef {{ watchFolders?: readonly string[], resolver?: ResolverConfig, [key: string]: unknown }} MetroConfig
 * @typedef {{ workspaceRoot?: string, singletons?: readonly string[] }} WorkspaceOptions
 * @typedef {{ unstable_enableSymlinks: true, unstable_enablePackageExports: true, disableHierarchicalLookup: false }} PnpmResolverFlags
 * @typedef {ResolverConfig & PnpmResolverFlags & { nodeModulesPaths: string[], resolveRequest: ResolveRequest }} WorkspaceResolver
 * @typedef {MetroConfig & { watchFolders: string[], resolver: WorkspaceResolver }} WorkspaceMetroConfig
 */

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function findWorkspaceRoot(projectRoot) {
  let directory = path.resolve(projectRoot);
  for (;;) {
    if (fs.existsSync(path.join(directory, WORKSPACE_FILE))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`No ${WORKSPACE_FILE} was found above ${projectRoot}.`);
    }
    directory = parent;
  }
}

/**
 * @param {string} directory
 * @param {readonly string[]} sections
 * @returns {string[]} Names of the workspace packages this manifest depends on.
 */
function workspaceDependencyNames(directory, sections) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, PROJECT_MANIFEST), 'utf8'));
  return sections.flatMap((section) =>
    Object.entries(manifest[section] ?? {})
      .filter(([, range]) => String(range).startsWith(WORKSPACE_PROTOCOL))
      .map(([name]) => name),
  );
}

/**
 * Follows the links pnpm made for `workspace:` dependencies, so the answer is
 * what the installed tree lets this shell import and nothing wider.
 * @param {string} projectRoot
 * @returns {string[]} Folders of every workspace package the shell reaches, sorted.
 */
function workspaceDependencyFolders(projectRoot) {
  const found = new Set();
  const pending = [{ directory: path.resolve(projectRoot), sections: SHELL_SECTIONS }];
  for (let next = pending.pop(); next; next = pending.pop()) {
    for (const name of workspaceDependencyNames(next.directory, next.sections)) {
      const link = path.join(next.directory, NODE_MODULES, name);
      if (!fs.existsSync(link)) {
        throw new Error(`${name} is not linked into ${next.directory}. Run pnpm install first.`);
      }
      const folder = fs.realpathSync(link);
      if (found.has(folder)) continue;
      found.add(folder);
      pending.push({ directory: folder, sections: DEPENDENCY_SECTIONS });
    }
  }
  return [...found].sort();
}

/**
 * @param {string} parent
 * @param {string} candidate
 */
function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The shell's own folder comes first, so its pinned versions win over the root's.
 * @param {string} projectRoot
 * @param {string} workspaceRoot
 */
function workspaceSettings(projectRoot, workspaceRoot) {
  return {
    // The root's node_modules holds pnpm's store of every installed package.
    watchFolders: [
      path.join(workspaceRoot, NODE_MODULES),
      path.resolve(projectRoot),
      ...workspaceDependencyFolders(projectRoot),
    ],
    nodeModulesPaths: [
      path.join(projectRoot, NODE_MODULES),
      path.join(workspaceRoot, NODE_MODULES),
    ],
  };
}

/**
 * @param {string} moduleName
 * @param {readonly string[]} singletons
 */
function isSingleton(moduleName, singletons) {
  return singletons.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
}

/**
 * Resolves the singleton packages as if the shell itself had imported them.
 * @param {string} projectRoot
 * @param {readonly string[]} singletons
 * @param {ResolveRequest | null | undefined} upstream
 * @returns {ResolveRequest}
 */
function singletonResolver(projectRoot, singletons, upstream) {
  const origin = path.join(projectRoot, PROJECT_MANIFEST);
  return (context, moduleName, platform) => {
    const resolve = upstream ?? context.resolveRequest;
    if (!isSingleton(moduleName, singletons)) return resolve(context, moduleName, platform);
    return resolve({ ...context, originModulePath: origin }, moduleName, platform);
  };
}

/**
 * @param {readonly string[]} values
 */
function unique(values) {
  return [...new Set(values)];
}

/**
 * Adds what a shell inside this pnpm workspace needs to a Metro configuration.
 * @param {MetroConfig} config
 * @param {string} projectRoot
 * @param {WorkspaceOptions} [options]
 * @returns {WorkspaceMetroConfig}
 */
function withWorkspace(config, projectRoot, options = {}) {
  const workspaceRoot = options.workspaceRoot ?? findWorkspaceRoot(projectRoot);
  const settings = workspaceSettings(projectRoot, workspaceRoot);
  const resolver = config.resolver ?? {};
  // A base configuration may list every workspace. Only folders outside this
  // workspace are kept from it, the rest come from the shell's own manifest.
  const outside = (config.watchFolders ?? []).filter((folder) => !isInside(workspaceRoot, folder));
  return {
    ...config,
    watchFolders: unique([...outside, ...settings.watchFolders]),
    resolver: {
      ...resolver,
      nodeModulesPaths: unique([
        ...settings.nodeModulesPaths,
        ...(resolver.nodeModulesPaths ?? []),
      ]),
      // pnpm links every package into place, and each finds its own
      // dependencies by walking up from where the link points.
      unstable_enableSymlinks: true,
      unstable_enablePackageExports: true,
      disableHierarchicalLookup: false,
      resolveRequest: singletonResolver(
        projectRoot,
        options.singletons ?? SINGLETON_PACKAGES,
        resolver.resolveRequest,
      ),
    },
  };
}

module.exports = {
  SINGLETON_PACKAGES,
  findWorkspaceRoot,
  isSingleton,
  singletonResolver,
  withWorkspace,
  workspaceDependencyFolders,
  workspaceSettings,
};
