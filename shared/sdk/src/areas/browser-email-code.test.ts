import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { unwrapAuthMethodsBody } from '../auth-methods';
import { unwrapBrowserEmailCodeResultBody } from '../email-code/parsers';
import { answering } from '../test-support';

const SUMMARY = {
  id: 'user-1',
  email: 'staff@example.test',
  name: '',
  role: 'admin',
  authProvider: 'email',
  isVerified: true,
  permissions: ['users:read:all'],
};

describe('browser email-code wire contract', () => {
  it('sends locale only on request and the code alone on verification', async () => {
    const request = answering(200, { success: true, data: { email: 'staff@example.test' } });
    expect(
      await createApiClient(request).emailCode.request({
        email: ' Staff@Example.test ',
        locale: 'en',
      }),
    ).toEqual({ email: 'staff@example.test' });
    expect(request.sent).toEqual([
      {
        method: 'POST',
        path: '/api/auth/email-code/request',
        body: { email: ' Staff@Example.test ', locale: 'en' },
      },
    ]);
    const verify = answering(200, {
      success: true,
      data: { requiresTwoFactor: false, user: SUMMARY },
    });
    expect(await createApiClient(verify).emailCode.verify({ code: '012345' })).toEqual({
      requiresTwoFactor: false,
      user: SUMMARY,
    });
    expect(verify.sent).toEqual([
      { method: 'POST', path: '/api/auth/email-code/verify', body: { code: '012345' } },
    ]);
  });

  it('keeps a second factor pending instead of inventing a signed-in profile', async () => {
    const pending = { success: true, data: { requiresTwoFactor: true, user: null } };
    expect(
      await createApiClient(answering(200, pending)).emailCode.verify({ code: '012345' }),
    ).toEqual({ requiresTwoFactor: true, user: null });
    for (const data of [
      { requiresTwoFactor: true, user: SUMMARY },
      { requiresTwoFactor: false, user: null },
      { requiresTwoFactor: 'false', user: SUMMARY },
      { requiresTwoFactor: false, user: { ...SUMMARY, permissions: [null] } },
      { requiresTwoFactor: false, user: { ...SUMMARY, isVerified: null } },
    ])
      expect(() => unwrapBrowserEmailCodeResultBody({ success: true, data })).toThrow();
  });

  it('preserves refusal and sends nothing after an already-aborted call', async () => {
    const refused = answering(400, {
      success: false,
      error: { code: 'EMAIL_CODE_INVALID', message: 'refused' },
    });
    await expect(
      createApiClient(refused).emailCode.verify({ code: '000000' }),
    ).rejects.toMatchObject({ status: 400, code: 'EMAIL_CODE_INVALID' });
    const transport = answering(200, {});
    await expect(
      createApiClient(transport).emailCode.request(
        { email: 'staff@example.test' },
        { signal: { aborted: true } },
      ),
    ).rejects.toMatchObject({ reason: 'aborted' });
    expect(transport.sent).toEqual([]);
  });

  it('normalizes an omitted feature to off and rejects malformed discovery', () => {
    expect(
      unwrapAuthMethodsBody({
        success: true,
        data: { methods: { password: false, emailCode: true } },
      }).emailCode,
    ).toBe(true);
    expect(
      unwrapAuthMethodsBody({ success: true, data: { methods: { password: true } } }).emailCode,
    ).toBe(false);
    for (const emailCode of [null, 'true', 1])
      expect(() =>
        unwrapAuthMethodsBody({ success: true, data: { methods: { password: false, emailCode } } }),
      ).toThrow();
  });
});
