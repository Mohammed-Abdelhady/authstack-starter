import {
  CREDENTIAL_PURPOSE,
  CredentialPurpose,
} from '../../constants/credential-purpose';
import { AUTH_SCHEMA_VERSION } from '../../constants/session-policy';
import { currentSessionDeadlines } from './current-session-authority';

const NOW = new Date('2026-09-21T12:00:00.000Z');
const EXPECTED_DEADLINES = {
  absolute: new Date('2026-09-21T14:00:00.000Z'),
  idle: new Date('2026-09-21T13:00:00.000Z'),
};

function checkPurpose(
  sessionPurpose: CredentialPurpose,
  expectedPurpose: CredentialPurpose,
) {
  return currentSessionDeadlines(
    {
      isValid: true,
      credentialPurpose: sessionPurpose,
      authEpoch: 1,
      schemaVersion: AUTH_SCHEMA_VERSION,
      clientId: 'native-app',
      userVersion: 0,
      clientVersion: 0,
      grantVersion: 0,
      authenticatedAt: NOW,
      expiresAt: new Date('2026-09-21T14:00:00.000Z'),
      idleExpiresAt: new Date('2026-09-21T13:00:00.000Z'),
      lastActivityAt: NOW,
    },
    { isDeleted: false, sessionVersion: 0 },
    {
      platform: 'native',
      enabled: true,
      sessionVersion: 0,
      policy: { absoluteLifetimeMs: 7_200_000, idleLifetimeMs: 3_600_000 },
    },
    { allowed: true, sessionVersion: 0 },
    NOW,
    1,
    expectedPurpose,
  );
}

describe('currentSessionDeadlines credential purpose', () => {
  it('accepts native access when native access is expected', () => {
    expect(
      checkPurpose(
        CREDENTIAL_PURPOSE.NATIVE_ACCESS,
        CREDENTIAL_PURPOSE.NATIVE_ACCESS,
      ),
    ).toEqual(EXPECTED_DEADLINES);
  });

  it('rejects native access when a browser session is expected', () => {
    expect(
      checkPurpose(
        CREDENTIAL_PURPOSE.NATIVE_ACCESS,
        CREDENTIAL_PURPOSE.BROWSER_SESSION,
      ),
    ).toBeNull();
  });

  it('rejects a browser session when native access is expected', () => {
    expect(
      checkPurpose(
        CREDENTIAL_PURPOSE.BROWSER_SESSION,
        CREDENTIAL_PURPOSE.NATIVE_ACCESS,
      ),
    ).toBeNull();
  });

  it('accepts a browser session when a browser session is expected', () => {
    expect(
      checkPurpose(
        CREDENTIAL_PURPOSE.BROWSER_SESSION,
        CREDENTIAL_PURPOSE.BROWSER_SESSION,
      ),
    ).toEqual(EXPECTED_DEADLINES);
  });
});
