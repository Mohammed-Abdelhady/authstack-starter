import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { NextIntlClientProvider, createTranslator, type AbstractIntlMessages } from 'next-intl';
import { toast as sonnerToast } from 'sonner';
import { ErrorCode } from '@app/core';
import type { Identity, User } from '@app/sdk';
import { loadMessages, type AppLocale } from '@/i18n/load-messages';
import { lookupMessage } from '@/i18n/__tests__/message-tree';
import { baseApi } from '@/store/api/baseApi';
import { CSRF_HEADER, clearBrowserProof } from '@/store/api/browser-proof';
import { errorInterceptor } from '@/store/middleware/errorInterceptor';
import authReducer from '@/modules/auth/store/authSlice';

/** Text the server sends. It is English only and must never reach the page. */
export const SERVER_TEXT = 'server says this value is wrong';

/** The body of a 400 that names these fields, as the server's filter writes it. */
export function validationErrorBody(fieldNames: string[]) {
  return {
    success: false,
    error: {
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Validation failed',
      details: {
        fields: Object.fromEntries(fieldNames.map((name) => [name, [SERVER_TEXT]])),
      },
    },
  };
}

export function refusal(fieldNames: string[]): Response {
  return Response.json(validationErrorBody(fieldNames), { status: 400 });
}

/** A refusal with its own status and code, carrying the server's English text. */
export function refusalWith(status: number, code: string, details?: unknown): Response {
  return Response.json(
    { success: false, error: { code, message: SERVER_TEXT, details } },
    { status },
  );
}

export function success(data: unknown): Response {
  return Response.json({ success: true, data });
}

/** The optional session endpoint's real envelope, including its discriminator. */
export function identitySuccess(user: User | null): Response {
  const data: Identity =
    user === null ? { authenticated: false, user: null } : { authenticated: true, user };
  return success(data);
}

/**
 * Answers every request through `respond` and records what was asked, as
 * `METHOD /path`, in the order the requests arrived.
 */
export interface NetworkRequests extends Array<string> {
  /** Includes the session and browser proof reads hidden from older business-request assertions. */
  allRequests: string[];
}

export function stubNetwork(
  respond: (request: Request, path: string) => Response | Promise<Response>,
  options: { proof?: 'automatic' | 'delegate' } = {},
): NetworkRequests {
  const requests: NetworkRequests = Object.assign([] as string[], { allRequests: [] as string[] });
  Object.defineProperty(requests, 'allRequests', { enumerable: false });
  let issuedProofs = 0;
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    const name = `${request.method} ${path}`;
    requests.allRequests.push(name);
    if (options.proof !== 'delegate' && path === '/api/auth/csrf') {
      return refusalWith(401, ErrorCode.SESSION_REQUIRED);
    }
    if (options.proof !== 'delegate' && path === '/api/auth/browser-proof') {
      issuedProofs += 1;
      const token = `test-browser-proof-${issuedProofs}`;
      return Response.json(
        { success: true, data: { token } },
        { headers: { [CSRF_HEADER]: token } },
      );
    }
    requests.push(name);
    return respond(request, path);
  });
  return requests;
}

/** Refuses every write with a validation error and answers every read with `readData`. */
export function refuseWrites(fieldNames: string[], readData: unknown = {}): NetworkRequests {
  return stubNetwork((request) =>
    request.method === 'GET' ? success(readData) : refusal(fieldNames),
  );
}

/** The store wiring of the app: the error interceptor ahead of the API middleware. */
export function makeStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer, auth: authReducer },
    middleware: (defaults) => defaults().concat(errorInterceptor).concat(baseApi.middleware),
    // Keep notifications asynchronous without a frame timer surviving jsdom teardown.
    enhancers: (defaults) => defaults({ autoBatch: { type: 'tick' } }),
  });
}

export type TestStore = ReturnType<typeof makeStore>;

/** The characters React writes as entities in markup. */
const MARKUP_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
};

/** What a toast shows: its text, or its element rendered through the catalogue. */
export function toastText(
  message: unknown,
  locale: AppLocale,
  messages: AbstractIntlMessages,
): string {
  if (!isValidElement(message)) return String(message);
  const markup = renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {message}
    </NextIntlClientProvider>,
  );
  return markup.replace(
    /&(?:amp|lt|gt|quot|#x27);/g,
    (entity) => MARKUP_ENTITIES[entity] ?? entity,
  );
}

export type MessageFormatter = (key: string, values?: Record<string, string | number>) => string;

/** Formats a catalogue message with the library, not with the code under test. */
export function formatter(locale: AppLocale, messages: AbstractIntlMessages): MessageFormatter {
  return createTranslator({ locale, messages }) as MessageFormatter;
}

/** Renders a form in the app's store and a catalogue, and resolves what it should show. */
export async function renderForm(locale: AppLocale, form: ReactElement, store = makeStore()) {
  const messages = await loadMessages(locale);
  const view = render(
    <Provider store={store}>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        {form}
      </NextIntlClientProvider>
    </Provider>,
  );
  const shown = (calls: unknown[][]) =>
    calls.map(([message]) => toastText(message, locale, messages));
  return {
    unmount: view.unmount,
    store,
    message: (key: string) => lookupMessage(messages, key),
    /** A catalogue message with its arguments filled in. */
    format: formatter(locale, messages),
    fieldMessage: lookupMessage(messages, 'errors.codes.INVALID_INPUT'),
    generalMessage: lookupMessage(messages, 'errors.codes.VALIDATION_ERROR'),
    /** The text of every error toast raised so far. The test file mocks `sonner`. */
    errorToasts: () => shown(vi.mocked(sonnerToast.error).mock.calls),
    successToasts: () => shown(vi.mocked(sonnerToast.success).mock.calls),
  };
}

/** Text of the elements a field points at through `aria-describedby`. */
export function descriptions(field: HTMLElement): string[] {
  return (field.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .filter((text): text is string => typeof text === 'string');
}

function describeFailure(kind: string, reason: unknown): string {
  if (reason instanceof Error) return `${kind}: ${reason.name}: ${reason.message}`;
  return `${kind}: ${JSON.stringify(reason)}`;
}

/**
 * Registers the setup and cleanup every form test in this style needs. A test
 * fails on what the development overlay reports in a browser: a promise that
 * rejects with nobody handling it, an error that reaches the window, and a
 * call to `console.error`. A test that expects the query layer to log says so
 * with `expectConsoleError`, and then fails if that log does not appear.
 */
export function registerFormTestLifecycle() {
  const unhandled: string[] = [];
  const expectedLogs: RegExp[] = [];
  let restoreConsoleError = () => {};
  const onRejection = (reason: unknown) => {
    unhandled.push(describeFailure('unhandled rejection', reason));
  };
  const onWindowRejection = (event: PromiseRejectionEvent) => onRejection(event.reason);
  const onWindowError = (event: ErrorEvent) => {
    unhandled.push(describeFailure('uncaught error', event.error ?? event.message));
  };
  const onConsoleError = (...logged: unknown[]) => {
    unhandled.push(`console.error: ${logged.map(String).join(' ')}`);
  };

  beforeEach(() => {
    unhandled.length = 0;
    expectedLogs.length = 0;
    process.on('unhandledRejection', onRejection);
    window.addEventListener('unhandledrejection', onWindowRejection);
    window.addEventListener('error', onWindowError);
    const spy = vi.spyOn(console, 'error').mockImplementation(onConsoleError);
    restoreConsoleError = () => spy.mockRestore();
  });

  afterEach(async () => {
    cleanup();
    // A rejection is reported as unhandled once the pending work has run.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    process.off('unhandledRejection', onRejection);
    window.removeEventListener('unhandledrejection', onWindowRejection);
    window.removeEventListener('error', onWindowError);
    restoreConsoleError();
    clearBrowserProof();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    const expected = (entry: string) => expectedLogs.some((pattern) => pattern.test(entry));
    expect({
      unexpected: unhandled.filter((entry) => !expected(entry)),
      missing: expectedLogs
        .filter((pattern) => !unhandled.some((entry) => pattern.test(entry)))
        .map(String),
    }).toEqual({ unexpected: [], missing: [] });
  });

  return {
    /** Declares a `console.error` this test must produce. */
    expectConsoleError: (pattern: RegExp) => {
      expectedLogs.push(pattern);
    },
  };
}
