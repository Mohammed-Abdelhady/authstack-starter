import type { RoleAudience } from '../../host/types/host-role.type';
import type { SIGN_UP_POLICY } from '../constants/host-contracts';

export interface ApplicationPolicyConfiguration {
  signUp?: (typeof SIGN_UP_POLICY)[keyof typeof SIGN_UP_POLICY];
  requirePasskey?: boolean;
  audience?: RoleAudience;
}

export interface BrowserSignInConfiguration extends ApplicationPolicyConfiguration {
  password?: boolean;
  emailLink?: boolean;
  emailCode?: boolean; // feature:email-code
  passkeys?: boolean;
}

export interface SessionLifetimeConfiguration {
  absoluteHours: number;
  idleMinutes: number;
}

export interface BrowserSessionConfiguration extends SessionLifetimeConfiguration {
  cap: number;
}

export interface NativeSessionConfiguration {
  bound: SessionLifetimeConfiguration;
  unbound: SessionLifetimeConfiguration;
}
