import type { RulesPolicy } from '../types.js';
import type { MobileIdentity, MobileIdentityRequest } from '../types/mobile.js';

export type PlanErrorReason =
  | 'unknown'
  | 'planned'
  | 'empty'
  | 'database-conflict'
  | 'option-conflict'
  | 'feature-conflict'
  | 'locales'
  | 'identity'
  | 'identity-unused';

export interface PlanError {
  id: string;
  reason: PlanErrorReason;
  /** For a conflict, the other id: what `id` needs but cannot have. */
  needed?: string;
  /** For an identity error, what is wrong with the value. `id` is the field. */
  message?: string;
}

/** An id the plan gained, and what caused it. */
export interface PlanChange {
  id: string;
  because: string;
}

export type RemovalReason = 'targets' | 'needs';

/** A feature the plan dropped, and why. `because` is a target list or a feature id. */
export interface PlanRemoval {
  id: string;
  reason: RemovalReason;
  because: string;
}

export interface Plan {
  rules: RulesPolicy;
  targets: string[];
  database: string;
  features: string[];
  options: string[];
  shared: string[];
  signInSite: 'full' | 'kept-for-native' | 'none';
  /** Set only when a mobile app is part of the plan. */
  mobile?: MobileIdentity;
  added: PlanChange[];
  removed: PlanRemoval[];
  errors: PlanError[];
}

/** What the flags, config file and prompts ask for, before presets and defaults. */
export interface PlanRequest {
  rules?: RulesPolicy;
  targets?: string[];
  databases?: string[];
  features?: string[];
  options?: Partial<Record<string, boolean>>;
  locales?: string[];
  preset?: string;
  mobile?: MobileIdentityRequest;
  /** The directory name the mobile defaults are built from. */
  projectName?: string;
}
