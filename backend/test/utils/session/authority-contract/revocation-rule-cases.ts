import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { TEST_NOW } from '../../frozen-clock';
import {
  rerunAtOnce,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import {
  AuthorityHarnessSource,
  outcomeOf,
  signIn,
  storedFor,
  validates,
} from './authority-contract-support';

const ISSUED = 'session_issued';
const REVOKED = 'session_revoked';
const REVOKED_ALL = 'sessions_revoked_all';
const REVOKED_OTHERS = 'sessions_revoked_others';

export function revocationRuleCases(harness: AuthorityHarnessSource): void {
  function revoker() {
    return harness().revoker(rerunAtOnce);
  }

  async function revocationEvents() {
    return (await harness().events()).filter(({ action }) => action !== ISSUED);
  }

  it('signs one session out once, with its reason and one event', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    const other = await signIn(harness(), userId, 'other/1');
    const first = await revoker().revokeByToken(token);
    const stored = await harness().session(sessionId);
    const again = await revoker().revokeByToken(token);
    expect({
      first,
      again,
      unknown: await revoker().revokeByToken('unknown'),
      stored: {
        isValid: stored?.isValid,
        revokedAt: stored?.revokedAt,
        revokedReason: stored?.revokedReason,
      },
      validates: await validates(harness(), token),
      otherValidates: await validates(harness(), other.token),
      events: await revocationEvents(),
    }).toEqual({
      first: true,
      again: false,
      unknown: false,
      stored: {
        isValid: false,
        revokedAt: TEST_NOW,
        revokedReason: 'current_logout',
      },
      validates: false,
      otherValidates: true,
      events: [
        {
          action: REVOKED,
          actorId: null,
          targetUserId: userId,
          clientId: WEB_CLIENT,
          sessionId,
          reasonCode: 'current_logout',
        },
      ],
    });
  });

  it("ends a chosen session of the account and never another account's", async () => {
    const owner = await harness().issuance.seedAccount();
    const attacker = await harness().issuance.seedAccount();
    const chosen = await signIn(harness(), owner, 'chosen/1');
    const victim = await signIn(harness(), owner, 'victim/1');
    await signIn(harness(), attacker, 'attacker/1');
    const across = await revoker().revokeById(victim.sessionId, attacker);
    const own = await revoker().revokeById(chosen.sessionId, owner);
    expect({
      across,
      own,
      again: await revoker().revokeById(chosen.sessionId, owner),
      absent: await revoker().revokeById(harness().absentSessionId(), owner),
      malformed: await outcomeOf(revoker().revokeById('not-an-id', owner)),
      chosenReason: (await harness().session(chosen.sessionId))?.revokedReason,
      chosenValidates: await validates(harness(), chosen.token),
      victimValidates: await validates(harness(), victim.token),
      events: (await revocationEvents()).map(({ sessionId, reasonCode }) => ({
        sessionId,
        reasonCode,
      })),
    }).toEqual({
      across: false,
      own: true,
      again: false,
      absent: false,
      malformed: ErrorCode.AUTHORITY_UNAVAILABLE,
      chosenReason: 'selected_revoke',
      chosenValidates: false,
      victimValidates: true,
      events: [{ sessionId: chosen.sessionId, reasonCode: 'selected_revoke' }],
    });
  });

  it('signs out everywhere by moving the account version, and counts only live sessions', async () => {
    const userId = await harness().issuance.seedAccount();
    const live = await signIn(harness(), userId, 'live/1');
    const alsoLive = await signIn(harness(), userId, 'live/2');
    const revoked = await signIn(harness(), userId, 'revoked/1');
    const expired = await signIn(harness(), userId, 'expired/1');
    const olderVersion = await signIn(harness(), userId, 'older/1');
    await revoker().revokeByToken(revoked.token);
    await harness().patchSession(expired.sessionId, {
      idleExpiresAt: new Date('2099-01-01T11:59:59.999Z'),
    });
    await harness().patchSession(olderVersion.sessionId, { userVersion: 3 });
    const count = await revoker().revokeAllForUser(userId);
    const later = await signIn(harness(), userId, 'later/1');
    expect({
      count,
      accountVersion: (await harness().issuance.account(userId))
        ?.sessionVersion,
      live: await validates(harness(), live.token),
      alsoLive: await validates(harness(), alsoLive.token),
      storedAsValid: (await harness().session(live.sessionId))?.isValid,
      later: await validates(harness(), later.token),
      laterVersion: (await harness().session(later.sessionId))?.userVersion,
      event: (await revocationEvents()).find(
        ({ action }) => action === REVOKED_ALL,
      ),
    }).toEqual({
      count: 2,
      accountVersion: 1,
      live: false,
      alsoLive: false,
      storedAsValid: true,
      later: true,
      laterVersion: 1,
      event: {
        action: REVOKED_ALL,
        actorId: null,
        targetUserId: userId,
        clientId: null,
        sessionId: null,
        reasonCode: 'all_user',
      },
    });
  });

  it('records who forced a sign-out everywhere and why, and does nothing for an absent account', async () => {
    const userId = await harness().issuance.seedAccount();
    await signIn(harness(), userId);
    const count = await revoker().revokeAllForUser(userId, {
      actorId: 'admin-7',
      reasonCode: 'admin_forced',
    });
    const absent = await revoker().revokeAllForUser(
      harness().issuance.absentAccountId(),
    );
    expect({
      count,
      absent,
      malformed: await outcomeOf(
        revoker().revokeAllForUser(harness().issuance.foreignAccountId()),
      ),
      events: await revocationEvents(),
    }).toEqual({
      count: 1,
      absent: 0,
      malformed: ErrorCode.AUTHORITY_UNAVAILABLE,
      events: [
        {
          action: REVOKED_ALL,
          actorId: 'admin-7',
          targetUserId: userId,
          clientId: null,
          sessionId: null,
          reasonCode: 'admin_forced',
        },
      ],
    });
  });

  it('signs out everywhere else and keeps exactly the session it was asked to keep', async () => {
    const userId = await harness().issuance.seedAccount();
    const kept = await signIn(harness(), userId, 'kept/1');
    const first = await signIn(harness(), userId, 'first/1');
    const second = await signIn(harness(), userId, 'second/1');
    const count = await revoker().revokeAllOthersExceptSession(
      userId,
      kept.sessionId,
    );
    expect({
      count,
      validates: {
        kept: await validates(harness(), kept.token),
        first: await validates(harness(), first.token),
        second: await validates(harness(), second.token),
      },
      stored: await storedFor(harness(), userId, [
        kept.sessionId,
        first.sessionId,
        second.sessionId,
      ]),
      event: (await revocationEvents())[0],
    }).toEqual({
      count: 2,
      validates: { kept: true, first: false, second: false },
      stored: {
        accountVersion: 1,
        sessions: [
          { live: true, userVersion: 1 },
          { live: true, userVersion: 0 },
          { live: true, userVersion: 0 },
        ],
        events: [ISSUED, ISSUED, ISSUED, REVOKED_OTHERS],
      },
      event: {
        action: REVOKED_OTHERS,
        actorId: null,
        targetUserId: userId,
        clientId: null,
        sessionId: kept.sessionId,
        reasonCode: 'all_other',
      },
    });
  });

  it('refuses to sign out everywhere else unless the kept session is a live one of the account', async () => {
    const userId = await harness().issuance.seedAccount();
    const stranger = await harness().issuance.seedAccount();
    const live = await signIn(harness(), userId, 'live/1');
    const revoked = await signIn(harness(), userId, 'revoked/1');
    const older = await signIn(harness(), userId, 'older/1');
    const foreign = await signIn(harness(), stranger, 'stranger/1');
    await revoker().revokeByToken(revoked.token);
    await harness().patchSession(older.sessionId, { userVersion: 3 });
    const keep = (sessionId: string, account = userId) =>
      outcomeOf(revoker().revokeAllOthersExceptSession(account, sessionId));
    expect({
      revoked: await keep(revoked.sessionId),
      olderVersion: await keep(older.sessionId),
      anotherAccounts: await keep(foreign.sessionId),
      absent: await keep(harness().absentSessionId()),
      word: await keep('not-an-id'),
      otherDatabases: await keep(harness().foreignSessionId()),
      absentAccount: await keep(
        live.sessionId,
        harness().issuance.absentAccountId(),
      ),
      malformedAccount: await keep(
        live.sessionId,
        harness().issuance.foreignAccountId(),
      ),
      stored: await storedFor(harness(), userId, [live.sessionId]),
      liveValidates: await validates(harness(), live.token),
    }).toEqual({
      revoked: ErrorCode.SESSION_INVALID,
      olderVersion: ErrorCode.SESSION_INVALID,
      anotherAccounts: ErrorCode.SESSION_INVALID,
      absent: ErrorCode.SESSION_INVALID,
      word: ErrorCode.SESSION_INVALID,
      otherDatabases: ErrorCode.SESSION_INVALID,
      absentAccount: ErrorCode.USER_NOT_FOUND,
      malformedAccount: ErrorCode.AUTHORITY_UNAVAILABLE,
      stored: {
        accountVersion: 0,
        sessions: [{ live: true, userVersion: 0 }],
        events: [ISSUED, ISSUED, ISSUED, REVOKED],
      },
      liveValidates: true,
    });
  });
}
