// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import {
  makeStore,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { availability, IDLE, isHeld } from '@/tests/busyControls';
import { askToClose, isOpen } from '@/tests/dialogBusy';
import { clickTwiceInOneTick, writesOf } from '../../__tests__/submitTwice';
import { useGetCurrentUserQuery } from '../../store/authApi';
import { LogoutButton } from '../LogoutButton';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));
// jsdom follows a fragment and nothing else, so the sign-in address is one here.
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href }: { href: string }) => `#${href}`,
}));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};
const SIGN_OUT = 'POST /api/auth/logout';
const SIGNED_OUT = () => success({ message: 'Signed out' });

registerFormTestLifecycle();
afterEach(() => {
  window.location.hash = '';
});

function unreachable(): Response {
  throw new TypeError('Failed to fetch');
}

/** Answers each sign-out with the next entry, repeating the last, and every read with `read`. */
function answerSignOut(
  read: () => Response,
  ...answers: Array<() => Response | Promise<Response>>
) {
  let attempts = 0;
  const requests = stubNetwork((request) => {
    if (request.method === 'GET') return read();
    const answer = answers[Math.min(attempts, answers.length - 1)];
    attempts += 1;
    return answer();
  });
  return () => writesOf(requests);
}

/** What a server answers a read once it no longer knows the session. */
const sessionGone = () => refusalWith(401, ErrorCode.SESSION_INVALID);

async function renderSignedIn(locale: AppLocale = 'en') {
  const store = makeStore();
  store.dispatch(loginFulfilled(USER));
  const view = await renderForm(locale, <LogoutButton />, store);
  const button = () =>
    screen.getByRole('button', { name: view.message('auth.activate.logout'), hidden: true });
  const retry = () => screen.getByRole('button', { name: view.message('auth.signOut.retry') });
  const stay = () =>
    screen.getByRole('button', { name: view.message('auth.signOut.staySignedIn') });
  const isSignedIn = () => store.getState().auth.isAuthenticated;
  return { ...view, button, retry, stay, isSignedIn };
}

describe('sign-out button', () => {
  it('signs out once when it is activated twice in one tick', async () => {
    const writes = answerSignOut(sessionGone, SIGNED_OUT);
    const page = await renderSignedIn();

    clickTwiceInOneTick(page.button());

    await waitFor(() =>
      expect(page.successToasts()).toEqual([page.message('toast.success.logoutSuccess')]),
    );
    expect(writes()).toEqual([SIGN_OUT]);
    expect(window.location.hash).toBe('#/auth/login');
    expect(page.isSignedIn()).toBe(false);
  });

  it('treats a server that no longer knows the session as signed out', async () => {
    // The session check the refusal starts gets no answer, so nothing but the
    // button itself can end the session on this page.
    const writes = answerSignOut(unreachable, sessionGone);
    const page = await renderSignedIn();

    fireEvent.click(page.button());

    await waitFor(() => expect(window.location.hash).toBe('#/auth/login'));
    expect(page.isSignedIn()).toBe(false);
    expect(page.successToasts()).toEqual([page.message('toast.success.logoutSuccess')]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(writes()).toEqual([SIGN_OUT]);
  });
});

describe('a sign-out the server did not confirm', () => {
  it.each([
    ['the server cannot be reached', unreachable, 'toast.error.networkError'],
    [
      'the server fails',
      () => refusalWith(500, ErrorCode.INTERNAL_ERROR),
      'errors.codes.INTERNAL_ERROR',
    ],
  ] as const)('stays on the page and says so when %s', async (_name, answer, toastKey) => {
    const writes = answerSignOut(sessionGone, answer);
    const page = await renderSignedIn();

    fireEvent.click(page.button());

    const dialog = await screen.findByRole('alertdialog', {
      name: page.message('auth.signOut.notConfirmedTitle'),
    });
    expect(dialog.textContent).toContain(page.message('auth.signOut.notConfirmedBody'));
    expect(window.location.hash).toBe('');
    expect(page.isSignedIn()).toBe(true);
    expect(page.successToasts()).toEqual([]);
    expect(page.errorToasts()).toEqual([page.message(toastKey)]);
    expect(writes()).toEqual([SIGN_OUT]);
  });

  it.each([
    'en',
    'ar', // feature:locale-ar
  ] as const)('words the notice in %s from the catalogue', async (locale) => {
    answerSignOut(sessionGone, unreachable);
    const page = await renderSignedIn(locale);

    fireEvent.click(page.button());

    const dialog = await screen.findByRole('alertdialog', {
      name: page.message('auth.signOut.notConfirmedTitle'),
    });
    expect(dialog.textContent).toContain(page.message('auth.signOut.notConfirmedBody'));
    expect(availability(page.retry())).toEqual(IDLE);
    expect(availability(page.stay())).toEqual(IDLE);
  });

  it('keeps the notice up while the retry runs and signs out when it reaches the server', async () => {
    const retried = Promise.withResolvers<Response>();
    const writes = answerSignOut(sessionGone, unreachable, () => retried.promise);
    const page = await renderSignedIn();
    fireEvent.click(page.button());
    await screen.findByRole('alertdialog');

    fireEvent.click(page.retry());

    await waitFor(() => expect(writes()).toEqual([SIGN_OUT, SIGN_OUT]));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(page.retry().getAttribute('aria-busy')).toBe('true');
    expect(page.isSignedIn()).toBe(true);

    retried.resolve(SIGNED_OUT());
    await waitFor(() => expect(window.location.hash).toBe('#/auth/login'));
    expect(page.isSignedIn()).toBe(false);
    expect(page.successToasts()).toEqual([page.message('toast.success.logoutSuccess')]);
    expect(writes()).toEqual([SIGN_OUT, SIGN_OUT]);
  });

  it('cannot be closed while the retry is in flight, and can once it failed', async () => {
    const retried = Promise.withResolvers<Response>();
    const writes = answerSignOut(sessionGone, unreachable, () => retried.promise);
    const page = await renderSignedIn();
    fireEvent.click(page.button());
    await screen.findByTestId('sign-out-not-confirmed-dialog');
    fireEvent.click(page.retry());
    await waitFor(() => expect(writes()).toEqual([SIGN_OUT, SIGN_OUT]));

    await askToClose('sign-out-not-confirmed-dialog');
    fireEvent.click(page.stay());
    await askToClose('sign-out-not-confirmed-dialog');

    expect(isOpen('sign-out-not-confirmed-dialog')).toBe(true);
    expect(isHeld(page.stay())).toBe(true);

    retried.reject(new TypeError('Failed to fetch'));
    await waitFor(() => expect(isHeld(page.stay())).toBe(false));
    fireEvent.click(page.stay());

    await waitFor(() => expect(screen.queryByTestId('sign-out-not-confirmed-dialog')).toBeNull());
    expect(page.isSignedIn()).toBe(true);
  });

  it('keeps saying so when the retry fails as well', async () => {
    const writes = answerSignOut(sessionGone, unreachable);
    const page = await renderSignedIn();
    fireEvent.click(page.button());
    await screen.findByRole('alertdialog');

    fireEvent.click(page.retry());

    await waitFor(() => expect(writes()).toEqual([SIGN_OUT, SIGN_OUT]));
    await waitFor(() => expect(page.retry().getAttribute('aria-busy')).toBe('false'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(page.isSignedIn()).toBe(true);
    expect(page.successToasts()).toEqual([]);
  });

  it.each([
    'en',
    'ar', // feature:locale-ar
  ] as const)('states each failed retry in the notice itself in %s', async (locale) => {
    answerSignOut(sessionGone, unreachable);
    const page = await renderSignedIn(locale);
    const stated = () => screen.queryByRole('alert')?.textContent ?? null;
    const retryAndWait = async () => {
      fireEvent.click(page.retry());
      await waitFor(() => expect(page.retry().getAttribute('aria-busy')).toBe('true'));
      await waitFor(() => expect(page.retry().getAttribute('aria-busy')).toBe('false'));
    };
    fireEvent.click(page.button());
    await screen.findByRole('alertdialog');
    expect(stated()).toBeNull();

    await retryAndWait();
    expect(stated()).toBe(page.format('auth.signOut.retryFailed', { count: 2 }));

    await retryAndWait();
    expect(stated()).toBe(page.format('auth.signOut.retryFailed', { count: 3 }));
  });

  it('keeps "Try again" able to hold the focus while it retries and after it fails', async () => {
    const retried = Promise.withResolvers<Response>();
    answerSignOut(sessionGone, unreachable, () => retried.promise);
    const page = await renderSignedIn();
    fireEvent.click(page.button());
    await screen.findByRole('alertdialog');
    page.retry().focus();

    fireEvent.click(page.retry());

    await waitFor(() => expect(page.retry().getAttribute('aria-disabled')).toBe('true'));
    expect(page.retry()).toHaveProperty('disabled', false);
    retried.resolve(refusalWith(500, ErrorCode.INTERNAL_ERROR));
    await waitFor(() => expect(page.retry().getAttribute('aria-disabled')).toBe('false'));
    expect(document.activeElement).toBe(page.retry());
  });

  it('starts counting again once the notice has been closed', async () => {
    answerSignOut(sessionGone, unreachable);
    const page = await renderSignedIn();
    fireEvent.click(page.button());
    await screen.findByRole('alertdialog');
    fireEvent.click(page.retry());
    await screen.findByRole('alert');
    fireEvent.click(page.stay());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    fireEvent.click(page.button());

    await screen.findByRole('alertdialog');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes the notice and stays signed in when the person chooses to stay', async () => {
    const writes = answerSignOut(sessionGone, unreachable);
    const page = await renderSignedIn();
    page.button().focus();
    fireEvent.click(page.button());
    await screen.findByRole('alertdialog');

    fireEvent.click(page.stay());

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(page.isSignedIn()).toBe(true);
    expect(window.location.hash).toBe('');
    expect(writes()).toEqual([SIGN_OUT]);
    await waitFor(() => expect(document.activeElement).toBe(page.button()));
  });
});

describe('the reads of the page after a sign-out that was not confirmed', () => {
  const PROFILE = 'GET /api/user/profile';

  /** A part of the page that shows the profile, so the read has someone to refetch for. */
  function ProfileReader() {
    const { data } = useGetCurrentUserQuery();
    return <p data-testid="profile-name">{data?.name}</p>;
  }

  async function signOutWith(answer: () => Response) {
    const requests = stubNetwork((request) =>
      request.method === 'GET' ? success(USER) : answer(),
    );
    const store = makeStore();
    store.dispatch(loginFulfilled(USER));
    const view = await renderForm(
      'en',
      <>
        <ProfileReader />
        <LogoutButton />
      </>,
      store,
    );
    await waitFor(() => expect(screen.getByTestId('profile-name').textContent).toBe(USER.name));
    fireEvent.click(
      screen.getByRole('button', { name: view.message('auth.activate.logout'), hidden: true }),
    );
    await screen.findByRole('alertdialog');
    return requests;
  }

  it('are asked again when the sign-out answer is lost', async () => {
    const requests = await signOutWith(unreachable);

    await waitFor(() => expect(requests).toEqual([PROFILE, SIGN_OUT, PROFILE]));
  });

  it('are asked again when the server answered with a failure', async () => {
    const requests = await signOutWith(() => refusalWith(500, ErrorCode.INTERNAL_ERROR));

    await waitFor(() => expect(requests).toEqual([PROFILE, SIGN_OUT, PROFILE]));
  });
});
