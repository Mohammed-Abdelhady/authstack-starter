import type {
  NativeAttempt,
  VerifiedNativePrincipal,
} from '../types/native-attempt';
import { isFirstFactorClaim } from './native-first-factor-claim';

function attempt(
  phase: NativeAttempt['phase'],
  flow: NativeAttempt['flow'],
): NativeAttempt {
  return {
    id: 'row-1',
    attemptId: 'attempt-1',
    secretHash: 'a'.repeat(64),
    clientId: 'client',
    redirectUri: 'myapp://callback',
    codeChallenge: 'challenge',
    state: 'state',
    requestedScopes: [],
    flow,
    phase,
    authEpoch: 1,
    createdAt: new Date('2099-01-01T12:00:00.000Z'),
    expiresAt: new Date('2099-01-01T12:15:00.000Z'),
    revision: 1,
    activeOperationId: 'operation',
    cancelledAt: null,
    details: {
      verifiedAccount: null,
      nonceDigest: null,
      email: null,
      codeReply: null,
    },
  };
}

function principal(
  firstFactor: VerifiedNativePrincipal['firstFactor'],
): VerifiedNativePrincipal {
  return {
    userId: 'user',
    userVersion: 1,
    firstFactor,
    authenticationMethods: [firstFactor],
  };
}

describe('first factor claim on a mailed sign-in', () => {
  it.each([
    ['emailLink', true],
    ['emailCode', true], // feature:email-code
    ['password', false],
    ['provider', false],
  ] as const)(
    'decides %s for a sign-in waiting on its mail: %s',
    (factor, accepted) => {
      expect(
        isFirstFactorClaim(
          attempt('emailLinkSent', 'signIn'),
          principal(factor),
        ),
      ).toBe(accepted);
    },
  );

  // feature:email-code:start
  it('refuses an emailed code for a mailed attempt outside sign-in', () => {
    expect(
      isFirstFactorClaim(
        attempt('emailLinkSent', 'registration'),
        principal('emailCode'),
      ),
    ).toBe(false);
  });
  // feature:email-code:end
});
