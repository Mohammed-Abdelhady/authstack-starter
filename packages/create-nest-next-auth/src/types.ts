import type { ANSWERS_SCHEMA_VERSION, RULES_POLICIES } from './constants/index.js';
import type { MobileIdentityRequest } from './types/mobile.js';

/** `hidden` features are never offered; another feature pulls them in. */
export type FeatureKind = 'credential' | 'oauth' | 'second-factor' | 'passwordless' | 'hidden';

export type FeatureStatus = 'available' | 'planned';

export interface Feature {
  label: string;
  description: string;
  kind: FeatureKind;
  default: boolean;
  files: string[];
  envVars: string[];
  /** Native dependencies needed only when this feature is selected. */
  packages?: string[];
  requires: string[];
  docs: string[];
  /** Omitted means available. Planned features are never offered by the prompt. */
  status?: FeatureStatus;
  /** When present, the feature only applies to projects with one of these targets. */
  targets?: string[];
}

/** What a target pulls in: shared modules and, for convenience, other targets. */
export interface TargetRequires {
  shared: string[];
  targets: string[];
}

export interface Target {
  label: string;
  /** The hint next to the label: what has and has not been verified. */
  description?: string;
  default: boolean;
  files: string[];
  workspaces: string[];
  envFiles: string[];
  requires: TargetRequires;
  /** A mobile shell still needs the browser sign-in pages to authenticate. */
  needsSignInSite?: boolean;
  status?: FeatureStatus;
}

export interface SharedModule {
  /** Named in the summary when a client pulls the module in. */
  label?: string;
  files: string[];
  workspaces: string[];
}

/** A literal replacement made in the files of the chosen database. */
export interface DatabaseRewrite {
  files: string[];
  from: string;
  to: string;
}

/** Lines the chosen database adds to one environment example file. */
export interface DatabaseEnvExample {
  path: string;
  lines: string[];
}

export interface Database {
  label: string;
  default: boolean;
  /** Removed with the docs when another database is chosen. */
  files: string[];
  docs: string[];
  envVars: string[];
  /** Dependencies only this database needs, dropped from every package manifest. */
  packages: string[];
  /** Backend commands that only work with this database. */
  scripts: string[];
  /** Keys of JSON files, by path and then by key path, that only this database needs. */
  jsonKeys: Record<string, string[][]>;
  /** pnpm build approvals that exist for this database's tooling. */
  buildApprovals: string[];
  /** When chosen: files that take the plain name the other database left free. */
  renames: Record<string, string>;
  /** When chosen: backend commands that take the plain name the other database left free. */
  scriptRenames: Record<string, string>;
  /** When chosen: text that named the database apart and no longer has to. */
  rewrites: DatabaseRewrite[];
  /** When chosen: settings written into the environment examples. */
  envExamples: DatabaseEnvExample[];
  status?: FeatureStatus;
}

/** Catalogue keys an option owns, removed from that catalogue when it is off. */
export interface CatalogueKeyRule {
  path: string;
  keys: string[];
}

export interface ProjectOption {
  label: string;
  default: boolean;
  files: string[];
  requires: string[];
  docs: string[];
  catalogueKeys: CatalogueKeyRule[];
  status?: FeatureStatus;
}

/** A preset either lists ids or names the available/default ones to resolve later. */
export type PresetValue = string[] | 'available' | 'defaults';

export interface Preset {
  targets: PresetValue;
  features: PresetValue;
  options: PresetValue;
}

export interface Manifest {
  /** 2 for the dimension-aware manifest; a 1 (or unversioned) file loads as web + mongodb. */
  version: number;
  features: Record<string, Feature>;
  targets: Record<string, Target>;
  shared: Record<string, SharedModule>;
  databases: Record<string, Database>;
  options: Record<string, ProjectOption>;
  presets: Record<string, Preset>;
  core: {
    alwaysRemoveFiles: string[];
  };
}

export type RulesPolicy = (typeof RULES_POLICIES)[number];

export interface CliOptions {
  /** Target path as typed by the user, or undefined when it has to be prompted. */
  directory?: string;
  yes: boolean;
  rules?: RulesPolicy;
  features?: string[];
  targets?: string[];
  databases?: string[];
  preset?: string;
  config?: string;
  dryRun: boolean;
  locales?: string[];
  /** Mobile app identity fields given by flag. */
  mobile?: MobileIdentityRequest;
  /** Explicit option ids mapped to on/off, from `--no-docker` and friends. */
  optionOverrides: Partial<Record<string, boolean>>;
  install: boolean;
  git: boolean;
}

export interface DanglingReference {
  file: string;
  line: number;
  specifier: string;
  target: string;
  /** Set when the reference is a package.json script, not an import. */
  script?: string;
}

/** Who generated the project: the installer's own package identity. */
export interface InstallerIdentity {
  name: string;
  version: string;
}

/** The template content the project was generated from, hashed at build time. */
export interface TemplateIdentity {
  sha256: string;
}

/** The resolved plan as recorded in the generated answers file. Sorted arrays. */
export interface ResolvedAnswers {
  targets: string[];
  database: string;
  features: string[];
  options: string[];
  locales: string[];
}

/**
 * The generated `.create-nest-next-auth.json`. Its keys are a contract: a
 * later tool reads this file, so nothing beyond them is ever written. No
 * timestamps, paths, environment values or user names.
 */
export interface AnswersRecord {
  schemaVersion: typeof ANSWERS_SCHEMA_VERSION;
  packageManager: string;
  rules: { policy: RulesPolicy };
  installer: InstallerIdentity;
  template: TemplateIdentity;
  answers: ResolvedAnswers;
}

export interface PruneResult {
  selected: string[];
  removed: string[];
  removedOptions: string[];
  deletedFiles: string[];
  strippedEnvVars: string[];
  removedDocLines: number;
  /** Files a `feature:` marker was stripped from, or deleted lines out of. */
  markedFiles: string[];
  removedMarkedLines: number;
  /** Changed files the pruner reformatted with the project's prettier config. */
  formattedFiles: string[];
  dangling: DanglingReference[];
  /**
   * Rules of a database that found nothing to change. Expected when an option
   * or a client that was left out took the text or the file with it, and empty
   * for a project with everything on.
   */
  unmatchedDatabaseRules: string[];
  /**
   * The same rules when nothing was left out that could explain them: the
   * manifest and the template no longer agree, and the scaffold stops.
   */
  unexplainedDatabaseRules: string[];
}
