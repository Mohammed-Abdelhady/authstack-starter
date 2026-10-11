// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  descriptions,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { clickTwiceInOneTick } from '@/modules/auth/__tests__/submitTwice';
import { availability, heldAnswer, HELD } from '@/tests/busyControls';
import { LinkedAccounts } from '../LinkedAccounts';
import { ProfileSyncStatus } from '../ProfileSyncStatus';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/settings' }));

const LINKED_PATH = '/api/user/linked-providers';
const UNLINK_GOOGLE = 'DELETE /api/user/unlink-provider/google';
const SET_PRIMARY = 'POST /api/user/set-primary-provider';

type Hints = Record<string, string> | undefined;

/** A server holding one email account with Google linked, answering as scripted. */
function server(script: {
  hints: Hints[];
  unlink?: () => Response;
  primaryHints?: Hints;
  primaryProvider?: string;
  emailSignIn?: string;
}) {
  let reads = 0;
  return stubNetwork((request, path) => {
    if (request.method === 'DELETE') {
      return script.unlink?.() ?? success({});
    }
    if (path === LINKED_PATH) {
      const unlinkHints = script.hints[Math.min(reads, script.hints.length - 1)];
      reads += 1;
      const { primaryHints, primaryProvider, emailSignIn } = script;
      return success({
        providers: ['email', 'google'],
        unlinkHints,
        primaryHints,
        primaryProvider,
        emailSignIn,
      });
    }
    return success({ providers: [{ id: 'google', displayName: 'Google' }] });
  });
}

async function renderAccounts(locale: AppLocale) {
  const view = await renderForm(locale, <LinkedAccounts />);
  const google = await screen.findByTestId('linked-account-google');
  return { ...view, google, unlink: () => within(google).queryByTestId('unlink-google') };
}

/** What each row says about itself under its name. */
function statuses() {
  return {
    email: screen.getByTestId('linked-account-status-email').textContent,
    google: screen.getByTestId('linked-account-status-google').textContent,
  };
}

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('LinkedAccounts in %s', (locale) => {
  it('offers the unlink the server allows and none for email sign-in', async () => {
    const requests = server({ hints: [{ email: 'not_removable', google: 'allowed' }] });

    const { message, unlink } = await renderAccounts(locale);

    const button = within(screen.getByTestId('linked-account-google')).getByRole('button', {
      name: message('settings.accounts.unlink'),
    });
    expect(button).toBe(unlink());
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(descriptions(button)).toEqual([]);
    expect(screen.queryByTestId('unlink-email')).toBeNull();
    expect(screen.queryByTestId('unlink-blocked-google')).toBeNull();

    fireEvent.click(button);
    fireEvent.click(await screen.findByTestId('unlink-confirm-google'));
    await waitFor(() => expect(requests).toContain(UNLINK_GOOGLE));
  });

  it('keeps a refused unlink in reach and says why, without sending it', async () => {
    const requests = server({
      hints: [{ email: 'not_removable', google: 'last_sign_in_method' }],
    });

    const { message, unlink } = await renderAccounts(locale);

    const button = unlink();
    if (!button) throw new Error('the unlink control is missing');
    // Not the native attribute: a disabled button leaves the tab order.
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(descriptions(button)).toEqual([
      message('settings.accounts.unlinkBlockedLastSignInMethod'),
    ]);

    fireEvent.click(button);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(requests.filter((request) => request.startsWith('DELETE'))).toEqual([]);
  });

  it('lets the server decide when it sends no hint', async () => {
    server({ hints: [undefined] });

    const { unlink } = await renderAccounts(locale);

    expect(unlink()?.getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByTestId('unlink-blocked-google')).toBeNull();
  });

  it('shows the refusal and the reason when the server refuses an unlink it had allowed', async () => {
    const requests = server({
      hints: [
        { email: 'not_removable', google: 'allowed' },
        { email: 'not_removable', google: 'last_sign_in_method' },
      ],
      unlink: () => refusalWith(400, 'CANNOT_UNLINK_LAST_PROVIDER'),
    });

    const { message, unlink, errorToasts, successToasts } = await renderAccounts(locale);
    fireEvent.click(unlink() ?? document.body);
    fireEvent.click(await screen.findByTestId('unlink-confirm-google'));

    await waitFor(() => {
      expect(errorToasts()).toEqual([message('errors.codes.CANNOT_UNLINK_LAST_PROVIDER')]);
    });
    await waitFor(() => {
      expect(unlink()?.getAttribute('aria-disabled')).toBe('true');
    });
    expect(successToasts()).toEqual([]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByTestId('linked-account-email')).toBeTruthy();
    expect(screen.getByTestId('linked-account-google')).toBeTruthy();
    expect(descriptions(unlink() ?? document.body)).toEqual([
      message('settings.accounts.unlinkBlockedLastSignInMethod'),
    ]);
    expect(requests.filter((request) => !request.includes('oauth'))).toEqual([
      `GET ${LINKED_PATH}`,
      UNLINK_GOOGLE,
      `GET ${LINKED_PATH}`,
    ]);
  });

  it('offers the primary choice the server allows and none for email sign-in', async () => {
    const requests = server({
      hints: [undefined],
      primaryHints: { email: 'no_profile_to_sync', google: 'allowed' },
    });

    const { message, google } = await renderAccounts(locale);

    const button = within(google).getByRole('button', {
      name: message('settings.accounts.setPrimary'),
    });
    expect(button).toBe(screen.getByTestId('set-primary-google'));
    expect(screen.queryByTestId('set-primary-email')).toBeNull();

    fireEvent.click(button);
    await waitFor(() => expect(requests).toContain(SET_PRIMARY));
  });

  it('lets the server decide on the primary when it sends no hint', async () => {
    // A server that knows the unlink hints only: email has no unlink there.
    server({ hints: [{ email: 'not_removable', google: 'allowed' }] });

    await renderAccounts(locale);

    expect(screen.getByTestId('set-primary-email')).toBeTruthy();
    expect(screen.getByTestId('set-primary-google')).toBeTruthy();
  });

  it('offers no primary choice on the one that is primary already', async () => {
    const requests = server({
      hints: [undefined],
      primaryHints: { email: 'no_profile_to_sync', google: 'allowed' },
      primaryProvider: 'google',
    });

    await renderAccounts(locale);

    expect(screen.queryByTestId('set-primary-google')).toBeNull();
    expect(screen.queryByTestId('set-primary-email')).toBeNull();
    expect(requests).not.toContain(SET_PRIMARY);
  });

  it('chooses a primary once when the button is activated twice in one tick', async () => {
    const requests = server({ hints: [undefined] });
    const { successToasts, format } = await renderAccounts(locale);

    clickTwiceInOneTick(screen.getByTestId('set-primary-google'));

    await waitFor(() =>
      expect(successToasts()).toEqual([
        format('settings.accounts.setPrimarySuccess', { provider: 'Google' }),
      ]),
    );
    expect(requests.filter((request) => request === SET_PRIMARY)).toEqual([SET_PRIMARY]);
  });

  it('unlinks once when the confirmation is activated twice in one tick', async () => {
    const requests = server({ hints: [{ email: 'not_removable', google: 'allowed' }] });
    const { successToasts, format, unlink } = await renderAccounts(locale);
    fireEvent.click(unlink() ?? document.body);

    clickTwiceInOneTick(await screen.findByTestId('unlink-confirm-google'));

    await waitFor(() =>
      expect(successToasts()).toEqual([
        format('settings.accounts.unlinkSuccess', { provider: 'Google' }),
      ]),
    );
    expect(requests.filter((request) => request === UNLINK_GOOGLE)).toEqual([UNLINK_GOOGLE]);
  });

  it('asks for one profile sync when the button is activated twice in one tick', async () => {
    const requests = stubNetwork((request) =>
      request.method === 'POST'
        ? success({ requiresOAuth: false, provider: 'google', message: 'nothing to sync' })
        : success({ canSync: true, primaryProvider: 'google' }),
    );
    const { message, errorToasts } = await renderForm(locale, <ProfileSyncStatus />);

    clickTwiceInOneTick(
      await screen.findByRole('button', { name: message('settings.profileSync.syncNow') }),
    );

    await waitFor(() => expect(errorToasts()).toEqual([message('settings.profileSync.syncError')]));
    expect(requests.filter((request) => request.startsWith('POST'))).toEqual([
      'POST /api/user/sync-profile',
    ]);
  });

  it('names email sign-in in the page language and a provider as the server names it', async () => {
    server({ hints: [undefined] });

    const { message, google } = await renderAccounts(locale);

    const email = screen.getByTestId('linked-account-email');
    expect(
      within(email).getByRole('heading', { name: message('settings.accounts.emailSignInName') }),
    ).toBeTruthy();
    expect(within(google).getByRole('heading', { name: 'Google' })).toBeTruthy();
  });

  it('keeps the email row and stops calling it connected when nobody can sign in by email', async () => {
    server({ hints: [undefined], emailSignIn: 'switched_off' });

    const { message } = await renderAccounts(locale);

    expect(statuses()).toEqual({
      email: message('settings.accounts.emailSignInSwitchedOff'),
      google: message('settings.accounts.linkedDescription'),
    });
  });

  it.each([
    ['says it is usable', 'usable'],
    ['says nothing', undefined],
  ])('shows email sign-in as connected when the server %s', async (_name, emailSignIn) => {
    server({ hints: [undefined], emailSignIn });

    const { message } = await renderAccounts(locale);

    expect(statuses()).toEqual({
      email: message('settings.accounts.linkedDescription'),
      google: message('settings.accounts.linkedDescription'),
    });
  });
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus after an unlink is confirmed in %s', (locale) => {
  /** Opens the unlink confirmation from the Google row and presses its confirm button. */
  async function confirmUnlink(opener: HTMLElement) {
    opener.focus();
    fireEvent.click(opener);
    const confirm = await screen.findByTestId('unlink-confirm-google');
    await waitFor(() =>
      expect(screen.getByRole('alertdialog').contains(document.activeElement)).toBe(true),
    );
    confirm.focus();
    fireEvent.click(confirm);
  }

  it('goes to the heading of the list once the account and its card are gone', async () => {
    let linked = ['email', 'google'];
    const held = heldAnswer();
    stubNetwork((request, path) => {
      if (request.method === 'DELETE') {
        linked = ['email'];
        return held.answer;
      }
      return path === LINKED_PATH
        ? success({ providers: linked, unlinkHints: { email: 'not_removable', google: 'allowed' } })
        : success({ providers: [{ id: 'google', displayName: 'Google' }] });
    });
    const { message, unlink } = await renderAccounts(locale);
    const heading = screen.getByRole('heading', {
      name: message('settings.accounts.linkedAccountsLabel'),
    });
    const opener = unlink();
    if (!opener) throw new Error('the unlink control is missing');

    await confirmUnlink(opener);
    const confirm = screen.getByTestId('unlink-confirm-google');
    await waitFor(() => expect(availability(confirm)).toEqual(HELD));
    expect(document.activeElement).toBe(confirm);
    held.settle(() => success({}));

    await waitFor(() => expect(screen.queryByTestId('linked-account-google')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('returns to the unlink button when the server refuses, since the card is still there', async () => {
    server({
      hints: [{ email: 'not_removable', google: 'allowed' }],
      unlink: () => refusalWith(400, 'CANNOT_UNLINK_LAST_PROVIDER'),
    });
    const { unlink } = await renderAccounts(locale);
    const opener = unlink();
    if (!opener) throw new Error('the unlink control is missing');

    await confirmUnlink(opener);

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(unlink()));
  });
});
