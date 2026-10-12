import { AppException } from '../../../common/exceptions/app.exception';
import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import { RoleHierarchyService } from '../../../role/services/role-hierarchy.service';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { AdminUserAccessService } from './admin-user-access.service';

const SELF = { code: 'CANNOT_MODIFY_SELF', status: 400 };

/** How the self check answered: let through, or the refusal it raised. */
function selfCheckOf(targetId: string, actorId: string): unknown {
  const access = new AdminUserAccessService(
    partialMock<AdminAccountStore>({}),
    partialMock<RoleHierarchyService>({}),
  );
  try {
    access.assertNotSelf(targetId, actorId, 'Cannot change your own account');
  } catch (error) {
    if (error instanceof AppException) {
      return { code: error.code, status: error.getStatus() };
    }
    throw error;
  }
  return 'another account';
}

describe('AdminUserAccessService.assertNotSelf', () => {
  it.each([
    // feature:postgres:start
    [
      'a UUID in upper case',
      '0198F3A2-7C1E-7B4D-9A6F-2E5D8C1B4A70',
      '0198f3a2-7c1e-7b4d-9a6f-2e5d8c1b4a70',
    ],
    [
      'a UUID in mixed case',
      '0198f3A2-7c1E-7b4d-9A6f-2e5D8c1b4A70',
      '0198f3a2-7c1e-7b4d-9a6f-2e5d8c1b4a70',
    ],
    // feature:postgres:end
    // feature:mongodb:start
    [
      'an ObjectId in upper case',
      '65F0A1B2C3D4E5F6A7B8C9D0',
      '65f0a1b2c3d4e5f6a7b8c9d0',
    ],
    [
      'an ObjectId in mixed case',
      '65f0A1b2C3d4E5f6a7B8c9D0',
      '65f0a1b2c3d4e5f6a7b8c9d0',
    ],
    // feature:mongodb:end
    [
      'the id exactly as the session holds it',
      '65f0a1b2c3d4e5f6a7b8c9d0',
      '65f0a1b2c3d4e5f6a7b8c9d0',
    ],
  ])('refuses the actor own account named by %s', (_, routeId, actorId) => {
    expect(selfCheckOf(routeId, actorId)).toEqual(SELF);
  });

  it.each([
    // feature:postgres:start
    [
      'a UUID',
      '0198F3A2-7C1E-7B4D-9A6F-2E5D8C1B4A71',
      '0198f3a2-7c1e-7b4d-9a6f-2e5d8c1b4a70',
    ],
    // feature:postgres:end
    ['an ObjectId', '65F0A1B2C3D4E5F6A7B8C9D1', '65f0a1b2c3d4e5f6a7b8c9d0'], // feature:mongodb
  ])(
    'lets through another account when %s differs in one digit',
    (_, routeId, actorId) => {
      expect(selfCheckOf(routeId, actorId)).toBe('another account');
    },
  );
});
