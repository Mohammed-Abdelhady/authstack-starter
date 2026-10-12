// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import { loadMessages } from '@/i18n/load-messages';
import { clearBrowserProof, rememberBrowserProof } from '@/store/api/browser-proof';
import {
  errorResponse,
  installFetch,
  jsonResponse,
  makeStore,
  renderPanel,
  seedReady,
  transactionPayload,
} from './harness';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

let messages: AbstractIntlMessages;
let frames: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  messages = await loadMessages('en');
});

beforeEach(() => {
  replaceMock.mockClear();
  // RTK Query syncs subscriptions on a timer that nothing can cancel. Faking
  // it lets a test run that timer after unmount instead of waiting for it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // Installed before the store exists, because the store keeps the function.
  frames = vi.spyOn(window, 'requestAnimationFrame');
  rememberBrowserProof('session-proof', 'session');
});

afterEach(() => {
  cleanup();
  clearBrowserProof();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function transactionResponse(): Response {
  return jsonResponse({ success: true, data: transactionPayload('Acme Mobile') });
}

/**
 * Testing Library's `waitFor` settles on a `setTimeout`, which is faked here,
 * so the wait is Vitest's, inside `act` so React sees the updates it causes.
 */
async function waitUntil(check: () => void): Promise<void> {
  await act(() => vi.waitFor(check));
}

/** Unmounts, then runs every timer the store left behind. */
function unmountAndRunStoreTimers(): void {
  cleanup();
  vi.runAllTimers();
}

/**
 * A frame requested by the store can run after jsdom's window has closed,
 * which fails the whole run from outside any test. The harness store must
 * never ask for one, however the page is left.
 */
describe('NativeAuthorizePanel teardown', () => {
  it('asks for no frame when the card is unmounted', async () => {
    installFetch(() => transactionResponse());
    const store = makeStore();
    await seedReady(store);
    renderPanel({ locale: 'en', messages, store });
    screen.getByTestId('native-authorize-ready');

    unmountAndRunStoreTimers();

    expect(frames).not.toHaveBeenCalled();
  });

  it('asks for no frame when unmounted while approval is in flight', async () => {
    let approvalSent = false;
    installFetch((request) => {
      if (request.method !== 'POST') {
        return transactionResponse();
      }
      approvalSent = true;
      return new Promise<Response>(() => {});
    });
    const store = makeStore();
    await seedReady(store);
    renderPanel({ locale: 'en', messages, store });

    screen.getByTestId('native-authorize-ready');
    fireEvent.click(screen.getByTestId('native-authorize-approve'));
    await waitUntil(() => expect(approvalSent).toBe(true));
    unmountAndRunStoreTimers();

    expect(frames).not.toHaveBeenCalled();
  });

  it('asks for no frame when a refused session sends the visitor to sign-in', async () => {
    installFetch(() => errorResponse('SESSION_REQUIRED', 401), {
      identity: () => errorResponse('SESSION_REQUIRED', 401),
    });
    renderPanel({ locale: 'en', messages, store: makeStore() });

    await waitUntil(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    unmountAndRunStoreTimers();

    expect(frames).not.toHaveBeenCalled();
  });
});
