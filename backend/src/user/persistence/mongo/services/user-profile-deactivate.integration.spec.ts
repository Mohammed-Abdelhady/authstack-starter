import { MongoNetworkError } from 'mongodb';
import { failNextVersionWrite } from '../../../../../test/utils/transaction-failure';
import { Role } from '../../../../role/persistence/mongo/schemas/role.schema';
import { Types } from 'mongoose';
import { SessionService } from '../../../../auth/persistence/mongo/session.service';
import { ErrorCode } from '../../../../common/enums/error-code.enum';
import { UserRole } from '../../../enums/user-role.enum';
import { UserDocument } from '../schemas/user.schema';
import { UserProfileService } from '../../../services/user-profile.service';
import {
  bootLoggingServices,
  LoggingServices,
} from '../../../../../test/utils/logging-services';
import { RaceGate } from '../../../../../test/utils/race-gate';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_RESET_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../../../../test/utils/session-authority-harness';

const LAST_ADMIN_REFUSAL = {
  code: ErrorCode.ADMIN_CANNOT_DEACTIVATE_SELF,
  status: 403,
};

describe('account self-deletion keeps one active admin', () => {
  let fixture: LoggingServices;
  let service: UserProfileService;
  let sessions: SessionService;

  beforeAll(async () => {
    fixture = await bootLoggingServices([]);
    service = fixture.module.get(UserProfileService);
    sessions = fixture.module.get(SessionService);
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

  async function seed(
    email: string,
    role: UserRole,
  ): Promise<{ user: UserDocument; token: string }> {
    const user = await fixture.users.create({
      email,
      name: 'Account Owner',
      role,
      isVerified: true,
      sessionVersion: 0,
    });
    const issued = await sessions.createSession(user._id, 'agent', '127.0.0.1');
    return { user, token: issued.sessionToken };
  }

  async function isDeleted(id: Types.ObjectId): Promise<boolean | undefined> {
    return (await fixture.users.findById(id).exec())?.isDeleted;
  }

  async function sessionAlive(token: string): Promise<boolean> {
    return (await sessions.validateSession(token)) !== null;
  }

  function activeAdminCount(): Promise<number> {
    return fixture.users.countDocuments({
      role: UserRole.ADMIN,
      isDeleted: { $ne: true },
    });
  }

  it('deactivates a non-admin account and ends its sessions', async () => {
    const owner = await seed('owner@example.test', UserRole.USER);

    const result = await service.deactivateAccount(owner.user._id.toString());

    expect(result.success).toBe(true);
    expect(await isDeleted(owner.user._id)).toBe(true);
    expect(await sessionAlive(owner.token)).toBe(false);
    // A later reactivation must not bring the old sessions back.
    const stored = await fixture.users.findById(owner.user._id).exec();
    expect(stored?.sessionVersion).toBe(1);
  });

  it('refuses the only admin and leaves the account and session in place', async () => {
    const admin = await seed('only-admin@example.test', UserRole.ADMIN);
    await seed('manager@example.test', UserRole.MANAGER);

    await expect(
      service.deactivateAccount(admin.user._id.toString()),
    ).rejects.toMatchObject(LAST_ADMIN_REFUSAL);

    expect(await isDeleted(admin.user._id)).toBe(false);
    expect(await sessionAlive(admin.token)).toBe(true);
  });

  it('does not count a deactivated admin as a remaining one', async () => {
    const admin = await seed('active-admin@example.test', UserRole.ADMIN);
    await fixture.users.create({
      email: 'gone-admin@example.test',
      name: 'Former Admin',
      role: UserRole.ADMIN,
      isVerified: true,
      isDeleted: true,
    });

    await expect(
      service.deactivateAccount(admin.user._id.toString()),
    ).rejects.toMatchObject(LAST_ADMIN_REFUSAL);

    expect(await isDeleted(admin.user._id)).toBe(false);
  });

  it('lets one of two admins leave, then refuses the one who remains', async () => {
    const first = await seed('first-admin@example.test', UserRole.ADMIN);
    const second = await seed('second-admin@example.test', UserRole.ADMIN);

    await service.deactivateAccount(first.user._id.toString());

    expect(await isDeleted(first.user._id)).toBe(true);
    expect(await sessionAlive(first.token)).toBe(false);
    await expect(
      service.deactivateAccount(second.user._id.toString()),
    ).rejects.toMatchObject(LAST_ADMIN_REFUSAL);
    expect(await isDeleted(second.user._id)).toBe(false);
  });

  it('refuses deletion when the shared admin fence is missing', async () => {
    const first = await seed('missing-role-first@example.test', UserRole.ADMIN);
    await seed('missing-role-second@example.test', UserRole.ADMIN);
    await fixture.connection
      .model(Role.name)
      .deleteOne({ slug: UserRole.ADMIN });
    await expect(
      service.deactivateAccount(first.user._id.toString()),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
      status: 503,
    });
    expect(await activeAdminCount()).toBe(2);
    expect(await sessionAlive(first.token)).toBe(true);
  });

  it('rolls back deletion and keeps sessions when revocation fails', async () => {
    const owner = await seed('rollback-owner@example.test', UserRole.USER);
    const failure = new MongoNetworkError('revocation write unavailable');
    const restore = failNextVersionWrite(fixture.users, failure);
    try {
      await expect(
        service.deactivateAccount(owner.user._id.toString()),
      ).rejects.toBe(failure);
    } finally {
      restore();
    }
    expect(await isDeleted(owner.user._id)).toBe(false);
    expect(await sessionAlive(owner.token)).toBe(true);
    expect((await fixture.users.findById(owner.user._id))?.sessionVersion).toBe(
      0,
    );
  });

  it('leaves one admin when two delete themselves at the same time', async () => {
    const first = await seed('race-first@example.test', UserRole.ADMIN);
    const second = await seed('race-second@example.test', UserRole.ADMIN);
    // Both callers count the other admin before either one writes.
    const gate = new RaceGate();
    const count = fixture.users.collection.countDocuments.bind(
      fixture.users.collection,
    );
    jest
      .spyOn(fixture.users.collection, 'countDocuments')
      .mockImplementation(async (...args: Parameters<typeof count>) => {
        const result = await count(...args);
        await gate.hold();
        return result;
      });

    const racers = Promise.allSettled([
      service.deactivateAccount(first.user._id.toString()),
      service.deactivateAccount(second.user._id.toString()),
    ]);
    try {
      await gate.reached(2);
    } finally {
      gate.release();
    }
    const outcomes = await racers;
    jest.restoreAllMocks();

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(refused?.reason).toMatchObject(LAST_ADMIN_REFUSAL);
    expect(await activeAdminCount()).toBe(1);
    const survivor = (await isDeleted(first.user._id)) ? second : first;
    expect(await sessionAlive(survivor.token)).toBe(true);
  });
});
