import request from 'supertest';
import { unwrapNativeMethods } from '@app/sdk';
import { NATIVE_CLIENT_ID } from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { TEST_NOW } from '../../utils/frozen-clock';
import type { E2eApp } from '../../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import { startLifecycleAttempt } from '../lifecycle/native-lifecycle.fixtures';
import { bootEmailCodeApp, setEmailCode } from './email-code.fixtures';

/**
 * The capability keys an installed app accepts: the SDK before email code
 * parsed capabilities with exactly these and refused any other key.
 */
const INSTALLED_APP_CAPABILITY_KEYS = [
  'emailLink',
  'passkeys',
  'password',
  'recovery',
  'registration',
];

describe('native methods reply for apps already installed (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootEmailCodeApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function methodsReply() {
    const response = await request(e2e.httpServer)
      .get('/api/auth/native/methods')
      .query({ clientId: NATIVE_CLIENT_ID })
      .expect(200);
    const body: unknown = response.body;
    return { status: response.status, body };
  }

  it('sends only the keys an installed app knows while email code is off, and that app still starts an attempt', async () => {
    setEmailCode(e2e, false);
    const reply = await methodsReply();

    const methods = unwrapNativeMethods(reply);
    expect(Object.keys(methods.capabilities).sort()).toEqual(
      INSTALLED_APP_CAPABILITY_KEYS,
    );
    expect(reply.body).not.toHaveProperty('data.capabilities.emailCode');
    const attempt = await startLifecycleAttempt(e2e, 'signIn');
    expect(attempt.factors).toEqual(['emailLink']);
  });

  it('adds emailCode, and only as true, once email code is on', async () => {
    setEmailCode(e2e, true);
    const methods = unwrapNativeMethods(await methodsReply());

    expect(Object.keys(methods.capabilities).sort()).toEqual([
      'emailCode',
      'emailLink',
      'passkeys',
      'password',
      'recovery',
      'registration',
    ]);
    expect(methods.capabilities.emailCode).toBe(true);
  });
});
