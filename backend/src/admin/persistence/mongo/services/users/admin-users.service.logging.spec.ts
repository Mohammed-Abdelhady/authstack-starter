import { Types } from 'mongoose';
import { AdminUserCreateService } from '../../../../services/users/admin-user-create.service';
import { UserRole } from '../../../../../user/enums/user-role.enum';
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  LOGGING_USER_ID,
} from '../../../../../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../../test/utils/session-authority-harness';

describe('AdminUsersService logging with real repositories', () => {
  let fixture: LoggingServices;
  beforeAll(async () => {
    fixture = await bootLoggingServices([]);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    await fixture.reset();
  }, SESSION_AUTHORITY_RESET_TIMEOUT_MS);
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await fixture?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('logs a created user with the user id, never the address', async () => {
    const actor = await fixture.users.create({
      name: 'Admin',
      email: 'admin@example.test',
      role: UserRole.ADMIN,
      isVerified: true,
    });
    jest
      .spyOn(Types.ObjectId, 'generate')
      .mockReturnValue(Buffer.from(LOGGING_USER_ID, 'hex'));
    const log = captureLogs();
    await fixture.module.get(AdminUserCreateService).createUser(
      {
        name: 'New User',
        email: 'new@example.com',
        password: 'Password123!',
        role: UserRole.USER,
      },
      UserRole.ADMIN,
      actor._id.toString(),
    );
    expect(loggedCalls(log)).toContain('userId=507f1f77bcf86cd799439011');
    expect(loggedCalls(log)).not.toContain('new@example.com');
  });
});
