// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import {
  renderForm,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { loadMessages } from '@/i18n/load-messages';
import { OAuthCallbackPanel } from '../OAuthCallbackPanel';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('@/i18n/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/navigation')>();
  return { ...actual, useRouter: () => ({ replace: replaceMock }) };
});

const IDENTITY_PATH = '/api/auth/identity';
const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false,
  passkeyCount: 0,
  linkedProviders: ['email'],
};

const lifecycle = registerFormTestLifecycle();

beforeAll(() => loadMessages('en'));

function renderCallback() {
  return renderForm(
    'en',
    <OAuthCallbackPanel status="ok" errorCode="" providerId="" redirect="/account" />,
  );
}

describe('OAuth callback identity handoff', () => {
  it('navigates only after the identity envelope confirms an authenticated account', async () => {
    const requests = stubNetwork((_request, path) =>
      path === IDENTITY_PATH ? success({ authenticated: true, user: USER }) : success({}),
    );

    await renderCallback();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/account'));
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(requests.allRequests).toEqual([`GET ${IDENTITY_PATH}`]);
  });

  it('keeps the callback on its error state when the identity is signed out', async () => {
    const requests = stubNetwork(() => success({ authenticated: false, user: null }));

    await renderCallback();

    expect(await screen.findByTestId('oauth-callback-error')).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(requests.allRequests).toEqual([`GET ${IDENTITY_PATH}`]);
  });

  it.each([
    ['invalid bearer', 401, ErrorCode.SESSION_INVALID],
    ['service outage', 503, ErrorCode.AUTHORITY_UNAVAILABLE],
    ['malformed identity', 200, 'malformed'],
  ] as const)('does not navigate after an identity %s refusal', async (_label, status, code) => {
    if (code === 'malformed') {
      lifecycle.expectConsoleError(
        /unhandled error occurred processing a request for the endpoint "getIdentity"/i,
      );
    }
    const requests = stubNetwork(() =>
      status === 200
        ? success({ authenticated: true, user: { id: 'incomplete' } })
        : Response.json({ success: false, error: { code, message: 'refused' } }, { status }),
    );

    await renderCallback();

    expect(await screen.findByTestId('oauth-callback-error')).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(requests.allRequests).toEqual([`GET ${IDENTITY_PATH}`]);
  });
});
