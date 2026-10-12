// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { directionOf } from '@/tests/direction';
import {
  SERVER_TEXT,
  descriptions,
  identitySuccess,
  refusal,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { submitTwiceInOneTick } from '@/modules/auth/__tests__/submitTwice';
import { UpdateProfileCard } from '../UpdateProfileCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: pushMock }),
  usePathname: () => '/settings',
}));

const STORED_NAME = 'Layla Haddad';
const TYPED_NAME = 'Layla H';
const IDENTITY_PATH = '/api/auth/identity';
const PROFILE_PATH = '/api/user/profile';

function user(name: string) {
  return {
    id: 'user-1',
    email: 'layla@example.com',
    name,
    role: 'user',
    permissions: [],
    authProvider: 'email',
    isVerified: true,
    twoFactorEnabled: false,
    passkeyCount: 0,
    linkedProviders: ['email'],
  };
}

function profileNetwork(respond: (request: Request, path: string) => Response | Promise<Response>) {
  return stubNetwork((request, path) =>
    path === IDENTITY_PATH ? identitySuccess(user(STORED_NAME)) : respond(request, path),
  );
}

/** The settings page as the app mounts it: the card under the dashboard's guard. */
async function submitProfile(locale: AppLocale) {
  const form = await renderForm(
    locale,
    <AuthGuard>
      <UpdateProfileCard />
    </AuthGuard>,
  );
  const label = (key: string) => form.message(`settings.profile.${key}`);
  const name = await screen.findByRole('textbox', { name: label('name') });

  // The card fills the name in once the current user has loaded.
  await waitFor(() => {
    expect(name.getAttribute('value')).toBe(STORED_NAME);
  });
  fireEvent.change(name, { target: { value: TYPED_NAME } });
  fireEvent.click(screen.getByRole('button', { name: label('submit') }));

  return { ...form, name };
}

const { expectConsoleError } = registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('UpdateProfileCard in %s', (locale) => {
  it('shows the account address left to right in an rtl page', async () => {
    profileNetwork(() => success(user(STORED_NAME)));
    const { message } = await renderForm(
      locale,
      <div dir="rtl">
        <AuthGuard>
          <UpdateProfileCard />
        </AuthGuard>
      </div>,
    );

    const email = await screen.findByRole('textbox', { name: message('settings.profile.email') });
    await waitFor(() => {
      expect(email.getAttribute('value')).toBe('layla@example.com');
    });
    expect({
      email: directionOf(email),
      name: directionOf(screen.getByRole('textbox', { name: message('settings.profile.name') })),
    }).toEqual({ email: 'ltr', name: 'auto' });
  });

  it('sends a person whose session ended to sign in, without a toast', async () => {
    let identityReads = 0;
    const requests = stubNetwork((request) => {
      const path = new URL(request.url).pathname;
      if (path === IDENTITY_PATH) {
        identityReads += 1;
        return identitySuccess(identityReads === 1 ? user(STORED_NAME) : null);
      }
      if (request.method === 'PATCH') return refusalWith(401, 'SESSION_INVALID');
      return success(user(STORED_NAME));
    });

    const { store, errorToasts } = await submitProfile(locale);

    await waitFor(() => {
      expect(pushMock.mock.calls).toEqual([['/auth/login?redirect=%2Fsettings']]);
    });
    expect(requests).toEqual([
      'GET /api/auth/identity',
      `GET ${PROFILE_PATH}`,
      `PATCH ${PROFILE_PATH}`,
      'GET /api/auth/identity',
    ]);
    expect(store.getState().auth.isAuthenticated).toBe(false);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(errorToasts()).toEqual([]);
  });

  it('shows the generic failure message once for a reply it cannot read', async () => {
    // The query layer logs a reply that breaks the contract.
    expectConsoleError(
      /An unhandled error occurred processing a request for the endpoint "updateProfile"/,
    );
    profileNetwork((request) =>
      request.method === 'GET'
        ? success(user(STORED_NAME))
        : Response.json({ success: true, data: 'not a profile' }),
    );

    const { name, message, errorToasts } = await submitProfile(locale);

    await waitFor(() => {
      expect(errorToasts()).toEqual([message('toast.error.unknownError')]);
    });
    expect(name.isConnected).toBe(true);
    expect(name.getAttribute('value')).toBe(TYPED_NAME);
  });

  it('keeps the typed value in a marked, focused field after a rejection, without a refetch', async () => {
    // A refetch would be answered with the stored name.
    const requests = profileNetwork((request) =>
      request.method === 'GET' ? success(user(STORED_NAME)) : refusal(['name', 'nickname']),
    );

    const { name, fieldMessage, generalMessage, errorToasts } = await submitProfile(locale);

    await waitFor(() => {
      expect(name.getAttribute('aria-invalid')).toBe('true');
    });
    expect(descriptions(name)).toEqual([fieldMessage]);
    // The field takes the focus once the form is enabled again.
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
    expect(requests).toEqual([
      'GET /api/auth/identity',
      `GET ${PROFILE_PATH}`,
      `PATCH ${PROFILE_PATH}`,
    ]);
    expect(name.isConnected).toBe(true);
    expect(name.getAttribute('value')).toBe(TYPED_NAME);
    expect(errorToasts()).toEqual([generalMessage]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
  });

  it('saves once when the form is submitted twice in one tick', async () => {
    let reads = 0;
    const requests = profileNetwork((request) => {
      if (request.method !== 'GET') return success(user(TYPED_NAME));
      reads += 1;
      return success(user(reads === 1 ? STORED_NAME : TYPED_NAME));
    });
    const { message, successToasts } = await renderForm(
      locale,
      <AuthGuard>
        <UpdateProfileCard />
      </AuthGuard>,
    );
    const name = await screen.findByRole('textbox', { name: message('settings.profile.name') });
    await waitFor(() => expect(name.getAttribute('value')).toBe(STORED_NAME));
    fireEvent.change(name, { target: { value: TYPED_NAME } });

    submitTwiceInOneTick(screen.getByTestId('update-profile-form'));

    await waitFor(() => expect(successToasts()).toEqual([message('settings.profile.success')]));
    expect(requests.filter((request) => request.startsWith('PATCH'))).toEqual([
      `PATCH ${PROFILE_PATH}`,
    ]);
  });

  it('refetches once after a successful update and keeps the form on the page', async () => {
    // The refetch is held open, as a real network would hold it for a while.
    let answerRefetch: (response: Response) => void = () => undefined;
    const refetch = new Promise<Response>((resolve) => {
      answerRefetch = resolve;
    });
    let reads = 0;
    const requests = profileNetwork((request) => {
      if (request.method !== 'GET') return success(user(TYPED_NAME));
      reads += 1;
      return reads === 1 ? success(user(STORED_NAME)) : refetch;
    });

    const { name, errorToasts } = await submitProfile(locale);

    await waitFor(() => {
      expect(requests).toEqual([
        'GET /api/auth/identity',
        `GET ${PROFILE_PATH}`,
        `PATCH ${PROFILE_PATH}`,
        'GET /api/auth/identity',
        `GET ${PROFILE_PATH}`,
      ]);
    });
    // The store tells React about the refetch on the next animation frame.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    // The guard would replace this element if the refetch sent it back to loading.
    expect(screen.queryByTestId('auth-guard-loading')).toBeNull();
    expect(name.isConnected).toBe(true);

    answerRefetch(success(user(TYPED_NAME)));
    await waitFor(() => {
      expect(name.getAttribute('value')).toBe(TYPED_NAME);
    });
    expect(name.isConnected).toBe(true);
    expect(name.getAttribute('value')).toBe(TYPED_NAME);
    expect(name.getAttribute('aria-invalid')).toBe('false');
    expect(errorToasts()).toEqual([]);
  });
});
