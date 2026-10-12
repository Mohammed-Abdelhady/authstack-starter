// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { API_BASE_URL } from '@/constants/api';
import { renderForm, stubNetwork, success } from '@/tests/serverRejectionHarness';
import { NativeAuthorizePanel } from '../NativeAuthorizePanel';
import { TEST_USER, transactionPayload } from './harness';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace: replaceMock }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ASSIGN = vi.fn();
const TRANSACTION = 'txn-selection';
const ORIGINAL_LOCATION = Object.getOwnPropertyDescriptor(window, 'location');

beforeEach(() => {
  ASSIGN.mockClear();
  replaceMock.mockClear();
  Object.defineProperty(window, 'location', { configurable: true, value: { assign: ASSIGN } });
});

afterEach(() => {
  if (ORIGINAL_LOCATION) Object.defineProperty(window, 'location', ORIGINAL_LOCATION);
});

function identity(signedIn: boolean) {
  return stubNetwork((_request, path) =>
    path === '/api/auth/identity'
      ? success(
          signedIn
            ? { authenticated: true, user: TEST_USER }
            : { authenticated: false, user: null },
        )
      : success(transactionPayload('Native client')),
  );
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('targeted native browser entry in %s', (locale) => {
  // feature:oauth-core:start
  it('starts exactly the selected provider once with a clean consent continuation', async () => {
    identity(false);
    await renderForm(
      locale,
      <StrictMode>
        <NativeAuthorizePanel
          transaction={TRANSACTION}
          selectors={{ providerId: 'team-sso', flow: 'signIn' }}
        />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(ASSIGN).toHaveBeenCalledExactlyOnceWith(
        `${API_BASE_URL}/api/auth/oauth/team-sso/start?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-selection`,
      ),
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('starts the chosen provider with an existing identity and returns to consent without re-entry', async () => {
    const requests = identity(true);
    const initial = await renderForm(
      locale,
      <NativeAuthorizePanel transaction={TRANSACTION} selectors={{ providerId: 'team-sso' }} />,
    );
    await waitFor(() =>
      expect(ASSIGN).toHaveBeenCalledExactlyOnceWith(
        `${API_BASE_URL}/api/auth/oauth/team-sso/start?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-selection`,
      ),
    );
    initial.unmount();
    await renderForm(locale, <NativeAuthorizePanel transaction={TRANSACTION} />);
    await screen.findByTestId('native-authorize-ready');
    expect(ASSIGN).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(requests.every((name) => name.startsWith('GET '))).toBe(true);
  });
  // feature:oauth-core:end

  // feature:email-password:start
  it.each([
    [
      'registration',
      '/auth/register?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-selection&flow=registration',
    ],
    [
      'recovery',
      '/auth/forgot-password?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-selection&flow=recovery',
    ],
  ] as const)(
    'opens the selected %s journey with the consent continuation',
    async (flow, expected) => {
      identity(false);
      await renderForm(
        locale,
        <StrictMode>
          <NativeAuthorizePanel transaction={TRANSACTION} selectors={{ flow }} />
        </StrictMode>,
      );
      await waitFor(() => expect(replaceMock).toHaveBeenCalledExactlyOnceWith(expected));
      expect(ASSIGN).not.toHaveBeenCalled();
    },
  );
  // feature:email-password:end
});
