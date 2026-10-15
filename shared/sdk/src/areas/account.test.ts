import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';

const OWN_EMAIL = { email: 'layla@example.com', pendingEmail: 'new@example.com' };

describe('createApiClient account email', () => {
  it('sends each own email call to the route the server serves', async () => {
    const transport = answering(200, { success: true, data: OWN_EMAIL });
    const { email } = createApiClient(transport).account;

    await email.get();
    await email.request('new@example.com');
    await email.request('new@example.com', { password: 'Signs-in-1' });
    await email.confirm('123456');
    await email.cancel();
    await email.cancel({ password: 'Signs-in-1' });
    await email.confirmFromApp({
      clientId: 'com.example.app',
      email: 'new@example.com',
      code: '123456',
    });

    expect(transport.sent).toStrictEqual([
      { method: 'GET', path: '/api/user/email' },
      { method: 'POST', path: '/api/user/email', body: { email: 'new@example.com' } },
      {
        method: 'POST',
        path: '/api/user/email',
        body: { email: 'new@example.com', password: 'Signs-in-1' },
      },
      { method: 'POST', path: '/api/user/email/confirm', body: { code: '123456' } },
      { method: 'DELETE', path: '/api/user/email' },
      { method: 'DELETE', path: '/api/user/email', body: { password: 'Signs-in-1' } },
      {
        method: 'POST',
        path: '/api/auth/native/email-change/confirm',
        body: { clientId: 'com.example.app', email: 'new@example.com', code: '123456' },
      },
    ]);
  });
});
