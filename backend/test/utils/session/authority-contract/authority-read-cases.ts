import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { CREDENTIAL_PURPOSE } from '../../../../src/session/constants/credential-purpose';
import { MalformedIdError } from '../../../../src/common/persistence/persistence-errors';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  ADMIN_APPLICATION,
  ADMIN_CLIENT,
  rejectionOf,
  rerunAtOnce,
  WEB_CLIENT,
} from '../issuance-contract/issuance-contract-support';
import {
  AuthorityHarnessSource,
  outcomeOf,
  signIn,
  validates,
} from './authority-contract-support';

const EXTENDED = 'extended';
const NOT_LIVE = 'not_live';
const SIX_MINUTES_IN = new Date('2099-01-01T12:06:00.000Z');
const SIXTEEN_MINUTES_IN = new Date('2099-01-01T12:16:00.000Z');
/** An idle deadline past the absolute one, so only the absolute one can refuse. */
const LONG_IDLE = new Date('2099-01-01T15:00:00.000Z');

export function authorityReadCases(harness: AuthorityHarnessSource): void {
  let gates: RaceGate[] = [];
  let restores: Array<() => void> = [];

  afterEach(() => {
    for (const gate of gates) gate.release();
    for (const restore of restores) restore();
    gates = [];
    restores = [];
  });

  function extension(now: Date) {
    return { now, idleExpiresAt: SIXTEEN_MINUTES_IN };
  }

  it('extends a live session and says so, once it is the store deciding', async () => {
    const userId = await harness().issuance.seedAccount();
    const { sessionId } = await signIn(harness(), userId);
    const outcome = await harness().authorityStore.extendIdle(
      sessionId,
      extension(SIX_MINUTES_IN),
    );
    const stored = await harness().session(sessionId);
    expect({
      outcome,
      idleExpiresAt: stored?.idleExpiresAt,
      lastActivityAt: stored?.lastActivityAt,
      lastUsedAt: stored?.lastUsedAt,
    }).toEqual({
      outcome: EXTENDED,
      idleExpiresAt: SIXTEEN_MINUTES_IN,
      lastActivityAt: SIX_MINUTES_IN,
      lastUsedAt: SIX_MINUTES_IN,
    });
  });

  it('extends nothing that is revoked, past a deadline, or absent', async () => {
    const userId = await harness().issuance.seedAccount();
    const revoked = await signIn(harness(), userId, 'revoked/1');
    const live = await signIn(harness(), userId, 'live/1');
    const longIdle = await signIn(harness(), userId, 'long-idle/1');
    await harness().revoker(rerunAtOnce).revokeByToken(revoked.token);
    await harness().patchSession(longIdle.sessionId, {
      idleExpiresAt: LONG_IDLE,
    });
    const store = harness().authorityStore;
    expect({
      revoked: await store.extendIdle(
        revoked.sessionId,
        extension(SIX_MINUTES_IN),
      ),
      beforeIdleDeadline: await store.extendIdle(
        live.sessionId,
        extension(new Date('2099-01-01T12:09:59.999Z')),
      ),
      atIdleDeadline: await store.extendIdle(
        live.sessionId,
        extension(SIXTEEN_MINUTES_IN),
      ),
      beforeAbsoluteDeadline: await store.extendIdle(longIdle.sessionId, {
        now: new Date('2099-01-01T13:59:59.999Z'),
        idleExpiresAt: LONG_IDLE,
      }),
      atAbsoluteDeadline: await store.extendIdle(longIdle.sessionId, {
        now: new Date('2099-01-01T14:00:00.000Z'),
        idleExpiresAt: LONG_IDLE,
      }),
      absent: await store.extendIdle(
        harness().absentSessionId(),
        extension(SIX_MINUTES_IN),
      ),
      revokedStillAt: (await harness().session(revoked.sessionId))
        ?.idleExpiresAt,
    }).toEqual({
      revoked: NOT_LIVE,
      beforeIdleDeadline: EXTENDED,
      atIdleDeadline: NOT_LIVE,
      beforeAbsoluteDeadline: EXTENDED,
      atAbsoluteDeadline: NOT_LIVE,
      absent: NOT_LIVE,
      revokedStillAt: new Date('2099-01-01T12:10:00.000Z'),
    });
  });

  it('refuses an id this database could not have issued, in every read and in the extension', async () => {
    const store = harness().authorityStore;
    const foreign = harness().foreignSessionId();
    const calls: Record<string, () => Promise<unknown>> = {
      readCommittedSessionById: () => store.readCommittedSessionById(foreign),
      readCommittedAccount: () => store.readCommittedAccount(foreign),
      readCommittedGrant: () => store.readCommittedGrant(foreign, WEB_CLIENT),
      readCommittedGrants: () =>
        store.readCommittedGrants(foreign, [WEB_CLIENT]),
      listSessionCandidates: () =>
        store.listSessionCandidates({
          userId: foreign,
          userVersion: 0,
          authEpoch: 1,
          now: SIX_MINUTES_IN,
          purposes: ['browser_session'],
        }),
      findSessionById: () => store.findSessionById(foreign),
      extendIdle: () => store.extendIdle(foreign, extension(SIX_MINUTES_IN)),
      aWord: () => store.findSessionById('not-an-id'),
    };
    const malformed: Record<string, boolean> = {};
    for (const [name, call] of Object.entries(calls)) {
      malformed[name] = (await rejectionOf(call())) instanceof MalformedIdError;
    }
    expect(malformed).toEqual({
      readCommittedSessionById: true,
      readCommittedAccount: true,
      readCommittedGrant: true,
      readCommittedGrants: true,
      listSessionCandidates: true,
      findSessionById: true,
      extendIdle: true,
      aWord: true,
    });
  });

  it('lists live sessions most recently used first and leaves the rest out', async () => {
    const userId = await harness().issuance.seedAccount();
    const otherUser = await harness().issuance.seedAccount();
    const oldest = await signIn(harness(), userId, 'oldest/1');
    const newest = await signIn(harness(), userId, 'newest/1');
    const middle = await signIn(harness(), userId, 'middle/1');
    const revoked = await signIn(harness(), userId, 'revoked/1');
    const expired = await signIn(harness(), userId, 'expired/1');
    const olderVersion = await signIn(harness(), userId, 'older/1');
    await signIn(harness(), otherUser, 'other/1');
    await harness().patchSession(oldest.sessionId, {
      lastUsedAt: new Date('2099-01-01T12:01:00.000Z'),
    });
    await harness().patchSession(newest.sessionId, {
      lastUsedAt: new Date('2099-01-01T12:03:00.000Z'),
    });
    await harness().patchSession(middle.sessionId, {
      lastUsedAt: new Date('2099-01-01T12:02:00.000Z'),
    });
    await harness().revoker(rerunAtOnce).revokeByToken(revoked.token);
    await harness().patchSession(expired.sessionId, {
      idleExpiresAt: new Date('2099-01-01T11:59:59.999Z'),
    });
    await harness().patchSession(olderVersion.sessionId, { userVersion: 3 });
    const listed = await harness().validator().listActive(userId);
    expect({
      ids: listed.map(({ id }) => id),
      owners: [...new Set(listed.map((session) => session.userId))],
      agents: listed.map(({ userAgent }) => userAgent),
    }).toEqual({
      ids: [newest.sessionId, middle.sessionId, oldest.sessionId],
      owners: [userId],
      agents: ['newest/1', 'middle/1', 'oldest/1'],
    });
  });

  it('leaves out sessions of a disabled application and of a blocked grant', async () => {
    const disabled = await harness().issuance.seedAccount();
    const blocked = await harness().issuance.seedAccount();
    const web = await signIn(harness(), disabled, 'web/1', WEB_CLIENT);
    await signIn(harness(), disabled, 'admin/1', ADMIN_CLIENT);
    await signIn(harness(), blocked, 'web/1', WEB_CLIENT);
    const both = await harness().validator().listActive(disabled);
    await harness().issuance.seedApplication({
      ...ADMIN_APPLICATION,
      enabled: false,
    });
    await harness().patchGrant(blocked, WEB_CLIENT, { allowed: false });
    expect({
      before: both.length,
      disabledApplication: (
        await harness().validator().listActive(disabled)
      ).map(({ id }) => id),
      blockedGrant: await harness().validator().listActive(blocked),
    }).toEqual({
      before: 2,
      disabledApplication: [web.sessionId],
      blockedGrant: [],
    });
  });

  it('lists nothing for a deleted or absent account, and refuses a malformed one', async () => {
    const deleted = await harness().issuance.seedAccount();
    const empty = await harness().issuance.seedAccount();
    await signIn(harness(), deleted);
    await harness().markAccountDeleted(deleted);
    const validator = harness().validator();
    expect({
      deleted: await validator.listActive(deleted),
      withoutSessions: await validator.listActive(empty),
      absent: await validator.listActive(harness().issuance.absentAccountId()),
      foreign: await outcomeOf(
        validator.listActive(harness().issuance.foreignAccountId()),
      ),
    }).toEqual({
      deleted: [],
      withoutSessions: [],
      absent: [],
      foreign: ErrorCode.AUTHORITY_UNAVAILABLE,
    });
  });

  it('finds a stored session whether or not it still holds authority', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token, sessionId } = await signIn(harness(), userId);
    await harness().revoker(rerunAtOnce).revokeByToken(token);
    const validator = harness().validator();
    const byId = await validator.findById(sessionId);
    const byToken = await validator.findByToken(token);
    expect({
      byId: { id: byId?.id, owner: byId?.userId, isValid: byId?.isValid },
      byToken: byToken?.id,
      absentId: await validator.findById(harness().absentSessionId()),
      unknownToken: await validator.findByToken('unknown'),
      malformed: await outcomeOf(validator.findById('not-an-id')),
    }).toEqual({
      byId: { id: sessionId, owner: userId, isValid: false },
      byToken: sessionId,
      absentId: null,
      unknownToken: null,
      malformed: ErrorCode.AUTHORITY_UNAVAILABLE,
    });
  });

  it('reads only what is committed: not a revocation still open, and every one that has returned', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token } = await signIn(harness(), userId);
    const written = new RaceGate();
    gates.push(written);
    restores.push(
      holdBefore(
        harness().revocationStore,
        'appendSecurityEvent',
        () => written,
      ),
    );
    const revoking = harness().revoker(rerunAtOnce).revokeByToken(token);
    await written.reached(1);
    const whileOpen = await validates(harness(), token);
    written.release();
    const revoked = await revoking;
    expect({
      whileOpen,
      revoked,
      afterItReturned: await validates(harness(), token),
    }).toEqual({ whileOpen: true, revoked: true, afterItReturned: false });
  });

  it.each([false, true])(
    'keeps a survivor valid across promotion with native=%s',
    async (native) => {
      const userId = await harness().issuance.seedAccount();
      const kept = await signIn(harness(), userId);
      const other = await signIn(harness(), userId);
      if (native) {
        await harness().patchSession(kept.sessionId, {
          credentialPurpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
        });
      }
      const accountRead = new RaceGate();
      gates.push(accountRead);
      restores.push(
        holdBefore(harness().authorityStore, 'readCommittedAccount', (call) =>
          call === 0 ? accountRead : undefined,
        ),
      );
      const ongoing = native
        ? harness().validator().validateById(kept.sessionId, false)
        : harness().validator().validateByToken(kept.token, false);
      try {
        await accountRead.reached();
        await harness()
          .revoker(rerunAtOnce)
          .revokeAllOthersExceptSession(userId, kept.sessionId);
        accountRead.release();
        expect({
          ongoing: (await ongoing) !== null,
          keptVersion: (await harness().session(kept.sessionId))?.userVersion,
          other: await validates(harness(), other.token),
        }).toEqual({ ongoing: true, keptVersion: 1, other: false });
      } finally {
        accountRead.release();
        await ongoing.catch(() => undefined);
      }
    },
  );

  it('reads outside any unit of work that was opened before the revocation', async () => {
    const userId = await harness().issuance.seedAccount();
    const { token } = await signIn(harness(), userId);
    const seen = await harness()
      .issuance.runner(rerunAtOnce)
      .run(async (older) => {
        const grant = await harness().issuance.store.findGrant(
          older,
          userId,
          WEB_CLIENT,
        );
        const before = await validates(harness(), token);
        const revoked = await harness()
          .revoker(rerunAtOnce)
          .revokeByToken(token);
        return {
          olderUnitRead: grant?.clientId,
          before,
          revoked,
          insideTheOlderUnit: await validates(harness(), token),
        };
      });
    expect(seen).toEqual({
      olderUnitRead: WEB_CLIENT,
      before: true,
      revoked: true,
      insideTheOlderUnit: false,
    });
  });
}
