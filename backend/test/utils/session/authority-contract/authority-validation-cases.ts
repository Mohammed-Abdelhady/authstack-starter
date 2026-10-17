import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { rerunAtOnce } from '../issuance-contract/issuance-contract-support';
import {
  ADMIN_APPLICATION,
  ADMIN_CLIENT,
  WEB_APPLICATION,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import {
  AuthorityHarnessSource,
  outcomeOf,
  signIn,
  validates,
} from './authority-contract-support';

/** The contract's web application: idle for ten minutes, two hours in all. */
const IDLE_DEADLINE = new Date('2099-01-01T12:10:00.000Z');
const ABSOLUTE_DEADLINE = new Date('2099-01-01T14:00:00.000Z');
const ONE_MS = 1;

function before(deadline: Date): Date {
  return new Date(deadline.getTime() - ONE_MS);
}

export function authorityValidationCases(
  harness: AuthorityHarnessSource,
): void {
  it('validates a signed-in credential and names its session and account', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    const validated = await harness().validator().validateByToken(token, false);
    expect({
      session: validated?.session.id,
      owner: validated?.session.userId,
      account: validated?.account,
      extended: validated?.extended,
      unknown: await harness().validator().validateByToken('unknown', false),
      empty: await harness().validator().validateByToken('', false),
    }).toEqual({
      session: sessionId,
      owner: userId,
      account: { id: userId, isDeleted: false, sessionVersion: 0 },
      extended: false,
      unknown: null,
      empty: null,
    });
  });

  it('validates by id only a native-access session, and by credential only a browser one', async () => {
    const userId = await harness().issuance.seedAccount();
    const browser = await signIn(harness(), userId, 'browser/1');
    const native = await signIn(harness(), userId, 'native/1');
    await harness().patchSession(native.sessionId, {
      credentialPurpose: 'native_access',
    });
    const validator = harness().validator();
    expect({
      nativeById: (await validator.validateById(native.sessionId, false))
        ?.session.id,
      browserById: await validator.validateById(browser.sessionId, false),
      nativeByCredential: await validator.validateByToken(native.token, false),
      browserByCredential: (
        await validator.validateByToken(browser.token, false)
      )?.session.id,
    }).toEqual({
      nativeById: native.sessionId,
      browserById: null,
      nativeByCredential: null,
      browserByCredential: browser.sessionId,
    });
  });

  it('keeps legacy sessions valid with unverified baseline evidence', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    await harness().clearSessionEvidence(sessionId);

    const validated = await harness().validator().validateByToken(token, false);

    expect({
      id: validated?.session.id,
      userVerified: validated?.session.userVerified,
      policyVersion: validated?.session.policyVersion,
    }).toEqual({ id: sessionId, userVerified: false, policyVersion: 0 });
  });

  it('retains verified evidence when the application policy version matches', async () => {
    const userId = await harness().issuance.seedAccount();
    await harness().issuance.seedApplication({
      ...WEB_APPLICATION,
      policyVersion: 4,
    });
    const { token, sessionId } = await signIn(harness(), userId);
    await harness().patchSession(sessionId, {
      userVerified: true,
      policyVersion: 4,
    });

    const byId = await harness().authorityStore.findSessionById(sessionId);
    const validated = await harness().validator().validateByToken(token, false);
    expect({
      byId: [byId?.userVerified, byId?.policyVersion],
      byToken: [
        validated?.session.userVerified,
        validated?.session.policyVersion,
      ],
    }).toEqual({ byId: [true, 4], byToken: [true, 4] });
  });

  // Failure: changed application policy leaves a browser or native access session usable.
  it('refuses policy-stale sessions at validation and in active-session reads', async () => {
    const userId = await harness().issuance.seedAccount();
    const browser = await signIn(harness(), userId);
    const native = await signIn(harness(), userId);
    await harness().patchSession(native.sessionId, {
      credentialPurpose: 'native_access',
    });
    await harness().issuance.seedApplication({
      ...WEB_APPLICATION,
      policyVersion: 1,
    });
    const validator = harness().validator();
    expect({
      browser: await validator.validateByToken(browser.token, false),
      native: await validator.validateById(native.sessionId, false),
      active: await validator.listActive(userId),
    }).toEqual({ browser: null, native: null, active: [] });
    const current = await signIn(harness(), userId);
    expect(await validates(harness(), current.token)).toBe(true);
  });

  it('answers a malformed session id as unavailable and an absent one as no session', async () => {
    const validator = harness().validator();
    expect({
      word: await outcomeOf(validator.validateById('not-an-id', false)),
      foreign: await outcomeOf(
        validator.validateById(harness().foreignSessionId(), false),
      ),
      absent: await validator.validateById(harness().absentSessionId(), false),
    }).toEqual({
      word: ErrorCode.AUTHORITY_UNAVAILABLE,
      foreign: ErrorCode.AUTHORITY_UNAVAILABLE,
      absent: null,
    });
  });

  it.each([
    ['a revoked session', { revoke: true }],
    ['another auth epoch', { patch: { authEpoch: 2 } }],
    ['another schema version', { patch: { schemaVersion: 2 } }],
    ['an older account version', { patch: { userVersion: 4 } }],
    ['an older client version', { patch: { clientVersion: 4 } }],
    ['an older grant version', { patch: { grantVersion: 4 } }],
  ])(
    'refuses %s',
    async (
      _name,
      shape: { revoke?: boolean; patch?: Record<string, number> },
    ) => {
      const userId = await harness().issuance.seedAccount();
      const { token, sessionId } = await signIn(harness(), userId);
      const validBefore = await validates(harness(), token);
      if (shape.revoke) {
        await harness().revoker(rerunAtOnce).revokeByToken(token);
      }
      if (shape.patch) {
        await harness().patchSession(sessionId, shape.patch);
      }
      expect({
        validBefore,
        validAfter: await validates(harness(), token),
      }).toEqual({ validBefore: true, validAfter: false });
    },
  );

  it('refuses a session once its account is deleted or its version has moved on', async () => {
    const deleted = await harness().issuance.seedAccount();
    const moved = await harness().issuance.seedAccount();
    const kept = await harness().issuance.seedAccount();
    const deletedSession = await signIn(harness(), deleted);
    const movedSession = await signIn(harness(), moved);
    const keptSession = await signIn(harness(), kept);
    await harness().markAccountDeleted(deleted);
    await harness().issuance.bumpAccountVersion(moved);
    expect({
      deleted: await validates(harness(), deletedSession.token),
      moved: await validates(harness(), movedSession.token),
      kept: await validates(harness(), keptSession.token),
    }).toEqual({ deleted: false, moved: false, kept: true });
  });

  it('refuses a session whose application is disabled or has moved its version', async () => {
    const userId = await harness().issuance.seedAccount();
    const web = await signIn(harness(), userId, 'web/1', WEB_CLIENT);
    const admin = await signIn(harness(), userId, 'admin/1', ADMIN_CLIENT);
    await harness().issuance.seedApplication({
      ...WEB_APPLICATION,
      enabled: false,
    });
    await harness().issuance.seedApplication({
      ...ADMIN_APPLICATION,
      sessionVersion: 1,
    });
    const refused = {
      disabled: await validates(harness(), web.token),
      versionMoved: await validates(harness(), admin.token),
    };
    await harness().issuance.seedApplication(WEB_APPLICATION);
    expect({
      refused,
      enabledAgain: await validates(harness(), web.token),
    }).toEqual({
      refused: { disabled: false, versionMoved: false },
      enabledAgain: true,
    });
  });

  it('refuses a session whose grant is blocked, has moved its version, or is gone', async () => {
    const blocked = await harness().issuance.seedAccount();
    const moved = await harness().issuance.seedAccount();
    const gone = await harness().issuance.seedAccount();
    const blockedSession = await signIn(harness(), blocked);
    const movedSession = await signIn(harness(), moved);
    const goneSession = await signIn(harness(), gone);
    await harness().patchGrant(blocked, WEB_CLIENT, { allowed: false });
    await harness().patchGrant(moved, WEB_CLIENT, { sessionVersion: 1 });
    await harness().removeGrant(gone, WEB_CLIENT);
    expect({
      blocked: await validates(harness(), blockedSession.token),
      moved: await validates(harness(), movedSession.token),
      gone: await validates(harness(), goneSession.token),
    }).toEqual({ blocked: false, moved: false, gone: false });
  });

  it('persists expiry exactly at the idle deadline', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    harness().issuance.clock.set(before(IDLE_DEADLINE));
    const justBefore = await validates(harness(), token);
    harness().issuance.clock.set(IDLE_DEADLINE);
    expect({
      justBefore,
      atDeadline: await validates(harness(), token),
      storedAsValid: (await harness().session(sessionId))?.isValid,
    }).toEqual({ justBefore: true, atDeadline: false, storedAsValid: false });
  });

  it('ends authority at the absolute deadline whatever the activity', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    await harness().patchSession(sessionId, {
      lastActivityAt: new Date('2099-01-01T13:55:00.000Z'),
      idleExpiresAt: new Date('2099-01-01T15:00:00.000Z'),
    });
    harness().issuance.clock.set(before(ABSOLUTE_DEADLINE));
    const justBefore = await validates(harness(), token);
    harness().issuance.clock.set(ABSOLUTE_DEADLINE);
    expect({
      justBefore,
      atDeadline: await validates(harness(), token),
      storedAsValid: (await harness().session(sessionId))?.isValid,
    }).toEqual({ justBefore: true, atDeadline: false, storedAsValid: false });
  });

  it('ends authority early when the application shortens its idle lifetime', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token } = await signIn(harness(), userId);
    await harness().issuance.seedApplication({
      ...WEB_APPLICATION,
      idleLifetimeMs: 60_000,
    });
    harness().issuance.clock.set(new Date('2099-01-01T12:00:59.999Z'));
    const justBefore = await validates(harness(), token);
    harness().issuance.clock.set(new Date('2099-01-01T12:01:00.000Z'));
    expect({
      justBefore,
      atShortened: await validates(harness(), token),
    }).toEqual({ justBefore: true, atShortened: false });
  });
}
