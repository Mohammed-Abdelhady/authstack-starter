import {
  sessionIdOf,
  signIn,
  storedFor,
  validates,
} from '../utils/session/authority-contract/authority-contract-support';
import {
  raceTools,
  REFUSED,
} from '../utils/session/authority-contract/revocation-race-support';
import {
  rejectionOf,
  rerunAtOnce,
} from '../utils/session/issuance-contract/issuance-contract-support';
import {
  StaffSessionHarness,
  staffActor,
} from './session-harness.harness-spec';

export function staffSessionBulkCases(
  current: () => StaffSessionHarness,
): void {
  const tools = raceTools(() => current().authority);

  it('retries staff revoke-all behind issuance and ends the session issued before its commit', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    const earlier = await signIn(harness.authority, targetId);
    const issuing = tools.gate();
    tools.holdSignInBeforeItsInsert(issuing);
    const signingIn = tools.startSignIn(targetId, rerunAtOnce);
    await issuing.reached();

    const reruns = tools.heldReruns();
    const revocationWritten = tools.gate();
    tools.holdRevocationEvents(revocationWritten);
    const revoking = harness.service(reruns.pause).revokeAll(targetId, actorId);
    const firstAttempt = await tools.refusedOr(
      reruns.refused,
      revocationWritten,
    );
    issuing.release();
    const issued = await signingIn;
    revocationWritten.release();
    reruns.refused.release();

    expect((await revoking).data).toEqual({ revokedCount: 2 });
    expect(firstAttempt).toBe(REFUSED);
    expect(reruns.calls).toEqual([1]);
    expect([
      await validates(harness.authority, earlier.token),
      await validates(harness.authority, issued.sessionToken),
    ]).toEqual([false, false]);
    expect(
      (await harness.authority.issuance.account(targetId))?.sessionVersion,
    ).toBe(1);
    expect(
      (await harness.authority.events()).filter(
        ({ action }) => action === 'sessions_revoked_all',
      ),
    ).toEqual([
      {
        action: 'sessions_revoked_all',
        actorId,
        targetUserId: targetId,
        clientId: null,
        sessionId: null,
        reasonCode: 'admin_forced',
      },
    ]);
  });

  it('admits issuance at the new version after staff revoke-all commits', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    const earlier = await signIn(harness.authority, targetId);
    const revocationWritten = tools.gate();
    tools.holdRevocationEvents(revocationWritten);
    const revoking = harness.service().revokeAll(targetId, actorId);
    await revocationWritten.reached();

    const reruns = tools.heldReruns();
    const issuing = tools.gate();
    tools.holdSignInBeforeItsInsert(issuing);
    const signingIn = tools.startSignIn(targetId, reruns.pause);
    const firstAttempt = await tools.refusedOr(reruns.refused, issuing);
    revocationWritten.release();
    expect((await revoking).data).toEqual({ revokedCount: 1 });
    issuing.release();
    reruns.refused.release();
    const issued = await signingIn;

    expect(firstAttempt).toBe(REFUSED);
    expect(reruns.calls).toEqual([1]);
    expect([
      await validates(harness.authority, earlier.token),
      await validates(harness.authority, issued.sessionToken),
    ]).toEqual([false, true]);
    const issuedId = await sessionIdOf(
      harness.authority,
      targetId,
      issued.sessionToken,
    );
    expect((await harness.authority.session(issuedId))?.userVersion).toBe(1);
  });

  it('rolls back the staff revoke-all version and sessions when its event is refused', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    const first = await signIn(harness.authority, targetId);
    const second = await signIn(harness.authority, targetId);
    const allowEvents = await harness.authority.issuance.refuseSecurityEvents();
    tools.restoreLater(allowEvents);
    const failure = await rejectionOf(
      harness.service().revokeAll(targetId, actorId),
    );
    allowEvents();

    expect(failure).toBeInstanceOf(Error);
    expect(['23505', 11000]).toContain(
      failure instanceof Error ? Reflect.get(failure, 'code') : null,
    );
    expect(
      await storedFor(harness.authority, targetId, [
        first.sessionId,
        second.sessionId,
      ]),
    ).toEqual({
      accountVersion: 0,
      sessions: [
        { live: true, userVersion: 0 },
        { live: true, userVersion: 0 },
      ],
      events: ['session_issued', 'session_issued'],
    });
    expect([
      await validates(harness.authority, first.token),
      await validates(harness.authority, second.token),
    ]).toEqual([true, true]);
    expect((await harness.service().revokeAll(targetId, actorId)).data).toEqual(
      { revokedCount: 2 },
    );
  });
}
