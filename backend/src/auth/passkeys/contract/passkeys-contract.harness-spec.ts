import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { rerunAtOnce } from '../../../../test/utils/session/issuance-contract/issuance-contract-support';
import { AppException } from '../../../common/exceptions/app.exception';
import { HashService } from '../../../common/services/hash.service';
import { RerunPause } from '../../../common/persistence/unit-of-work';
import {
  createRequestMock,
  createResponseMock,
  partialMock, // feature:totp
} from '../../../common/testing/test-doubles.harness-spec';
import { SignInMethodRule } from '../../../user/services/sign-in-method.rule';
import { AuthFeaturesService } from '../../services/features/auth-features.service';
import { TwoFactorVerificationService } from '../../two-factor/services/two-factor-verification.service'; // feature:totp
import { SecondFactorStore } from '../../two-factor/stores/second-factor.store'; // feature:totp
import { PasskeyCredentialDto } from '../dto/passkey-credential.dto';
import { PasskeyAssertionService } from '../services/passkey-assertion.service';
import { PasskeyChallengeService } from '../services/passkey-challenge.service';
import { PasskeyConfigService } from '../services/passkey-config.service';
import { PasskeyLoginService } from '../services/passkey-login.service';
import { PasskeyManagementService } from '../services/passkey-management.service';
import { PasskeyRegistrationReauth } from '../services/passkey-registration-reauth.service';
import {
  PasskeyRegistrationService,
  SignedInRequest,
} from '../services/passkey-registration.service';
import { PasskeySecondFactorVerifier } from '../services/passkey-second-factor.verifier';
import { PasskeyRecorder } from '../services/passkey-recorder.service';
import { NoopEnrolmentPromotion } from '../../contracts/defaults/noop-enrolment-promotion';
import { SessionCookieService } from '../../services/sessions/session-cookie.service';
import {
  noRequiredRelyingParties,
  webPasskeyPolicy,
} from '../services/browser-passkey-policy.harness-spec';
import { AttestationVerification } from '../services/webauthn.adapter';
import { PasskeysContractHarness } from './passkeys-contract-database.harness-spec';

import {
  RecordingSignIn,
  ScriptedAuthenticator,
} from './passkeys-contract-doubles.harness-spec';

export * from './passkeys-contract-database.harness-spec';
export * from './passkeys-contract-doubles.harness-spec';

/** Written out, so a changed constant cannot agree with itself. */
export const CHALLENGE_LIFETIME_MS = 300_000;
export const CHALLENGE_COOKIE = 'pk_challenge';
export const DEFAULT_NAME = 'Passkey';
export const BCRYPT_ROUNDS = 4;
export const PASSWORD = 'Password123!';
export const OWNER_EMAIL = 'owner@example.test';
export const OTHER_EMAIL = 'other@example.test';
export const CREDENTIAL_ID = 'Y3JlZGVudGlhbC1vbmU';
export const OTHER_CREDENTIAL_ID = 'Y3JlZGVudGlhbC10d28';
export const NOW = new Date('2099-01-01T12:00:00.000Z');

export interface PasskeysFixture {
  /** An account with a password. */
  ownerId: string;
  /** A second account, also with one. */
  otherId: string;
}

/** The stored form of a challenge, worked out apart from the service. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface PasskeyServices {
  registration: PasskeyRegistrationService;
  assertion: PasskeyAssertionService;
  login: PasskeyLoginService;
  management: PasskeyManagementService;
  verifier: PasskeySecondFactorVerifier;
  challenge: PasskeyChallengeService;
  /** The one write both registration routes store a passkey through. */
  recorder: PasskeyRecorder;
  authenticator: ScriptedAuthenticator;
  signIn: RecordingSignIn;
  /** The rule every removal of a way in asks, on the same feature switches. */
  signInRule: SignInMethodRule;
  /** Every store call the services made, in order. */
  storeCalls: string[];
}

function recorded<Store extends object>(
  store: Store,
  label: string,
  calls: string[],
): Store {
  return new Proxy(store, {
    get(target, property) {
      const member: unknown = Reflect.get(target, property, target);
      if (typeof member !== 'function' || typeof property !== 'string') {
        return member;
      }
      return (...args: unknown[]): unknown => {
        calls.push(`${label}.${property}`);
        return Reflect.apply(member, target, args);
      };
    },
  });
}

export interface FeatureSwitches {
  password?: boolean;
  magicLink?: boolean;
  passkeys?: boolean;
}

/** The real services on one database's adapters. */
export function passkeyServices(
  harness: PasskeysContractHarness,
  features: FeatureSwitches = {},
  pause: RerunPause = rerunAtOnce,
): PasskeyServices {
  const config = new ConfigService({
    oauth: { stateSecret: 'contract-state-secret-0000000000000000' },
    passkeys: {
      enabled: features.passkeys ?? true,
      rpId: 'localhost',
      rpName: 'Contract',
      origin: 'http://localhost:3000',
    },
    auth: { passwordEnabled: features.password ?? true },
    bcrypt: { rounds: BCRYPT_ROUNDS },
    magicLink: { enabled: features.magicLink ?? false },
    NODE_ENV: 'test',
  });
  const browserApplications = browserApplicationsForTest(config);
  const storeCalls: string[] = [];
  const passkeys = recorded(harness.passkeys, 'passkeys', storeCalls);
  const accounts = recorded(harness.accounts, 'accounts', storeCalls);
  const challenges = recorded(harness.challenges, 'challenges', storeCalls);
  const authenticator = new ScriptedAuthenticator();
  const passkeyConfig = new PasskeyConfigService(config);
  const featureSwitches = new AuthFeaturesService(config, browserApplications);
  const challenge = new PasskeyChallengeService(
    challenges,
    config,
    browserApplications,
  );
  const policy = webPasskeyPolicy({
    rpId: passkeyConfig.rpId,
    origins: [passkeyConfig.origin],
  });
  const assertion = new PasskeyAssertionService(
    passkeys,
    authenticator,
    passkeyConfig,
    challenge,
    policy,
  );
  const signIn = new RecordingSignIn();
  const signInRule = new SignInMethodRule(
    harness.signInMethods,
    featureSwitches,
  );
  const recorder = new PasskeyRecorder(
    passkeys,
    accounts,
    harness.runner(pause),
    new NoopEnrolmentPromotion(),
  );

  return {
    registration: new PasskeyRegistrationService(
      passkeys,
      accounts,
      authenticator,
      passkeyConfig,
      challenge,
      new PasskeyRegistrationReauth(
        new HashService(config),
        featureSwitches,
        accounts,
        // The accounts of these cases have no second factor. The cases of an
        // account that has one run in the second factor contract.
        // feature:totp:start
        partialMock<SecondFactorStore>({
          findAccount: () => Promise.resolve(null),
        }),
        partialMock<TwoFactorVerificationService>({}),
        // feature:totp:end
      ),
      recorder,
      policy,
      new SessionCookieService(config, browserApplications),
    ),
    assertion,
    login: new PasskeyLoginService(accounts, assertion, signIn),
    management: new PasskeyManagementService(
      passkeys,
      signInRule,
      harness.runner(pause),
      passkeyConfig,
      browserApplications,
      noRequiredRelyingParties(),
    ),
    verifier: new PasskeySecondFactorVerifier(featureSwitches, assertion),
    challenge,
    recorder,
    authenticator,
    signIn,
    signInRule,
    storeCalls,
  };
}

/** A credential body, standing in for what the browser would send. */
export function credential(id: string = CREDENTIAL_ID): PasskeyCredentialDto {
  return Object.assign(new PasskeyCredentialDto(), {
    id,
    rawId: id,
    response: {},
    clientExtensionResults: {},
    type: 'public-key',
  });
}

/** What the library reports for a credential that just registered. */
export function attestationOf(
  credentialId: string = CREDENTIAL_ID,
): AttestationVerification {
  return {
    credentialId,
    publicKey: Buffer.from([0, 255, 1, 128]),
    counter: 0,
    transports: ['internal', 'hybrid'],
    deviceType: 'multiDevice',
    backedUp: true,
    userVerified: true,
  };
}

/** The session a browser is signed in on, as far as a passkey route reads it. */
export interface BrowserSession {
  id: string;
  createdAt: Date;
  clientId: string;
}

/** A session that started at the frozen time, so it counts as a recent sign-in. */
export const SESSION: BrowserSession = {
  id: 'session-one',
  createdAt: NOW,
  clientId: 'contract-web',
};

/** One browser: the cookies it holds, and the request and response using them. */
export interface Browser {
  request: SignedInRequest;
  response: Response;
  cookies: Record<string, string>;
}

/** A browser on `session`, or signed out when it is given null. */
export function browser(
  cookies: Record<string, string> = {},
  session: BrowserSession | null = SESSION,
): Browser {
  const jar = { ...cookies };
  return {
    cookies: jar,
    request: createRequestMock({ cookies: jar, session: session ?? undefined }),
    response: createResponseMock({
      cookie: (name: string, value: string): void => {
        jar[name] = value;
      },
      clearCookie: (name: string): void => {
        delete jar[name];
      },
    }),
  };
}

export interface Answer {
  code: string;
  status: number;
}

/** Awaits a promise that must be refused and hands back how. */
export async function refusalOf(promise: Promise<unknown>): Promise<Answer> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) {
      return { code: error.code, status: error.getStatus() };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

/** How one attempt ended: accepted, the code it was refused with, or the error's name. */
export async function outcomeOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof AppException) return error.code;
    if (error instanceof Error) return error.name;
    throw error;
  }
  return 'accepted';
}

/** Awaits a promise that must reject and hands back what it rejected with. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

/** Asks for sign-in options the way a browser does and keeps the cookie. */
export async function signInBrowser(
  services: PasskeyServices,
): Promise<Browser> {
  const holder = browser();
  await services.login.createOptions(holder.response);
  return holder;
}

/**
 * Asks for registration options the way a signed-in browser does: with the
 * password, on a session that started at the frozen time.
 */
export async function registrationBrowser(
  services: PasskeyServices,
  userId: string,
): Promise<Browser> {
  const holder = browser();
  await services.registration.createOptions(
    userId,
    { password: PASSWORD },
    holder.request,
    holder.response,
  );
  return holder;
}
