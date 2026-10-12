import { useState } from 'react';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { unwrapSessionListBody, type Session } from '@app/sdk';
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

/** What the server stores for an app that reports its system. */
const NATIVE_SESSION_ON_IOS: Session = {
  ...NATIVE_SESSION,
  id: 'session-native-ios',
  userAgent: 'Acme/2.1 (iPhone; iPhone OS 17_2)',
  deviceName: 'Unknown Browser on iOS 17',
};

const BROWSER_PLACEHOLDER = 'Unknown Browser';

/** A purpose this build has never heard of, read the way the page reads the list. */
function sessionFromNewerServer(): Session {
  const body = {
    success: true,
    data: { sessions: [{ ...BROWSER_SESSION, credentialPurpose: 'native_refresh' }], total: 1 },
  };
  return unwrapSessionListBody(body).sessions[0];
}

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
  it('names a browser row by its device and the browser label', async () => {
    const { message } = await renderForm(locale, <SessionCardTimeline session={BROWSER_SESSION} />);

    const row = screen.getByRole('article', {
      name: `Chrome 120 on macOS 10.15 ${message('sessions.kind.browser')}`,
    });
    expect(within(row).getByText(message('sessions.kind.browser'))).toBeTruthy();
    expect(within(row).queryByText(message('sessions.kind.nativeApp'))).toBeNull();
    expect(within(row).getByText('Chrome 120 · macOS 10.15')).toBeTruthy();
    expect(within(row).getByTestId('device-icon-desktop')).toBeTruthy();
  });

  it('names a mobile row by the app label and shows no browser for it', async () => {
    const { message } = await renderForm(locale, <SessionCardTimeline session={NATIVE_SESSION} />);

    const row = screen.getByRole('article', {
      name: `${NATIVE_SESSION.deviceName} ${message('sessions.kind.nativeApp')}`,
    });
    expect(within(row).getByText(message('sessions.kind.nativeApp'))).toBeTruthy();
    expect(within(row).queryByText(message('sessions.kind.browser'))).toBeNull();
    expect(row.textContent).not.toContain(BROWSER_PLACEHOLDER);
    expect(within(row).getByTestId('device-icon-mobile')).toBeTruthy();
  });

  it('names a mobile row by the system its app reports', async () => {
    const { message } = await renderForm(
      locale,
      <SessionCardTimeline session={NATIVE_SESSION_ON_IOS} />,
    );

    const row = screen.getByRole('article', {
      name: `${NATIVE_SESSION_ON_IOS.deviceName} ${message('sessions.kind.nativeApp')}`,
    });
    expect(row).toBeTruthy();
  });

  it('renders structured browser and native names through the catalogue', async () => {
    const { message } = await renderForm(
      locale,
      <>
        <SessionCardTimeline
          session={{
            ...BROWSER_SESSION,
            deviceParts: {
              kind: 'browser',
              browserName: 'Chrome',
              browserMajorVersion: '140',
              platformName: 'macOS',
              platformVersion: '10.15',
            },
          }}
        />
        <SessionCardTimeline
          session={{
            ...NATIVE_SESSION,
            deviceParts: { kind: 'mobileApp', platformName: 'Android' },
          }}
        />
      </>,
    );
    expect(
      [
        screen.queryByRole('article', {
          name: `${message('sessions.browserOnSystem').replace('{browser}', 'Chrome 140').replace('{system}', 'macOS 10.15')} ${message('sessions.kind.browser')}`,
        }),
        screen.queryByRole('article', {
          name: `${message('sessions.mobileAppOnSystem').replace('{system}', 'Android')} ${message('sessions.kind.nativeApp')}`,
        }),
      ].map(Boolean),
    ).toEqual([true, true]);
  });

  it('refreshes the device label when structured versions change', async () => {
    function UpdatedDevice() {
      const [version, setVersion] = useState('140');
      return (
        <>
          <button
            data-testid="update-device-parts"
            aria-label={BROWSER_SESSION.deviceName}
            onClick={() => setVersion('141')}
          />
          <SessionCardTimeline
            session={{
              ...BROWSER_SESSION,
              deviceParts: {
                kind: 'browser',
                browserName: 'Chrome',
                browserMajorVersion: version,
                platformName: 'macOS',
                platformVersion: '10.15',
              },
            }}
          />
        </>
      );
    }
    const { message, format } = await renderForm(locale, <UpdatedDevice />);
    fireEvent.click(screen.getByTestId('update-device-parts'));
    expect(
      screen.queryByRole('article', {
        name: `${format('sessions.browserOnSystem', { browser: 'Chrome 141', system: 'macOS 10.15' })} ${message('sessions.kind.browser')}`,
      }),
    ).toBeTruthy();
  });

  it('gives the two kinds different words', async () => {
    const { message } = await renderForm(locale, <SessionCardTimeline session={BROWSER_SESSION} />);

    const browser = message('sessions.kind.browser');
    const nativeApp = message('sessions.kind.nativeApp');
    expect(browser.trim()).not.toBe('');
    expect(nativeApp.trim()).not.toBe('');
    expect(browser).not.toBe(nativeApp);
  });

  it('keeps the kind icon out of the accessibility tree', async () => {
    await renderForm(locale, <SessionCardTimeline session={NATIVE_SESSION} />);

    const icon = screen.getByTestId('session-kind-nativeApp').querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a row without a kind label for a purpose it does not know', async () => {
    const { message } = await renderForm(
      locale,
      <SessionCardTimeline session={sessionFromNewerServer()} />,
    );

    const row = screen.getByRole('article', { name: 'Chrome 120 on macOS 10.15' });
    expect(within(row).queryByText(message('sessions.kind.browser'))).toBeNull();
    expect(within(row).queryByText(message('sessions.kind.nativeApp'))).toBeNull();
    expect(within(row).getByText('Chrome 120 · macOS 10.15')).toBeTruthy();
  });

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
    expect(
      within(row).queryByRole('button', { name: message('sessions.logoutThisDevice') }),
    ).toBeNull();
  });

  it.each([
    ['browser', BROWSER_SESSION],
    ['mobile', NATIVE_SESSION],
  ])('signs out another %s session after a confirmation', async (_kind, session) => {
    const requests = stubNetwork(() => success({ message: 'Session revoked' }));
    const { message, successToasts } = await renderForm(
      locale,
      <CardWithSignOut session={session} />,
    );

    const row = screen.getByRole('article');
    expect(within(row).queryByText(message('sessions.activeNow'))).toBeNull();
    fireEvent.click(
      within(row).getByRole('button', { name: message('sessions.logoutThisDevice') }),
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

  it('asks about a mobile session without naming a browser', async () => {
    const { message } = await renderForm(locale, <CardWithSignOut session={NATIVE_SESSION} />);

    fireEvent.click(screen.getByRole('button', { name: message('sessions.logoutThisDevice') }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(NATIVE_SESSION.deviceName);
    expect(dialog.textContent).not.toContain(BROWSER_PLACEHOLDER);
  });
});
