import type { ProviderSignInPort } from '@app/native-auth';
import type { AccountDeletionProps } from './account-deletion';
import type { EmailConfirmationProps } from './email-confirmation';
import type { ComponentType } from 'react';
import type { NativeProviderButtonProps } from './native-sign-in';
import type { AuthEngine, AuthSnapshot, RestoreOutcome, SignInOutcome } from '@app/native-auth';
import type {
  Activity,
  ApiFailureKind,
  ListView,
  SessionKind,
  SignInAction,
  SignInFailure,
  SignInState,
} from '../constants';
import type { Locale, MessageKey } from '../i18n';

/** Space the system keeps for itself on each edge, from the shell's safe-area source. */
export interface EdgeInsets {
  top: number;
  bottom: number;
  start: number;
  end: number;
}

/** The same space as a safe-area library reports it, by physical side. */
export interface PhysicalInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

/** Asks the person to confirm with the platform's own dialog. Resolves `true` on confirm. */
export type Confirm = (request: ConfirmRequest) => Promise<boolean>;

export interface NativeAppProps {
  emailConfirmation?: EmailConfirmationProps;
  accountDeletion?: AccountDeletionProps;
  providerSignIn?: ProviderSignInPort;
  engine: AuthEngine;
  providerButton?: ComponentType<NativeProviderButtonProps>;
  /** The product name shown on the sign-in screen. */
  appName: string;
  locale: Locale;
  insets: EdgeInsets;
  /** Wall time in milliseconds, for "active today" lines. Defaults to the system clock. */
  now?: () => number;
  /** Defaults to the platform alert. A shell or test can pass its own. */
  confirm?: Confirm;
}

/** The subset of the engine the screens call. */
export type EnginePort = Pick<
  AuthEngine,
  | 'snapshot'
  | 'subscribe'
  | 'signIn'
  | 'signOut'
  | 'restore'
  | 'transport'
  | 'methods'
  | 'nativeSignIn'
  | 'cancelNativeSignIn'
> & {
  readonly passkeys?: Pick<AuthEngine['passkeys'], 'prove'>; // feature:passkeys
};

export interface SignInAttempt {
  pending: boolean;
  outcome?: SignInOutcome;
  failure?: SignInFailure;
  action?: SignInAction;
  blocked?: Extract<RestoreOutcome, { kind: 'storageBlocked' }>['reason'];
}

export interface SignInView {
  state: SignInState;
  action: SignInAction;
  /** False while a second tap must do nothing. */
  canAct: boolean;
  failure?: SignInFailure;
  /** True when a session ended on its own and the person has not tried again yet. */
  sessionEnded: boolean;
  /** True when the service switched sign-in from apps off and ended the session. */
  switchedOff: boolean;
}

export type SnapshotInput = Pick<AuthSnapshot, 'status' | 'operation' | 'reason'>;

/** A plain value the store can hold: an error class would not survive it. */
export interface ApiFailure {
  kind: ApiFailureKind;
  code?: string;
  status?: number;
}

export type DeviceName =
  | { kind: 'named'; name: string }
  | { kind: 'browser'; browser: string; system: string }
  | { kind: 'mobileApp'; system: string }
  | { kind: 'unknown' };

export interface SessionRow {
  id: string;
  isCurrent: boolean;
  device: DeviceName;
  kind: SessionKind | undefined;
  ip: string;
  activity: Activity;
  /** When the session was last used, in wall-clock milliseconds. */
  lastActiveAt: number;
}

export interface SessionsView {
  view: ListView;
  current: SessionRow | undefined;
  others: SessionRow[];
  failure?: ApiFailure;
}

export interface NoticeText {
  title: MessageKey;
  description: MessageKey;
}
