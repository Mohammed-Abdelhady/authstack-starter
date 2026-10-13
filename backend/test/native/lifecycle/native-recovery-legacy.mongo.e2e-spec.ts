import * as bcrypt from 'bcrypt';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  UserDocument,
} from '../../../src/user/persistence/mongo/schemas/user.schema';
import { CREDENTIAL_PURPOSE } from '../../../src/session/constants/credential-purpose';
import { issuedSession } from '../../utils/e2e-sign-in';
import { TEST_NOW } from '../../utils/frozen-clock';
import type { E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import {
  bootNativeLifecycleApp,
  parseLifecycleResult,
  postLifecycle,
  startLifecycleAttempt,
} from './native-lifecycle.fixtures';

const OLD_PASSWORD = 'LegacyPassword123!';
const NEW_PASSWORD = 'NativeLegacyReset123!';

type LegacyVersion = 'missing' | 'null';

describe('native recovery on legacy Mongo account versions', () => {
  let e2e: E2eApp;
  let users: Model<UserDocument>;

  beforeAll(async () => {
    e2e = await bootNativeLifecycleApp();
    users = e2e.app.get<Model<UserDocument>>(getModelToken(User.name));
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function setLegacyVersion(email: string, version: LegacyVersion) {
    const account = await users.findOne({ email }).exec();
    if (!account) throw new Error('legacy recovery account is missing');
    const update =
      version === 'missing'
        ? { $unset: { sessionVersion: '' } }
        : { $set: { sessionVersion: null } };
    await users.collection.updateOne({ _id: account._id }, update);
  }

  it.each(['missing', 'null'] as const)(
    'resets password and invalidates sessions when sessionVersion is %s',
    async (version) => {
      const email = `native-legacy-${version}@example.test`;
      await e2e.state.accounts.createAccount({
        email,
        name: 'Legacy Reset User',
        isVerified: true,
        password: await bcrypt.hash(OLD_PASSWORD, 4),
      });
      await setLegacyVersion(email, version);
      const browser = await issuedSession(e2e.httpServer, { email });
      await browser.get('/api/user/profile').expect(200);
      const sessionId = await e2e.state.sessions.sessionIdWithPurpose(
        CREDENTIAL_PURPOSE.BROWSER_SESSION,
      );
      if (!sessionId) throw new Error('legacy browser session is missing');
      expect(await e2e.state.sessions.session(sessionId)).toMatchObject({
        isValid: true,
      });

      const attempt = await startLifecycleAttempt(e2e, 'recovery');
      const requested = await postLifecycle(e2e, attempt, 'recovery/request', {
        email,
      }).expect(200);
      expect(parseLifecycleResult(requested).stage).toBe(
        'recoveryCodeRequired',
      );
      const code = await e2e.mailedCode();
      const reset = await postLifecycle(e2e, attempt, 'recovery/confirm', {
        email,
        code,
        newPassword: NEW_PASSWORD,
      }).expect(200);
      expect(parseLifecycleResult(reset)).toMatchObject({
        stage: 'recoveryComplete',
        passwordUpdated: true,
      });
      await browser.get('/api/user/profile').expect(401);

      const updated = await users.findOne({ email }).select('+password').exec();
      if (!updated?.password)
        throw new Error('updated password hash is missing');
      expect(updated.sessionVersion).toBe(1);
      expect(await bcrypt.compare(NEW_PASSWORD, updated.password)).toBe(true);
      expect(await bcrypt.compare(OLD_PASSWORD, updated.password)).toBe(false);
    },
  );
});
