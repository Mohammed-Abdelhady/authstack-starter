import type { Request } from 'express';

export interface FeatureApplicationSignIn {
  readonly password?: boolean;
  readonly emailLink?: boolean;
  readonly emailCode?: boolean;
  readonly passkeys?: boolean;
  readonly oauth?: boolean; // feature:oauth-core
}

export interface FeatureApplicationConfiguration {
  readonly clientId: string;
  readonly signIn: FeatureApplicationSignIn | undefined;
}

export interface FeatureApplication extends FeatureApplicationConfiguration {
  readonly enabled: boolean;
}

/**
 * The browser application a feature switch answers for. Declared here so the
 * switches compile without the session module, as a generated project checks.
 */
export abstract class FeatureApplications {
  abstract isBrowserRequest(request: Request): boolean;
  abstract resolve(request?: Request): Promise<FeatureApplication>;
  abstract assertEnabled(application: FeatureApplication): void;
  abstract current(request?: Request): FeatureApplicationConfiguration;
  abstract configuration(clientId: string): FeatureApplicationConfiguration;
}
