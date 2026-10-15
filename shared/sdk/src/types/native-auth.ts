import type {
  NativeFirstFactor,
  NativeFlow,
  NativeProviderCredentialKind,
  NativeProviderSdkMode,
  NativeSecondFactor,
  NativeStage,
} from '@app/core';
import { NATIVE_PROVIDER_CREDENTIAL_KIND, NATIVE_PROVIDER_SDK_MODE } from '@app/core';
import type { AuthMethods } from '../types';
import type { CallOptions } from '../client';
import type { TransportSignal } from '../transport';

export type {
  NativeFirstFactor,
  NativeFlow,
  NativeProviderCredentialKind,
  NativeProviderSdkMode,
  NativeSecondFactor,
  NativeStage,
};

export interface NativeAttempt {
  id: string;
  secret: string;
}

export interface NativeAttemptStart {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  state: string;
  scopes: string[];
  flow: NativeFlow;
}

export interface NativeAuthCapabilities {
  password: boolean;
  emailLink: boolean;
  passkeys: boolean;
  registration: boolean;
  recovery: boolean;
  /** Absent from a server that does not carry email-code sign-in. */
  emailCode?: boolean; // feature:email-code
}

export interface NativeGoogleSdkConfiguration {
  kind: 'google';
  webClientId: string;
  iosClientId?: string;
}

export interface NativeAppleSdkConfiguration {
  kind: 'apple';
  appId: string;
}

export interface NativeFacebookSdkConfiguration {
  kind: 'facebook';
  appId: string;
}

export type NativeProviderSdkConfiguration =
  NativeGoogleSdkConfiguration | NativeAppleSdkConfiguration | NativeFacebookSdkConfiguration;

interface NativeProviderMethodBase {
  id: string;
  displayName: string;
}

export type NativeProviderMethod =
  | (NativeProviderMethodBase & { mode: typeof NATIVE_PROVIDER_SDK_MODE.SYSTEM; sdk?: never })
  | (NativeProviderMethodBase & {
      mode: typeof NATIVE_PROVIDER_SDK_MODE.GOOGLE_IDENTITY_TOKEN;
      sdk: NativeGoogleSdkConfiguration;
    })
  | (NativeProviderMethodBase & {
      mode: typeof NATIVE_PROVIDER_SDK_MODE.APPLE_IDENTITY_TOKEN_AND_CODE;
      sdk: NativeAppleSdkConfiguration;
    })
  | (NativeProviderMethodBase & {
      mode: typeof NATIVE_PROVIDER_SDK_MODE.FACEBOOK;
      sdk: NativeFacebookSdkConfiguration;
    });

export interface NativeMethods {
  nativeEnabled: boolean;
  methods: AuthMethods;
  capabilities: NativeAuthCapabilities;
  providers: NativeProviderMethod[];
}

export type NativeProviderCredential =
  | {
      kind: typeof NATIVE_PROVIDER_CREDENTIAL_KIND.GOOGLE_IDENTITY_TOKEN;
      identityToken: string;
      nonceDigest: string;
    }
  | {
      kind: typeof NATIVE_PROVIDER_CREDENTIAL_KIND.APPLE_IDENTITY_TOKEN_AND_CODE;
      identityToken: string;
      authorizationCode: string;
      nonceDigest: string;
    }
  | {
      kind: typeof NATIVE_PROVIDER_CREDENTIAL_KIND.FACEBOOK_LIMITED_TOKEN;
      authenticationToken: string;
      nonceDigest: string;
    }
  | {
      kind: typeof NATIVE_PROVIDER_CREDENTIAL_KIND.FACEBOOK_ACCESS_TOKEN;
      accessToken: string;
    };

export interface NativePasswordInput {
  email: string;
  password: string;
}

export interface NativePasskeyAssertion {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
  authenticatorAttachment?: 'platform' | 'cross-platform';
  clientExtensionResults?: Readonly<Record<string, unknown>>;
  type: 'public-key';
}

export type NativeSecondFactorInput =
  | { code: string; recoveryCode?: never; passkeyResponse?: never }
  | { recoveryCode: string; code?: never; passkeyResponse?: never }
  | { passkeyResponse: NativePasskeyAssertion; code?: never; recoveryCode?: never };

export interface NativePasskeyCredentialDescriptor {
  type: 'public-key';
  id: string;
  transports?: string[];
}

export interface NativePasskeyOptions {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: NativePasskeyCredentialDescriptor[];
  userVerification?: 'required' | 'preferred' | 'discouraged';
}

export interface NativeEmailLinkVerificationInput {
  token: string;
  state: string;
}

export interface NativeActivationInput {
  email: string;
  code: string;
  password: string;
  name: string;
}

export interface NativeRecoveryConfirmationInput {
  email: string;
  code: string;
  newPassword: string;
}

export interface NativeAuthClient<TSignal extends TransportSignal = TransportSignal> {
  methods(clientId: string, options?: CallOptions<TSignal>): Promise<NativeMethods>;
  start(
    input: NativeAttemptStart,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptStartResult>;
  resume(attempt: NativeAttempt, options?: CallOptions<TSignal>): Promise<NativeAttemptResult>;
  password(
    attempt: NativeAttempt,
    input: NativePasswordInput,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  provider(
    attempt: NativeAttempt,
    input: NativeProviderCredential,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  passkeyOptions(
    attempt: NativeAttempt,
    options?: CallOptions<TSignal>,
  ): Promise<NativePasskeyOptions>;
  passkeyVerify(
    attempt: NativeAttempt,
    input: NativePasskeyAssertion,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  secondFactor(
    attempt: NativeAttempt,
    input: NativeSecondFactorInput,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  requestEmailLink(
    attempt: NativeAttempt,
    email: string,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  verifyEmailLink(
    attempt: NativeAttempt,
    input: NativeEmailLinkVerificationInput,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  register(
    attempt: NativeAttempt,
    email: string,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  activate(
    attempt: NativeAttempt,
    input: NativeActivationInput,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  requestRecovery(
    attempt: NativeAttempt,
    email: string,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  confirmRecovery(
    attempt: NativeAttempt,
    input: NativeRecoveryConfirmationInput,
    options?: CallOptions<TSignal>,
  ): Promise<NativeAttemptResult>;
  consent(attempt: NativeAttempt, options?: CallOptions<TSignal>): Promise<NativeAttemptResult>;
  cancel(attempt: NativeAttempt, options?: CallOptions<TSignal>): Promise<NativeAttemptResult>;
}

export interface NativeAccountSummary {
  id: string;
  email: string;
  name: string;
}

export interface NativeApplicationSummary {
  clientId: string;
  displayName: string;
  scopes: string[];
  alreadyGranted: boolean;
}

export interface NativeAttemptViewBase {
  attemptId: string;
  expiresAt: string;
}

export type NativeAttemptView =
  | (NativeAttemptViewBase & {
      stage: 'firstFactorRequired';
      factors: NativeFirstFactor[];
      email?: string;
    })
  | (NativeAttemptViewBase & { stage: 'emailLinkSent'; email: string })
  | (NativeAttemptViewBase & {
      stage: 'registrationCodeRequired';
      email: string;
      activationCompleted?: boolean;
    })
  | (NativeAttemptViewBase & { stage: 'recoveryCodeRequired'; email: string })
  | (NativeAttemptViewBase & {
      stage: 'secondFactorRequired';
      factors: NativeSecondFactor[];
      activationCompleted?: boolean;
    })
  | (NativeAttemptViewBase & {
      stage: 'consentRequired';
      account: NativeAccountSummary;
      application: NativeApplicationSummary;
      activationCompleted?: boolean;
    })
  | (NativeAttemptViewBase & {
      stage: 'codeReady';
      redirectUri: string;
      activationCompleted?: boolean;
    })
  | (NativeAttemptViewBase & { stage: 'denied'; reason?: 'cancelled' })
  | (NativeAttemptViewBase & { stage: 'recoveryComplete'; passwordUpdated: true });

export type NativeAttemptResult = NativeAttemptView;
export type NativeAttemptStartResult = Extract<
  NativeAttemptView,
  { stage: 'firstFactorRequired' }
> & {
  attemptSecret: string;
  providerNonceDigest: string;
};
