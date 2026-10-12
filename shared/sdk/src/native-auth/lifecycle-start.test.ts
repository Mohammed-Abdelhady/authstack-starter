import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';

const EXPIRY = '2026-10-12T15:30:00.000Z';
const SECRET = 'A'.repeat(43);
const VIEW = {
  attemptId: 'lifecycle-attempt',
  stage: 'firstFactorRequired',
  expiresAt: EXPIRY,
  factors: [],
};

describe('native lifecycle without a native sign-in factor', () => {
  it.each(['registration', 'recovery'] as const)(
    'starts %s with the selected lifecycle capability',
    async (flow) => {
      const transport = answering(201, {
        success: true,
        data: { ...VIEW, attemptSecret: SECRET, providerNonceDigest: 'a'.repeat(64) },
      });
      const result = await createApiClient(transport).nativeAuth.start({
        clientId: 'lifecycle-client',
        redirectUri: 'app://auth/callback',
        codeChallenge: 'B'.repeat(43),
        codeChallengeMethod: 'S256',
        state: 'saved-state',
        scopes: [],
        flow,
      });
      expect(result).toStrictEqual({
        attemptId: 'lifecycle-attempt',
        stage: 'firstFactorRequired',
        expiresAt: EXPIRY,
        factors: [],
        attemptSecret: SECRET,
        providerNonceDigest: 'a'.repeat(64),
      });
    },
  );

  it('resumes the lifecycle before its email step without inventing a sign-in factor', async () => {
    const result = await createApiClient(
      answering(200, { success: true, data: VIEW }),
    ).nativeAuth.resume({ id: 'lifecycle-attempt', secret: SECRET });
    expect(result).toStrictEqual({
      attemptId: 'lifecycle-attempt',
      stage: 'firstFactorRequired',
      expiresAt: EXPIRY,
      factors: [],
    });
  });

  it('still rejects an empty second-factor challenge', async () => {
    const transport = answering(200, {
      success: true,
      data: { ...VIEW, stage: 'secondFactorRequired' },
    });
    await expect(
      createApiClient(transport).nativeAuth.resume({ id: 'lifecycle-attempt', secret: SECRET }),
    ).rejects.toMatchObject({ name: 'ApiError' });
  });
});
