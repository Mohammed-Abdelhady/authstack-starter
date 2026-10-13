import type { RulesPolicy } from '../types.js';
import type { SETUP_CHECK, SETUP_STATUS } from '../constants/setup.js';

export type SetupCheck = (typeof SETUP_CHECK)[keyof typeof SETUP_CHECK];

export interface SetupOutcome {
  status: (typeof SETUP_STATUS)[keyof typeof SETUP_STATUS];
  reason?: string;
}

export interface SetupFacts {
  files: { count: number; instructions: string[]; paths?: string[] };
  rules: RulesPolicy;
  lockfile: SetupOutcome;
  git: SetupOutcome;
  install: SetupOutcome;
  ownRepository: boolean;
  hooksIncluded: boolean;
  hooksActive: boolean;
  checksRun: SetupCheck[];
  skipped: { check: SetupCheck; reason: string }[];
  nextSteps: string[];
  docs: string[];
}

export interface SetupSummary extends Omit<
  SetupFacts,
  'ownRepository' | 'hooksIncluded' | 'hooksActive'
> {
  exitCode: number;
  notAdded?: { check: string; reason: string }[];
  hooks: { included: boolean; active: boolean; activationCommand?: string };
}
