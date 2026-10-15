import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { holdBefore, RaceGate } from '../utils/race-gate';
import {
  outcomeOf,
  signIn,
  validates,
} from '../utils/session/authority-contract/authority-contract-support';
import {
  StaffSessionHarness,
  staffActor,
} from './session-harness.harness-spec';

export function staffSessionAuthorizationCases(
  current: () => StaffSessionHarness,
): void {
  const gates: RaceGate[] = [];
  const restores: Array<() => void> = [];
  afterEach(() => {
    for (const gate of gates.splice(0)) gate.release();
    for (const restore of restores.splice(0)) restore();
  });

  it.each([
    {
      name: 'permission revoked',
      actorPatch: { permissions: [] },
      targetPatch: {},
      code: ErrorCode.FORBIDDEN,
    },
    {
      name: 'actor demoted',
      actorPatch: { role: 'user' },
      targetPatch: {},
      code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    },
    {
      name: 'actor deactivated',
      actorPatch: { deleted: true },
      targetPatch: {},
      code: ErrorCode.SESSION_INVALID,
    },
    {
      name: 'target promoted',
      actorPatch: {},
      targetPatch: { role: 'admin' },
      code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    },
    {
      name: 'target deleted',
      actorPatch: {},
      targetPatch: { deleted: true },
      code: ErrorCode.USER_NOT_FOUND,
    },
  ])(
    'refuses a request admitted before $name',
    async ({ actorPatch, targetPatch, code }) => {
      const harness = current();
      const actorId = await staffActor(harness);
      const targetId = await harness.authority.issuance.seedAccount();
      const session = await signIn(harness.authority, targetId);
      const admitted = new RaceGate();
      gates.push(admitted);
      restores.push(holdBefore(harness.access, 'authorizeIn', () => admitted));
      const ending = outcomeOf(
        harness.service().revokeOne(targetId, session.sessionId, actorId),
      );
      await admitted.reached();
      await harness.patchAccount(actorId, actorPatch);
      await harness.patchAccount(targetId, targetPatch);
      admitted.release();
      expect(await ending).toBe(code);
      expect(
        (await harness.authority.session(session.sessionId))?.isValid,
      ).toBe(true);
      expect(
        (await harness.authority.events()).filter(
          ({ action }) => action === 'session_revoked',
        ),
      ).toEqual([]);
    },
  );

  it('refuses wildcard peers and case-insensitive self targeting without opening the administrator exception', async () => {
    const harness = current();
    const actorId = await staffActor(harness);
    const targetId = await staffActor(harness);
    expect(await outcomeOf(harness.service().list(targetId, actorId))).toBe(
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    );
    expect(
      await outcomeOf(harness.service().revokeAll(targetId, actorId)),
    ).toBe(ErrorCode.CANNOT_MODIFY_HIGHER_ROLE);
    expect(
      await outcomeOf(harness.service().list(actorId.toUpperCase(), actorId)),
    ).toBe(ErrorCode.CANNOT_MODIFY_SELF);
    expect(
      await outcomeOf(
        harness.service().revokeAll(actorId.toUpperCase(), actorId),
      ),
    ).toBe(ErrorCode.CANNOT_MODIFY_SELF);
  });

  it('hides a conservatively classified staff target until the staff read and delete scopes are held', async () => {
    const harness = current();
    const actorId = await staffActor(harness, [
      'sessions:read:all',
      'sessions:delete:all',
    ]);
    const targetId = await harness.authority.issuance.seedAccount();
    await harness.patchAccount(targetId, { role: 'support' });
    const session = await signIn(harness.authority, targetId);
    expect(await outcomeOf(harness.service().list(targetId, actorId))).toBe(
      ErrorCode.USER_NOT_FOUND,
    );
    expect(
      await outcomeOf(harness.service().revokeAll(targetId, actorId)),
    ).toBe(ErrorCode.USER_NOT_FOUND);
    await harness.patchAccount(actorId, {
      permissions: [
        'sessions:read:all',
        'sessions:delete:all',
        'sessions:read:staff',
      ],
    });
    const listed = await harness.service().list(targetId, actorId);
    expect({
      total: listed.data.total,
      targetClass: listed.data.targetClass,
    }).toEqual({
      total: 1,
      targetClass: 'staff',
    });
    await harness.patchAccount(actorId, {
      permissions: [
        'sessions:read:all',
        'sessions:delete:all',
        'sessions:read:staff',
        'sessions:delete:staff',
      ],
    });
    await harness.service().revokeOne(targetId, session.sessionId, actorId);
    expect(await validates(harness.authority, session.token)).toBe(false);
  });
}
