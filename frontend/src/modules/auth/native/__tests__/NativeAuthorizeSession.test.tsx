// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import { loadMessages } from '@/i18n/load-messages';
import { clearBrowserProof, rememberBrowserProof } from '@/store/api/browser-proof';
import { authApi } from '../../store/authApi';
import {
  OTHER_USER,
  TEST_TRANSACTION,
  TEST_USER,
  errorResponse,
  identityResponse,
  installFetch,
  jsonResponse,
  makeStore,
  renderPanel,
  seedReady,
  transactionPayload,
  userResponse,
  type TestStore,
} from './harness';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

const SIGN_IN_HREF = '/auth/login?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-abc123';

/** Written out by hand: the answers that must send the browser to sign-in. */
const SIGN_IN_CODES = ['SESSION_REQUIRED', 'SESSION_INVALID', 'SESSION_EXPIRED'] as const;

let messages: AbstractIntlMessages;
let assignMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  messages = await loadMessages('en');
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

function render(store: TestStore) {
  return renderPanel({ locale: 'en', messages, store });
}

/** Leaves a completed signed-out identity in the cache, as an earlier visit would. */
async function cacheSignedOutReads(store: TestStore): Promise<void> {
  const transaction = store.dispatch(
    authApi.endpoints.getNativeAuthorizeTransaction.initiate(TEST_TRANSACTION),
  );
  const identity = store.dispatch(authApi.endpoints.getIdentity.initiate());
  await Promise.all([transaction, identity]);
  transaction.unsubscribe();
  identity.unsubscribe();
}

describe('NativeAuthorizePanel sign-in round trip', () => {
  it('shows the card after signing in on the same store, with one redirect', async () => {
    let signedIn = false;
    const refused = () => errorResponse('SESSION_REQUIRED', 401);
    installFetch(() => (signedIn ? transactionResponse() : refused()), {
      identity: () => (signedIn ? userResponse(TEST_USER) : identityResponse(null)),
    });
    const store = makeStore();

    const signedOutVisit = render(store);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expect(replaceMock).toHaveBeenCalledWith(SIGN_IN_HREF);
    signedOutVisit.unmount();

    signedIn = true;
    render(store);

    await screen.findByTestId('native-authorize-ready');
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes a cached signed-out identity before deciding whether to redirect', async () => {
    let signedIn = false;
    const refused = () => errorResponse('SESSION_REQUIRED', 401);
    installFetch(() => (signedIn ? transactionResponse() : refused()), {
      identity: () => (signedIn ? userResponse(TEST_USER) : identityResponse(null)),
    });
    const store = makeStore();
    await cacheSignedOutReads(store);

    signedIn = true;
    render(store);

    await screen.findByTestId('native-authorize-ready');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows the account that signed in, not the one cached before sign-in', async () => {
    let signedInAs: typeof TEST_USER | null = null;
    installFetch(
      () => (signedInAs ? transactionResponse() : errorResponse('SESSION_REQUIRED', 401)),
      {
        identity: () => (signedInAs ? userResponse(signedInAs) : identityResponse(null)),
      },
    );
    const store = makeStore();
    await store.dispatch(
      authApi.util.upsertQueryData('getIdentity', undefined, {
        authenticated: true,
        user: TEST_USER,
      }),
    );

    const expiredVisit = render(store);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expiredVisit.unmount();

    signedInAs = OTHER_USER;
    render(store);

    const card = await screen.findByTestId('native-authorize-ready');
    expect(card.textContent).toContain('omar@example.com');
    expect(card.textContent).not.toContain('layla@example.com');
  });

  it.each(['identity', 'transaction'] as const)(
    'refetches an inherited pending %s refusal instead of redirecting',
    async (read) => {
      let answerOldRequest: (response: Response) => void = () => {
        throw new Error('The old request has not started');
      };
      let markStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let signedIn = false;
      const oldResponse = () =>
        new Promise<Response>((resolve) => {
          answerOldRequest = resolve;
          markStarted();
        });
      const requests = installFetch(
        () => (read === 'transaction' && !signedIn ? oldResponse() : transactionResponse()),
        {
          identity: () =>
            read === 'identity' && !signedIn ? oldResponse() : userResponse(TEST_USER),
        },
      );
      const store = makeStore();
      const oldRequest =
        read === 'identity'
          ? store.dispatch(authApi.endpoints.getIdentity.initiate())
          : store.dispatch(
              authApi.endpoints.getNativeAuthorizeTransaction.initiate(TEST_TRANSACTION),
            );
      await started;
      signedIn = true;
      render(store);
      await act(async () => {
        answerOldRequest(errorResponse('SESSION_REQUIRED', 401));
        await oldRequest;
      });

      await screen.findByTestId('native-authorize-ready');
      expect(replaceMock).not.toHaveBeenCalled();
      expect(
        requests.filter(
          (path) =>
            path ===
            (read === 'identity'
              ? '/api/auth/identity'
              : '/api/oauth/authorize/transaction/txn-abc123'),
        ),
      ).toHaveLength(2);
      oldRequest.unsubscribe();
    },
  );

  it('requires sign-in when a transaction failure accompanies an invalid identity', async () => {
    installFetch(() => errorResponse('INTERNAL_ERROR', 500), {
      identity: () => errorResponse('SESSION_INVALID', 401),
    });
    render(makeStore());

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(SIGN_IN_HREF));
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('native-authorize-error')).toBeNull();
  });

  it('redirects once when "Not you?" signs out and identity confirms it', async () => {
    let signedOut = false;
    installFetch(
      (request) => {
        if (request.method === 'POST') {
          signedOut = true;
          return jsonResponse({ success: true, data: { message: 'ok' } });
        }
        return transactionResponse();
      },
      {
        identity: () => {
          return signedOut ? identityResponse(null) : userResponse(TEST_USER);
        },
      },
    );
    const store = makeStore();
    await seedReady(store);
    render(store);
    await screen.findByTestId('native-authorize-ready');

    fireEvent.click(screen.getByTestId('native-authorize-not-you'));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    // Sign-out resets the cached identity, so its refetch is already on
    // the wire. A later request answering means that refetch has answered too.
    await store.dispatch(authApi.endpoints.getNativeAuthorizeTransaction.initiate('later'));
    await act(async () => {});
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('native-authorize-error')).toBeNull();
  });
});

describe.each(SIGN_IN_CODES)('NativeAuthorizePanel answered 401 %s', (code) => {
  async function expectSignIn(): Promise<void> {
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(SIGN_IN_HREF));
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('native-authorize-error')).toBeNull();
    expect(assignMock).not.toHaveBeenCalled();
  }

  it('goes to sign-in when the identity read is refused', async () => {
    installFetch(() => transactionResponse(), { identity: () => errorResponse(code, 401) });
    render(makeStore());

    await expectSignIn();
  });

  it('goes to sign-in when the transaction read is refused', async () => {
    installFetch(() => errorResponse(code, 401));
    render(makeStore());

    await expectSignIn();
  });

  it.each([
    ['approve', 'native-authorize-approve'],
    ['deny', 'native-authorize-deny'],
  ])('goes to sign-in when %s is refused', async (_action, control) => {
    installFetch((request) =>
      request.method === 'POST' ? errorResponse(code, 401) : transactionResponse(),
    );
    const store = makeStore();
    await seedReady(store);
    render(store);
    await screen.findByTestId('native-authorize-ready');

    fireEvent.click(screen.getByTestId(control));

    await expectSignIn();
  });
});

describe('NativeAuthorizePanel answered 401 without a code', () => {
  it('goes to sign-in', async () => {
    installFetch(() => jsonResponse({ success: false }, 401));
    render(makeStore());

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(SIGN_IN_HREF));
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });
});
