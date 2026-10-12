import { Logger } from '@nestjs/common';
import { SeedService } from './seed.service';
import {
  bootLoggingServices,
  LoggingServices,
  captureLogs,
  loggedCalls,
  createLoggingUser,
} from '../../../test/utils/logging-services';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../test/utils/session-authority-harness';

describe('SeedService logging with real repositories', () => {
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

  it('logs created seed users by role and their ids, never the address', async () => {
    const log = captureLogs();
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const created = await fixture.module.get(SeedService).seedUsers();
    expect(created).toBe(4);
    expect(loggedCalls(log, error)).toContain('role:');
    const users = await fixture.users.find({}).exec();
    expect(users).toHaveLength(4);
    for (const user of users)
      expect(loggedCalls(log, error)).toContain(
        `userId=${user._id.toString()}`,
      );
    expect(loggedCalls(log, error)).not.toContain('@seed.local');
  });
  it('logs existing seed users by their ids, never the address', async () => {
    const seeds = fixture.module.get(SeedService);
    await seeds.seedUsers();
    const users = await fixture.users.find({}).exec();
    expect(users).toHaveLength(4);
    const log = captureLogs();
    const created = await seeds.seedUsers();
    expect(created).toBe(0);
    for (const user of users)
      expect(loggedCalls(log)).toContain(`userId=${user._id.toString()}`);
    expect(loggedCalls(log)).not.toContain('@seed.local');
  });
  it('logs a failed seed user by error name and code, never the address', async () => {
    await createLoggingUser(fixture);
    await fixture.users.collection.createIndex(
      { isVerified: 1 },
      { unique: true },
    );
    try {
      const log = captureLogs();
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const created = await fixture.module.get(SeedService).seedUsers();
      expect(created).toBe(0);
      expect(error).toHaveBeenCalled();
      expect(loggedCalls(log, error)).toContain('MongoServerError code=11000');
      expect(loggedCalls(log, error)).not.toContain('@seed.local');
      expect(loggedCalls(log, error)).not.toContain('dup key');
    } finally {
      await fixture.users.collection.dropIndex('isVerified_1');
    }
  });
});
