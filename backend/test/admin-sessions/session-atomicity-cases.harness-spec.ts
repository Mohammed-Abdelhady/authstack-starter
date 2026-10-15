import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { holdBefore, RaceGate } from '../utils/race-gate';
import {
  failAfter,
  outcomeOf,
  signIn,
  validates,
} from '../utils/session/authority-contract/authority-contract-support';
import { holdReruns } from '../utils/session/issuance-contract/issuance-contract-support';
import {
  StaffSessionHarness,
  staffActor,
} from './session-harness.harness-spec';

export function staffSessionAtomicityCases(
  current: () => StaffSessionHarness,
): void {
  const gates: RaceGate[] = [];
  const restores: Array<() => void> = [];
  afterEach(() => {
    for (const gate of gates.splice(0)) gate.release();
    for (const restore of restores.splice(0)) restore();
  });

  it('ends a session once when two staff requests race and returns SESSION_NOT_FOUND to the loser', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await harness.authority.issuance.seedAccount();
    const selected = await signIn(harness.authority, targetId);
    const written = new RaceGate();
    gates.push(written);
    restores.push(
      holdBefore(
        harness.authority.revocationStore,
        'appendSecurityEvent',
        (call) => (call === 0 ? written : undefined),
      ),
    );
    const first = harness
      .service()
      .revokeOne(targetId, selected.sessionId, actorId);
    await written.reached();
    const reruns = holdReruns();
    gates.push(reruns.refused);
    const second = outcomeOf(
      harness
        .service(reruns.pause)
        .revokeOne(targetId, selected.sessionId, actorId),
    );
    await reruns.refused.reached();
    written.release();
    expect((await first).data).toEqual({ revoked: true });
    reruns.refused.release();
    expect(await second).toBe(ErrorCode.SESSION_NOT_FOUND);
    expect(await validates(harness.authority, selected.token)).toBe(false);
    expect(
      (await harness.authority.events()).filter(
        ({ action }) => action === 'session_revoked',
      ),
    ).toHaveLength(1);
  });

  it.each(['refused event', 'aborted after append'])(
    'rolls back the staff end and event on %s',
    async (failure) => {
      const harness = current();
      const actorId = await staffActor(harness);
      const targetId = await harness.authority.issuance.seedAccount();
      const selected = await signIn(harness.authority, targetId);
      const restore =
        failure === 'refused event'
          ? await harness.authority.issuance.refuseSecurityEvents()
          : failAfter(
              harness.authority.revocationStore,
              'appendSecurityEvent',
              new Error('abort after staff event'),
            );
      restores.push(restore);
      let failureRaised: unknown;
      try {
        await harness
          .service()
          .revokeOne(targetId, selected.sessionId, actorId);
      } catch (error) {
        failureRaised = error;
      }
      expect(failureRaised).toBeInstanceOf(Error);
      restore();
      expect(await validates(harness.authority, selected.token)).toBe(true);
      expect(
        (await harness.authority.session(selected.sessionId))?.revokedAt,
      ).toBeNull();
      expect(
        (await harness.authority.events()).filter(
          ({ action }) => action === 'session_revoked',
        ),
      ).toEqual([]);
    },
  );

  it.each([true, false])(
    'reports an unknown staff-write outcome without replay when commit landed %s',
    async (lands) => {
      const harness = current();
      const actorId = await staffActor(harness);
      const targetId = await harness.authority.issuance.seedAccount();
      const selected = await signIn(harness.authority, targetId);
      const lost = harness.authority.issuance.loseCommitAnswers({ lands });
      restores.push(lost.restore);
      let writes = 0;
      restores.push(
        holdBefore(harness.authority.revocationStore, 'revokeSession', () => {
          writes += 1;
          return undefined;
        }),
      );
      expect(
        await outcomeOf(
          harness.service().revokeOne(targetId, selected.sessionId, actorId),
        ),
      ).toBe(ErrorCode.TRANSACTION_OUTCOME_UNKNOWN);
      lost.restore();
      expect(writes).toBe(1);
      expect(await validates(harness.authority, selected.token)).toBe(!lands);
      expect(
        (await harness.authority.events()).filter(
          ({ action }) => action === 'session_revoked',
        ),
      ).toHaveLength(lands ? 1 : 0);
    },
  );
}
