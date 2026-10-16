// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { USER_PERMISSIONS } from '@app/core';
import InvitationPage from '@/app/[locale]/(auth)/auth/invitation/page';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import {
  identitySuccess,
  makeStore,
  refusalWith,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { InviteDialog } from '../components/InviteDialog';

const ACTOR = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Administrator',
  role: 'admin',
  permissions: [USER_PERMISSIONS.LIST_ALL, USER_PERMISSIONS.CREATE_ALL],
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false,
  passkeyCount: 0,
  linkedProviders: [],
};
const ROLE = {
  id: 'role-1',
  name: 'Member',
  slug: 'user',
  level: 1,
  permissions: [],
  isSystemRole: false,
  isProtected: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const INVITATION = {
  id: 'invitation-1',
  email: 'invitee@example.com',
  role: 'user',
  status: 'pending',
  expiresAt: '2026-12-01T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
};

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('invitation credential safety', () => {
  // Catches mail scanners spending a token and token fragments surviving until a request leaves.
  it('clears the fragment and waits for explicit acceptance before posting', async () => {
    window.history.replaceState(
      null,
      '',
      '/en/auth/invitation#token=single-use-token&purpose=account',
    );
    const fragments: string[] = [];
    const bodies: unknown[] = [];
    const requests = stubNetwork(
      async (request, path) => {
        fragments.push(window.location.hash);
        if (path === '/api/auth/csrf') return success({ token: 'csrf-proof' });
        if (path === '/api/auth/invitations/accept') {
          bodies.push(await request.json());
          return refusalWith(400, 'INVITATION_INVALID');
        }
        throw new Error(`Unexpected request: ${path}`);
      },
      { proof: 'delegate' },
    );
    const { message } = await renderForm(
      'en',
      <StrictMode>
        <InvitationPage />
      </StrictMode>,
    );
    const button = await screen.findByRole('button', {
      name: message('invitations.accept.confirm'),
    });

    expect(window.location.hash).toBe('');
    expect(requests.allRequests).toEqual([]);
    fireEvent.click(button);

    await waitFor(() => expect(bodies).toEqual([{ token: 'single-use-token' }]));
    expect(requests.allRequests).toEqual([
      'GET /api/auth/csrf',
      'POST /api/auth/invitations/accept',
    ]);
    expect(fragments).toEqual(['', '']);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: message('invitations.accept.confirm') }),
      ).toBeNull(),
    );
  });

  // Catches duplicate invitation writes or a changed idempotency key after fresh identity proof.
  it('proves identity and retries a create exactly once with the original key', async () => {
    const creates: { key: string | null; body: unknown }[] = [];
    const proofBodies: unknown[] = [];
    const requests = stubNetwork(async (request, path) => {
      if (path === '/api/roles')
        return success({
          roles: [ROLE, { ...ROLE, id: 'role-admin', slug: 'admin', level: 100 }],
          total: 2,
          page: 1,
          pages: 1,
        });
      if (path === '/api/auth/identity') return identitySuccess(ACTOR);
      if (path === '/api/admin/invitations') {
        creates.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
        return creates.length === 1
          ? refusalWith(401, 'REAUTH_REQUIRED', {
              required: 'fresh_proof',
              methods: ['email-code'],
            })
          : success(INVITATION);
      }
      if (path === '/api/auth/proof/code') return success({ expiresInMinutes: 5 });
      if (path === '/api/auth/proof/code/verify') {
        proofBodies.push(await request.json());
        return success({ provedAt: '2026-11-01T00:00:00.000Z' });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const store = makeStore();
    store.dispatch(loginFulfilled(ACTOR));
    const { message, unmount } = await renderForm('en', <InviteDialog />, store);
    fireEvent.click(screen.getByRole('button', { name: message('invitations.invite') }));
    const dialog = await screen.findByRole('dialog', { name: message('invitations.invite') });
    fireEvent.change(within(dialog).getByRole('textbox', { name: message('invitations.email') }), {
      target: { value: 'invitee@example.com' },
    });
    const role = within(dialog).getByRole('combobox', { name: message('invitations.role') });
    await waitFor(() => expect(role.hasAttribute('disabled')).toBe(false));
    fireEvent.click(within(dialog).getByRole('button', { name: message('invitations.invite') }));
    const proof = await screen.findByRole('dialog', { name: message('invitations.proof.title') });
    expect(creates).toHaveLength(1);
    fireEvent.click(within(proof).getByRole('button', { name: message('invitations.proof.send') }));
    const code = await within(proof).findByRole('textbox', {
      name: message('invitations.proof.code'),
    });
    fireEvent.change(code, { target: { value: '123456' } });
    const verify = within(proof).getByRole('button', { name: message('invitations.proof.verify') });
    fireEvent.click(verify);
    fireEvent.click(verify);

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: message('invitations.invite') })).toBeNull(),
    );
    unmount();
    expect(creates).toHaveLength(2);
    const originalKey = creates[0]?.key;
    expect(originalKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(creates.map((request) => request.key)).toEqual([originalKey, originalKey]);
    expect(creates.map((request) => request.body)).toEqual([
      { email: 'invitee@example.com', role: 'user', locale: 'en' },
      { email: 'invitee@example.com', role: 'user', locale: 'en' },
    ]);
    expect(proofBodies).toEqual([{ code: '123456' }]);
    expect(
      requests.filter((request) => request === 'POST /api/auth/proof/code/verify'),
    ).toHaveLength(1);
  });
});
