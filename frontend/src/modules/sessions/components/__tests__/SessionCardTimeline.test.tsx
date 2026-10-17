// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { type Session } from '@app/sdk';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { useSignOutTarget } from '../../hooks/useSignOutTarget';
import { SessionCardTimeline } from '../SessionCardTimeline';
import { SessionSignOutDialog } from '../SessionSignOutDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const NOW = new Date('2026-10-02T12:00:00.000Z');

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BROWSER_SESSION: Session = {
  id: 'session-browser',
  userAgent: CHROME_ON_MAC,
  ip: '203.0.113.10',
  deviceName: 'Chrome 120 on macOS 10.15',
  createdAt: '2026-10-01T12:00:00.000Z',
  lastUsedAt: '2026-10-02T11:00:00.000Z',
  isCurrent: false,
  credentialPurpose: 'browser_session',
};

/** What the server stores for an app whose HTTP client names nothing it knows. */
const NATIVE_SESSION: Session = {
  id: 'session-native',
  userAgent: 'okhttp/4.12.0',
  ip: '203.0.113.20',
  deviceName: 'Unknown device',
  createdAt: '2026-10-01T12:00:00.000Z',
  lastUsedAt: '2026-10-02T11:00:00.000Z',
  isCurrent: false,
  credentialPurpose: 'native_access',
};

/** The card with the confirmation its page gives it. */
function CardWithSignOut({ session }: { readonly session: Session }) {
  const signOut = useSignOutTarget();
  return (
    <>
      <SessionCardTimeline session={session} onSignOut={signOut.ask} />
      <SessionSignOutDialog
        open={signOut.isOpen}
        target={signOut.target}
        sessions={[session]}
        onClose={signOut.close}
      />
    </>
  );
}

registerFormTestLifecycle();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('SessionCardTimeline kind in %s', (locale) => {
  it.each([
    ['browser', BROWSER_SESSION],
    ['mobile', NATIVE_SESSION],
  ])('marks the current %s session and offers no sign-out for it', async (_kind, session) => {
    const { message } = await renderForm(
      locale,
      <SessionCardTimeline session={{ ...session, isCurrent: true }} />,
    );

    const row = screen.getByRole('article');
    expect(within(row).getByText(message('sessions.activeNow'))).toBeTruthy();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it.each([
    ['browser', BROWSER_SESSION],
    ['mobile', NATIVE_SESSION],
  ])('signs out another %s session after a confirmation', async (_kind, session) => {
    const requests = stubNetwork(() => success({ message: 'Session revoked' }));
    const { message, format, successToasts } = await renderForm(
      locale,
      <CardWithSignOut session={session} />,
    );

    const row = screen.getByRole('article');
    expect(within(row).queryByText(message('sessions.activeNow'))).toBeNull();
    const device =
      _kind === 'browser'
        ? format('sessions.browserOnSystem', { browser: 'Chrome 120', system: 'macOS 10.15' })
        : (session.deviceName ?? '');
    fireEvent.click(
      within(row).getByRole('button', { name: format('sessions.signOutDevice', { device }) }),
    );
    expect(requests).toEqual([]);

    const dialog = screen.getByRole('alertdialog', {
      name: message('sessions.logoutConfirmTitle'),
    });
    fireEvent.click(within(dialog).getByRole('button', { name: message('sessions.logout') }));

    await waitFor(() => {
      expect(requests).toEqual([`DELETE /api/user/sessions/${session.id}`]);
    });
    await waitFor(() => {
      expect(successToasts()).toEqual([message('sessions.logoutSuccess')]);
    });
  });
});
