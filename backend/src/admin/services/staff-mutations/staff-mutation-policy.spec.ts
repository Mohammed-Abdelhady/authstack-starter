import { ConfigService } from '@nestjs/config';
import { FreshProofGate } from '../../../auth/proof/fresh-proof-gate';
import type { ActingSession } from '../../../auth/proof/types/acting-session';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { StaffMutationPolicy } from './staff-mutation-policy';

const SESSION: ActingSession = {
  sessionId: 'session-1',
  userId: 'actor-1',
  clientId: 'admin',
  signedInAt: new Date('2099-01-01T12:00:00.000Z'),
};
class TestWork extends UnitOfWork {}
const WORK = new TestWork();

class CountingGate extends FreshProofGate {
  readonly requirements: string[] = [];

  assertFresh(
    _unitOfWork: UnitOfWork,
    _session: ActingSession,
    requirement: string,
  ): Promise<void> {
    this.requirements.push(requirement);
    return Promise.resolve();
  }
}

function refusalOf(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

function policy(strict: boolean): {
  policy: StaffMutationPolicy;
  gate: CountingGate;
} {
  const gate = new CountingGate();
  return {
    policy: new StaffMutationPolicy(
      new ConfigService({ admin: { strictMutations: strict } }),
      gate,
    ),
    gate,
  };
}

describe('StaffMutationPolicy', () => {
  // Failure (R6): turning the setting off still asks existing clients for a proof, a version or a key.
  it('asks nothing of a request without proof, version or key when strict mode is off', async () => {
    const { policy: off, gate } = policy(false);

    await off.assertRouteProof(WORK, SESSION);
    off.assertVersion(undefined, 7);
    off.assertKey(undefined);

    expect(gate.requirements).toEqual([]);
  });

  // Failure (R1): strict mode lets a guarded route through with no proof at all.
  it('asks for an act or a recent sign-in on a guarded route in strict mode', async () => {
    const { policy: strict, gate } = policy(true);

    await strict.assertRouteProof(WORK, SESSION);

    expect(gate.requirements).toEqual(['act-or-age']);
  });

  // Failure (A8): an action on an administrator accepts the age of the session.
  it('asks for an act on an administrator whatever the mode', async () => {
    const { policy: off, gate } = policy(false);

    await off.assertAct(WORK, SESSION);

    expect(gate.requirements).toEqual(['act']);
  });

  // Failure: a caller with no session passes a check that needs its proof.
  it('refuses an act from a caller with no session', async () => {
    const { policy: off } = policy(false);

    await expect(off.assertAct(WORK, undefined)).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
      status: 401,
    });
  });

  // Failure (R4): a stale version overwrites a change made since the form was read.
  it.each([false, true])(
    'refuses a stale version with a conflict, strict mode %s',
    (strict) => {
      expect(
        refusalOf(() => policy(strict).policy.assertVersion(3, 4)),
      ).toMatchObject({ code: 'CONFLICT', status: 409 });
    },
  );

  it('accepts the current version, and reads a missing stored one as 0', () => {
    const { policy: strict } = policy(true);

    expect(() => strict.assertVersion(4, 4)).not.toThrow();
    expect(() => strict.assertVersion(0, undefined)).not.toThrow();
  });

  // Failure: strict mode serves a mutation that names no version or a create with no key.
  it('refuses a missing version and a missing key in strict mode', () => {
    const { policy: strict } = policy(true);

    expect(refusalOf(() => strict.assertVersion(undefined, 4))).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(refusalOf(() => strict.assertKey(undefined))).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  });
});
