import { expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';

const PROFILE = {
  id: 'user-1',
  email: 'person@example.test',
  name: 'Person',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  linkedProviders: [],
  locale: 'en',
};

it.each([
  'en',
  'ar', // feature:locale-ar
])('sends locale %s and retains the returned own-profile value', async (locale) => {
  const transport = answering(200, { success: true, data: { ...PROFILE, locale } });
  const client = createApiClient(transport);
  const updated = await client.profile.update({ locale });
  const read = await client.profile.get();
  expect({ updated: updated.locale, read: read.locale }).toEqual({ updated: locale, read: locale });
  expect(transport.sent).toEqual([
    { method: 'PATCH', path: '/api/user/profile', body: { locale } },
    { method: 'GET', path: '/api/user/profile' },
  ]);
});
it('carries the observed version through the real profile update transport', async () => {
  const transport = answering(200, { success: true, data: { ...PROFILE, version: 8 } });
  const client = createApiClient(transport);
  expect((await client.profile.update({ name: 'Updated profile', version: 7 })).version).toBe(8);
  expect((await client.profile.get()).version).toBe(8);
  expect(transport.sent).toEqual([
    { method: 'PATCH', path: '/api/user/profile', body: { name: 'Updated profile', version: 7 } },
    { method: 'GET', path: '/api/user/profile' },
  ]);
});

it.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'refuses malformed profile versions after both reads and writes',
  async (version) => {
    const client = createApiClient(
      answering(200, {
        success: true,
        data: { ...PROFILE, version },
      }),
    );
    await expect(client.profile.get()).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
    await expect(
      client.profile.update({ name: 'Updated profile', version: 7 }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
  },
);
