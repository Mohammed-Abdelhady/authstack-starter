import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';
import { unwrapFreshProofBody, unwrapProofCodeResultBody } from '../proof/parsers';
// feature:passkeys:start
import { unwrapBrowserPasskeyProofOptionsBody } from '../proof/parsers';
// feature:passkeys:end

const PROVED = { provedAt: '2026-10-17T00:00:00.000Z' };

describe('signed-in browser proof raw contract', () => {
  it('reads raw send/verify output and keeps the code in the signed-in ceremony', async () => {
    const send = answering(200, { expiresInMinutes: 5 });
    expect(await createApiClient(send).proof.sendCode()).toEqual({ expiresInMinutes: 5 });
    expect(send.sent).toEqual([{ method: 'POST', path: '/api/auth/proof/code' }]);
    const verify = answering(200, PROVED);
    expect(await createApiClient(verify).proof.verifyCode({ code: '123456' })).toEqual(PROVED);
    expect(verify.sent).toEqual([
      { method: 'POST', path: '/api/auth/proof/code/verify', body: { code: '123456' } },
    ]);
  });

  it('refuses malformed success and preserves expired or wrong proof errors', async () => {
    for (const expiresInMinutes of [undefined, null, 0, -1, 1.5, '5']) {
      expect(() => unwrapProofCodeResultBody({ expiresInMinutes })).toThrow();
    }
    for (const body of [null, {}, { provedAt: 'not-a-date' }, { success: true, data: PROVED }]) {
      expect(() => unwrapFreshProofBody(body)).toThrow();
    }
    await expect(
      createApiClient(
        answering(401, {
          success: false,
          error: { code: 'ACTIVATION_CODE_INVALID', message: 'refused' },
        }),
      ).proof.verifyCode({ code: '000000' }),
    ).rejects.toMatchObject({ status: 401, code: 'ACTIVATION_CODE_INVALID' });
  });

  // feature:passkeys:start
  it('passes RP and required UV options to the browser and refuses downgraded ceremonies', async () => {
    const options = {
      challenge: 'challenge',
      rpId: 'auth.example.com',
      userVerification: 'required',
      allowCredentials: [{ id: 'key-1', type: 'public-key', transports: ['internal', 'hybrid'] }],
    };
    const transport = answering(200, options);
    expect(await createApiClient(transport).proof.passkeyOptions()).toEqual(options);
    expect(transport.sent).toEqual([{ method: 'POST', path: '/api/auth/proof/options' }]);
    expect(() => unwrapBrowserPasskeyProofOptionsBody({ ...options, rpId: undefined })).toThrow();
    expect(() =>
      unwrapBrowserPasskeyProofOptionsBody({ ...options, userVerification: 'preferred' }),
    ).toThrow();
    expect(() =>
      unwrapBrowserPasskeyProofOptionsBody({
        ...options,
        allowCredentials: [{ id: 'key-1', type: 'public-key', transports: ['invented'] }],
      }),
    ).toThrow();
  });
  // feature:passkeys:end
});
