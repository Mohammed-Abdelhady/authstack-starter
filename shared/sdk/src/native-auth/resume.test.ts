import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';

const ATTEMPT = {
  id: 'attempt/1',
  secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

describe('native auth attempt resume', () => {
  it('parses the display view and applies the native secret header', async () => {
    const transport = answering(200, {
      success: true,
      data: {
        attemptId: 'attempt-1',
        stage: 'emailLinkSent',
        expiresAt: '2026-10-12T15:30:00.000Z',
        email: 'user@example.com',
      },
    });
    const signal = { aborted: false };

    const view = await createApiClient(transport).nativeAuth.resume(ATTEMPT, {
      signal,
      headers: {
        Cookie: 'browser=1',
        Authorization: 'Bearer wrong',
        'x-native-attempt': 'wrong',
        'X-Trace-Id': 'trace-1',
      },
    });

    expect(view).toStrictEqual({
      attemptId: 'attempt-1',
      stage: 'emailLinkSent',
      expiresAt: '2026-10-12T15:30:00.000Z',
      email: 'user@example.com',
    });
    expect(transport.sent).toStrictEqual([
      {
        method: 'GET',
        path: '/api/auth/native/attempts/attempt%2F1',
        headers: { 'X-Trace-Id': 'trace-1', 'X-Native-Attempt': ATTEMPT.secret },
        signal,
      },
    ]);
  });
});
