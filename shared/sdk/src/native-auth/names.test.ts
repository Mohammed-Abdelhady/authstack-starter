import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client'; // feature:email-password
import { ApiError } from '../errors';
import { answering } from '../test-support'; // feature:email-password
import { unwrapNativeAttemptResult } from './parsers';

const ATTEMPT = { id: 'name-attempt', secret: 'A'.repeat(43) };
const PASSWORD = ['Native', 'Password', '123!'].join(''); // feature:email-password
const EXPIRY = '2026-10-12T15:30:00.000Z';
function consent(name: string) {
  return {
    attemptId: ATTEMPT.id,
    stage: 'consentRequired',
    expiresAt: EXPIRY,
    account: { id: 'account-1', email: 'person@example.test', name },
    application: {
      clientId: 'native-client',
      displayName: 'Native app',
      scopes: ['api'],
      alreadyGranted: false,
    },
  };
}

describe('native name character bounds', () => {
  it.each([99, 100])('accepts %i supplementary letters in account summaries', (count) => {
    const name = '\u{10400}'.repeat(count);
    const result = unwrapNativeAttemptResult({
      status: 200,
      body: { success: true, data: consent(name) },
    });
    expect(result).toMatchObject({ account: { name } });
  });

  it.each(['', '   ', 'A'.repeat(101), '\u{10400}'.repeat(101)])(
    'rejects names outside the existing character policy',
    (name) => {
      expect(() =>
        unwrapNativeAttemptResult({ status: 200, body: { success: true, data: consent(name) } }),
      ).toThrow(ApiError);
    },
  );

  // feature:email-password:start
  it.each([99, 100])('sends %i supplementary letters through activation', async (count) => {
    const name = '\u{10400}'.repeat(count);
    const transport = answering(200, { success: true, data: consent(name) });
    await createApiClient(transport).nativeAuth.activate(ATTEMPT, {
      email: 'person@example.test',
      code: '123456',
      password: PASSWORD,
      name,
    });
    expect(transport.sent[0]?.body).toEqual({
      email: 'person@example.test',
      code: '123456',
      password: PASSWORD,
      name,
    });
  });

  it('normalizes signup names before enforcing the character limit', async () => {
    const transport = answering(200, { success: true, data: consent('Émile') });
    await createApiClient(transport).nativeAuth.activate(ATTEMPT, {
      email: 'person@example.test',
      code: '123456',
      password: PASSWORD,
      name: ' E\u0301mile ',
    });
    expect(transport.sent[0]?.body).toEqual({
      email: 'person@example.test',
      code: '123456',
      password: PASSWORD,
      name: 'Émile',
    });
  });

  it('rejects an activation name of 101 characters without sending it', async () => {
    const transport = answering(200, { success: true, data: consent('Person') });
    await expect(
      createApiClient(transport).nativeAuth.activate(ATTEMPT, {
        email: 'person@example.test',
        code: '123456',
        password: PASSWORD,
        name: '\u{10400}'.repeat(101),
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(transport.sent).toEqual([]);
  });
  // feature:email-password:end
});
