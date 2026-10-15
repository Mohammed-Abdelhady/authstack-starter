import { ValidationFailedException } from '../../src/common/exceptions/validation-failed.exception';
import {
  activityDetails,
  eventActivityFields,
} from '../../src/session/events/utils/activity-details';
import { ACTIVITY_PERSONAL_FIELDS } from '../../src/session/events/constants/activity-details';
import { activityQuery } from '../../src/session/events/utils/activity-query';

const ALLOWED_DETAILS = [
  [
    'account_created',
    { name: 'Ada', email: 'ada@example.test', roleId: 'role-1' },
  ],
  [
    'account_updated',
    {
      name: 'Ada',
      email: 'ada@example.test',
      changedFields: ['name', 'email'],
    },
  ],
  ['account_status_changed', { isDeleted: true }],
  ['account_deleted', {}],
  ['permission_granted', { permission: '*' }],
  ['permission_revoked', { permission: 'users:read:all' }],
  ['role_created', { roleId: 'role-1', slug: 'support' }],
  [
    'role_updated',
    { roleId: 'role-1', slug: 'support', permissions: ['*', 'users:read:all'] },
  ],
  ['role_deleted', { roleId: 'role-1', slug: 'support' }],
  ['session_revoked', {}],
  [
    'sessions_revoked_all',
    { assignedRoleId: 'role-2', previousRoleId: 'role-1' },
  ],
  ['passkeys_reset', {}],
  ['admin_recovery_started', { email: 'ada@example.test' }],
  // feature:invitations:start
  [
    'invitation_created',
    { name: 'Ada', email: 'ada@example.test', roleId: 'role-1' },
  ],
  ['invitation_resent', { email: 'ada@example.test' }],
  ['invitation_revoked', {}],
  ['invitation_accepted', {}],
  // feature:invitations:end
] as const;

describe('activity evidence validation', () => {
  it.each(ALLOWED_DETAILS)(
    'accepts the hand-written details contract for %s',
    (action, details) => {
      expect(activityDetails(action, details)).toEqual(details);
    },
  );

  it('accepts only the action fields and shapes, and copies arrays', () => {
    const fields = ['name'];
    const stored = activityDetails('account_updated', {
      name: 'Ada',
      changedFields: fields,
    });
    fields.push('email');
    expect(stored).toEqual({ name: 'Ada', changedFields: ['name'] });
    expect(activityDetails('permission_granted', { permission: '*' })).toEqual({
      permission: '*',
    });
    expect(() => activityDetails('unknown', {})).toThrow(TypeError);
    expect(() =>
      activityDetails('account_updated', { name: { email: 'secret' } }),
    ).toThrow(TypeError);
    expect(() =>
      activityDetails('account_updated', { changedFields: ['password'] }),
    ).toThrow(TypeError);
    expect(() =>
      activityDetails('account_updated', { name: 'x'.repeat(321) }),
    ).toThrow(TypeError);
    expect(() =>
      activityDetails('account_status_changed', { isDeleted: 'true' }),
    ).toThrow(TypeError);
    expect(() =>
      activityDetails('permission_granted', { permission: 'wrong permission' }),
    ).toThrow(TypeError);
    expect(() =>
      activityDetails('role_updated', { permissions: [42] }),
    ).toThrow(TypeError);
  });

  it('copies validated array elements without invoking caller-owned methods or accessors', () => {
    const permissions = ['users:read:all'];
    Object.defineProperty(permissions, 'map', {
      value: () => ({ passwordHash: 'sensitive-sentinel' }),
    });
    expect(activityDetails('role_updated', { permissions })).toEqual({
      permissions: ['users:read:all'],
    });
    const accessor = ['users:read:all'];
    Object.defineProperty(accessor, '0', {
      get: () => {
        throw new Error('must not run');
      },
    });
    expect(() =>
      activityDetails('role_updated', { permissions: accessor }),
    ).toThrow(TypeError);
  });

  it('refuses sensitive fields for every action and limits personal fields to named actions', () => {
    for (const [action] of ALLOWED_DETAILS) {
      for (const key of [
        'password',
        'passwordHash',
        'token',
        'code',
        'cookie',
        'headers',
        'mailBody',
        'account',
        'request',
      ]) {
        expect(() =>
          activityDetails(action, { [key]: 'sensitive-sentinel' }),
        ).toThrow(TypeError);
      }
    }
    expect(ACTIVITY_PERSONAL_FIELDS).toEqual({
      account_created: ['name', 'email'],
      account_updated: ['name', 'email'],
      admin_recovery_started: ['email'],
      // feature:invitations:start
      invitation_created: ['name', 'email'],
      invitation_resent: ['email'],
      // feature:invitations:end
    });
    expect(() =>
      activityDetails('session_revoked', { email: 'private@example.test' }),
    ).toThrow(TypeError);
    expect(() => activityDetails('role_updated', { name: 'Private' })).toThrow(
      TypeError,
    );
  });

  it('refuses null, arrays, accessors and inherited details', () => {
    expect(() => activityDetails('account_created', null)).toThrow(TypeError);
    expect(() => activityDetails('account_created', [])).toThrow(TypeError);
    expect(() =>
      activityDetails('account_created', Object.create({ email: 'secret' })),
    ).toThrow(TypeError);
    expect(() =>
      activityDetails('account_created', {
        get name() {
          throw new Error('must not run');
        },
      }),
    ).toThrow(TypeError);
  });

  it('derives kind from action and actor despite a caller-supplied classification', () => {
    const callerInput = {
      action: 'sessions_revoked_all',
      actorId: 'staff',
      kind: 'sign_in',
    };
    expect(eventActivityFields(callerInput)).toEqual({
      kind: 'staff',
      details: {},
    });
    expect(eventActivityFields({ action: 'sessions_revoked_all' })).toEqual({
      kind: 'sign_in',
      details: {},
    });
    expect(eventActivityFields({ action: 'legacy.sign_in' })).toEqual({
      kind: 'sign_in',
      details: {},
    });
    expect(
      eventActivityFields({ action: 'unknown', actorId: 'staff' }),
    ).toEqual({ kind: 'sign_in', details: {} });
  });
});

describe('activity query validation', () => {
  it('allows offset 10,000 and refuses the first deeper offset', () => {
    expect(activityQuery({ page: 101, limit: 100 })).toMatchObject({
      page: 101,
      limit: 100,
    });
    expect(activityQuery({ page: 10_001, limit: 1 })).toMatchObject({
      page: 10_001,
      limit: 1,
    });
    for (const query of [
      { page: 102, limit: 100 },
      { page: 10_002, limit: 1 },
    ]) {
      expect(() => activityQuery(query)).toThrow(ValidationFailedException);
    }
  });

  it.each([
    0,
    -1,
    1.5,
    1_000_001,
    Number.MAX_SAFE_INTEGER,
    '1e2',
    [],
    {},
    null,
  ])('refuses unsafe page %p', (page) => {
    expect(() => activityQuery({ page })).toThrow(ValidationFailedException);
  });

  it.each([0, -1, 1.5, 101, [], {}, null])(
    'refuses unsafe limit %p',
    (limit) => {
      expect(() => activityQuery({ limit })).toThrow(ValidationFailedException);
    },
  );

  it('reports malformed queries with the established validation error contract', () => {
    let failure: unknown;
    try {
      activityQuery({ page: 0 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ValidationFailedException);
    if (!(failure instanceof ValidationFailedException))
      throw new Error('Expected validation refusal');
    expect({ code: failure.code, status: failure.getStatus() }).toEqual({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  });

  it('rejects bracket filters instead of silently returning unfiltered evidence', () => {
    expect(() => activityQuery({ 'actor[$ne]': 'staff-1' })).toThrow(
      ValidationFailedException,
    );
    expect(() => activityQuery({ target: { $ne: null } })).toThrow(
      ValidationFailedException,
    );
  });

  it('refuses malformed dates, normalized impossible dates and reversed windows', () => {
    for (const from of ['bad', '2099-02-31T00:00:00Z', [], {}]) {
      expect(() => activityQuery({ from })).toThrow(ValidationFailedException);
    }
    expect(() =>
      activityQuery({
        from: '2099-01-02T00:00:00Z',
        to: '2099-01-01T00:00:00Z',
      }),
    ).toThrow(ValidationFailedException);
    expect(() =>
      activityQuery({
        from: '2099-01-01T00:00:00Z',
        to: '2099-01-01T00:00:00Z',
      }),
    ).toThrow(ValidationFailedException);
    expect(activityQuery({ page: '1', limit: '100' })).toMatchObject({
      page: 1,
      limit: 100,
    });
  });
});
