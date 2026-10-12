import { Types } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { CREDENTIAL_PURPOSE } from '../../constants/credential-purpose';
import { hashToken } from '../../utils/hashing/token-hash';
import { NativeSessionRevocationService } from '../../services/native-session-revocation.service';
import { startMemoryReplSet } from '../../../../test/utils/memory-replset';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  bootSessionAuthority,
  createTestUser,
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
  SessionAuthorityHarness,
} from '../../../../test/utils/session-authority-harness';

describe('revocation across users (plan S1)', () => {
  let mongo: Awaited<ReturnType<typeof startMemoryReplSet>>;
  let harness: SessionAuthorityHarness;

  beforeAll(async () => {
    mongo = await startMemoryReplSet();
    harness = await bootSessionAuthority(
      mongo.uri('session_revocation_access'),
      new FrozenClock(TEST_NOW),
    );
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (harness) {
      await harness.app.close();
    }
    if (mongo) {
      await mongo.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    harness.clock.set(TEST_NOW);
    await harness.sessions.deleteMany({});
    await harness.grants.deleteMany({});
    await harness.users.deleteMany({});
  });

  async function login(email: string): Promise<{
    userId: Types.ObjectId;
    token: string;
  }> {
    const user = await createTestUser(harness.users, email);
    try {
      const issued = await harness.sessionService.createSession(
        user._id,
        'Mozilla/5.0',
        '127.0.0.1',
      );
      return { userId: user._id, token: issued.sessionToken };
    } catch (error) {
      if (error instanceof AppException) {
        throw new Error(
          `${error.message} ${JSON.stringify(error.getDetails() ?? {})}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  async function sessionIdFor(token: string): Promise<string> {
    const session = await harness.sessions.findOne({
      tokenHash: hashToken(token),
    });
    if (!session) {
      throw new Error('expected session');
    }
    return session._id.toString();
  }

  it('refuses to revoke another user session by id', async () => {
    const attacker = await login('attacker-by-id@example.test');
    const victim = await login('victim-by-id@example.test');

    expect(
      await harness.sessionService.invalidateSessionById(
        await sessionIdFor(victim.token),
        attacker.userId,
      ),
    ).toBe(false);
    expect(
      await harness.sessionService.validateSession(victim.token),
    ).not.toBeNull();
  });

  it('refuses to revoke another user native session', async () => {
    const attacker = await login('attacker-native@example.test');
    const victim = await login('victim-native@example.test');
    const source = await harness.sessions.findOne({
      tokenHash: hashToken(victim.token),
    });
    if (!source) {
      throw new Error('expected session');
    }
    const native = await harness.sessions.create({
      ...source.toObject(),
      _id: new Types.ObjectId(),
      tokenHash: 'native-foreign-fixture',
      clientId: 'native-app',
      credentialPurpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
    });
    const revocation = harness.app.get(NativeSessionRevocationService);

    expect(
      await revocation.revokeNativeSession(
        native._id.toString(),
        attacker.userId,
      ),
    ).toBe(false);
    expect((await harness.sessions.findById(native._id))?.isValid).toBe(true);
  });

  it('refuses to keep another user session in all-other logout', async () => {
    const attacker = await login('attacker-others@example.test');
    const victim = await login('victim-others@example.test');

    await expect(
      harness.sessionService.invalidateAllSessionsExceptSession(
        attacker.userId,
        await sessionIdFor(victim.token),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.SESSION_INVALID });
    expect(
      await harness.sessionService.validateSession(victim.token),
    ).not.toBeNull();
  });
});
