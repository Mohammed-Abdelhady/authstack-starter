// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import { loadMessages } from '@/i18n/load-messages';
import { clearBrowserProof, rememberBrowserProof } from '@/store/api/browser-proof';
import { availability, IDLE } from '@/tests/busyControls';
import {
  OTHER_USER,
  TEST_USER,
  codeTranslator,
  errorResponse,
  identityResponse,
  installFetch,
  jsonResponse,
  makeStore,
  renderPanel,
  seedReady,
  transactionPayload,
  userResponse,
} from './harness';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

const LOCALES = [
  'en',
  'ar', // feature:locale-ar
] as const;

const IDENTITY_PATH = '/api/auth/identity';
const APPROVE_PATH = '/api/oauth/authorize/approve';
const DENY_PATH = '/api/oauth/authorize/deny';
const MISMATCH = 'NATIVE_AUTHORIZE_ACCOUNT_MISMATCH';
const NOTICE = 'native-authorize-account-changed';

const ACTIONS = [
  ['approve', 'native-authorize-approve', APPROVE_PATH],
  ['deny', 'native-authorize-deny', DENY_PATH],
] as const;

let messages: Record<(typeof LOCALES)[number], AbstractIntlMessages>;
let assignMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  messages = {
    en: await loadMessages('en'),
    ar: await loadMessages('ar'), // feature:locale-ar
  };
});

beforeEach(() => {
  replaceMock.mockClear();
  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignMock },
  });
  rememberBrowserProof('session-proof', 'session');
});

afterEach(() => {
  cleanup();
  clearBrowserProof();
  vi.unstubAllGlobals();
});

function transactionResponse(): Response {
  return jsonResponse({ success: true, data: transactionPayload('Acme Mobile') });
}

function redirectResponse(): Response {
  return jsonResponse({ success: true, data: { redirectUri: 'myapp://done' } });
}

async function renderReady(locale: (typeof LOCALES)[number] = 'en') {
  const store = makeStore();
  await seedReady(store);
  const view = renderPanel({ locale, messages: messages[locale], store });
  await screen.findByTestId('native-authorize-ready');
  return view;
}

describe('NativeAuthorizePanel account on screen', () => {
  it.each(ACTIONS)('names the displayed account when sending %s', async (_action, control) => {
    const bodies: unknown[] = [];
    installFetch(async (request) => {
      if (request.method === 'POST') {
        bodies.push(await request.json());
        return redirectResponse();
      }
      return transactionResponse();
    });
    await renderReady();

    fireEvent.click(screen.getByTestId(control));

    await screen.findByTestId('native-authorize-returning');
    expect(bodies).toEqual([{ transactionId: 'txn-abc123', expectedUserId: 'user-1' }]);
  });

  it('reads identity again before the approve request leaves', async () => {
    const requests = installFetch((request) =>
      request.method === 'POST' ? redirectResponse() : transactionResponse(),
    );
    await renderReady();

    fireEvent.click(screen.getByTestId('native-authorize-approve'));

    await screen.findByTestId('native-authorize-returning');
    expect(requests).toEqual([IDENTITY_PATH, IDENTITY_PATH, APPROVE_PATH]);
  });

  it.each(LOCALES)(
    'stops approve and shows the new account with a notice in %s',
    async (locale) => {
      let identityReads = 0;
      const requests = installFetch(
        (request) => (request.method === 'POST' ? redirectResponse() : transactionResponse()),
        {
          identity: () => {
            identityReads += 1;
            return userResponse(identityReads === 1 ? TEST_USER : OTHER_USER);
          },
        },
      );
      await renderReady(locale);
      expect(screen.queryByTestId(NOTICE)).toBeNull();

      fireEvent.click(screen.getByTestId('native-authorize-approve'));

      const notice = await screen.findByTestId(NOTICE);
      expect(notice.textContent).toBe(codeTranslator(locale, messages[locale])(MISMATCH));
      expect(notice.getAttribute('role')).toBe('alert');
      expect(screen.getByTestId('native-authorize-ready').textContent).toContain(
        'omar@example.com',
      );
      expect(requests).toEqual([IDENTITY_PATH, IDENTITY_PATH]);
      expect(assignMock).not.toHaveBeenCalled();
      expect(availability(screen.getByTestId('native-authorize-approve'))).toEqual(IDLE);
    },
  );

  it.each(ACTIONS)(
    'does not complete %s when the server reports another account',
    async (_action, control, path) => {
      let refused = false;
      const requests = installFetch(
        (request) => {
          if (request.method === 'POST') {
            refused = true;
            return errorResponse(MISMATCH, 409);
          }
          return transactionResponse();
        },
        { identity: () => userResponse(refused ? OTHER_USER : TEST_USER) },
      );
      await renderReady();

      fireEvent.click(screen.getByTestId(control));

      await screen.findByTestId(NOTICE);
      expect(screen.getByTestId('native-authorize-ready').textContent).toContain(
        'omar@example.com',
      );
      expect(requests.filter((request) => request === path)).toHaveLength(1);
      expect(requests.at(-1)).toBe(IDENTITY_PATH);
      expect(assignMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId('native-authorize-returning')).toBeNull();
      expect(screen.queryByTestId('native-authorize-error')).toBeNull();
    },
  );

  it.each(ACTIONS)(
    'returns focus to the card heading after a refused %s',
    async (_action, control) => {
      let refused = false;
      installFetch(
        (request) => {
          if (request.method === 'POST') {
            refused = true;
            return errorResponse(MISMATCH, 409);
          }
          return transactionResponse();
        },
        { identity: () => userResponse(refused ? OTHER_USER : TEST_USER) },
      );
      await renderReady();
      const pressed = screen.getByTestId(control);
      pressed.focus();

      fireEvent.click(pressed);

      await screen.findByTestId(NOTICE);
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })),
      );
    },
  );

  it('approves for the new account once the person confirms it', async () => {
    const bodies: unknown[] = [];
    installFetch(
      async (request) => {
        if (request.method !== 'POST') {
          return transactionResponse();
        }
        bodies.push(await request.json());
        return bodies.length === 1 ? errorResponse(MISMATCH, 409) : redirectResponse();
      },
      { identity: () => userResponse(bodies.length === 0 ? TEST_USER : OTHER_USER) },
    );
    await renderReady();

    fireEvent.click(screen.getByTestId('native-authorize-approve'));
    await screen.findByTestId(NOTICE);
    fireEvent.click(screen.getByTestId('native-authorize-approve'));

    await screen.findByTestId('native-authorize-returning');
    expect(bodies).toEqual([
      { transactionId: 'txn-abc123', expectedUserId: 'user-1' },
      { transactionId: 'txn-abc123', expectedUserId: 'user-2' },
    ]);
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith('myapp://done');
  });

  it('shows the error state when the account cannot be read after a mismatch', async () => {
    let refused = false;
    installFetch(
      (request) => {
        if (request.method === 'POST') {
          refused = true;
          return errorResponse(MISMATCH, 409);
        }
        return transactionResponse();
      },
      {
        identity: () => (refused ? errorResponse('INTERNAL_ERROR', 500) : userResponse(TEST_USER)),
      },
    );
    await renderReady();

    fireEvent.click(screen.getByTestId('native-authorize-approve'));

    await screen.findByTestId('native-authorize-error');
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('native-authorize-approve')).toBeNull();
  });

  it('goes to sign-in without approving when the identity check is refused', async () => {
    let identityReads = 0;
    const requests = installFetch(
      (request) => (request.method === 'POST' ? redirectResponse() : transactionResponse()),
      {
        identity: () => {
          identityReads += 1;
          return identityReads === 1
            ? userResponse(TEST_USER)
            : errorResponse('SESSION_INVALID', 401);
        },
      },
    );
    await renderReady();

    fireEvent.click(screen.getByTestId('native-authorize-approve'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expect(requests).not.toContain(APPROVE_PATH);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('goes to sign-in without approving when identity confirms signed out', async () => {
    let identityReads = 0;
    const requests = installFetch(
      (request) => (request.method === 'POST' ? redirectResponse() : transactionResponse()),
      {
        identity: () => {
          identityReads += 1;
          return identityReads === 1 ? userResponse(TEST_USER) : identityResponse(null);
        },
      },
    );
    await renderReady();

    fireEvent.click(screen.getByTestId('native-authorize-approve'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expect(requests).not.toContain(APPROVE_PATH);
    expect(assignMock).not.toHaveBeenCalled();
  });
});
