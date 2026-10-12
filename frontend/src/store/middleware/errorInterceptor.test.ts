import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AbstractIntlMessages } from 'next-intl';
import { loadMessages } from '@/i18n/load-messages';
import { toast } from '@/lib/toast';
import { formatter, toastText, type MessageFormatter } from '@/tests/serverRejectionHarness';
import { errorInterceptor } from './errorInterceptor';

vi.mock('@/lib/toast', () => ({ toast: { show: vi.fn(), error: vi.fn() } }));

/** The page a proxy answers with in place of the server's JSON. */
const PROXY_ERROR_PAGE = '<html>proxy error page</html>';

/** Text the server sends. It is English only and must never reach the person. */
const SERVER_TEXT = 'Server sentence in English';

const NEVER_DISMISSED = Infinity;

interface Row {
  name: string;
  /** What the query layer rejected with, or `undefined` for a thrown rejection. */
  payload?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  endpoint?: string;
  signedIn?: boolean;
  /** The catalogue message the person reads, or null when nothing is shown. */
  shows: { key: string; values?: Record<string, number>; duration: number } | null;
  /** Whether the session check is started. */
  checksSession?: boolean;
}

function body(code: string, details?: Record<string, unknown>) {
  return { success: false, error: { code, message: SERVER_TEXT, details } };
}

function html(originalStatus: number) {
  return { status: 'PARSING_ERROR', originalStatus, data: PROXY_ERROR_PAGE, error: 'Bad JSON' };
}

const ROWS: Row[] = [
  {
    name: '400 with a code',
    payload: { status: 400, data: body('VALIDATION_ERROR') },
    shows: { key: 'errors.codes.VALIDATION_ERROR', duration: 5000 },
  },
  {
    name: '400 with a code that takes a number from the details',
    payload: { status: 400, data: body('ROLE_HAS_USERS', { count: 3 }) },
    shows: { key: 'errors.codes.ROLE_HAS_USERS', values: { count: 3 }, duration: 5000 },
  },
  {
    name: '400 with a code whose number is missing',
    payload: { status: 400, data: body('ROLE_HAS_USERS') },
    shows: { key: 'toast.error.validationFailed', duration: 5000 },
  },
  {
    name: '401 on a write while signed in',
    payload: { status: 401, data: body('SESSION_INVALID') },
    endpoint: 'updateProfile',
    signedIn: true,
    shows: null,
    checksSession: true,
  },
  {
    name: '401 while signed out',
    payload: { status: 401, data: body('INVALID_CREDENTIALS') },
    endpoint: 'login',
    signedIn: false,
    shows: null,
  },
  {
    name: '401 on the identity check itself',
    payload: { status: 401, data: body('SESSION_INVALID') },
    endpoint: 'getIdentity',
    signedIn: true,
    shows: null,
  },
  {
    name: '401 from a proxy page while signed in',
    payload: html(401),
    endpoint: 'updateProfile',
    signedIn: true,
    shows: null,
    checksSession: true,
  },
  {
    name: '403 with a code',
    payload: { status: 403, data: body('FORBIDDEN') },
    shows: { key: 'errors.codes.FORBIDDEN', duration: 5000 },
  },
  {
    name: '403 without a body',
    payload: { status: 403, data: {} },
    shows: { key: 'toast.error.forbidden', duration: 5000 },
  },
  {
    name: '404 without a code',
    payload: { status: 404, data: { message: SERVER_TEXT } },
    shows: { key: 'toast.error.notFound', duration: 5000 },
  },
  {
    name: '409 with a code',
    payload: { status: 409, data: body('SESSION_LIMIT_REACHED') },
    shows: { key: 'errors.codes.SESSION_LIMIT_REACHED', duration: 5000 },
  },
  {
    name: '409 without a code',
    payload: { status: 409, data: {} },
    shows: { key: 'errors.codes.CONFLICT', duration: 5000 },
  },
  {
    name: '429 with retry-after',
    payload: { status: 429, data: body('RATE_LIMIT_EXCEEDED', { retryAfter: 60 }) },
    shows: { key: 'errors.codes.RATE_LIMIT_EXCEEDED', duration: 5000 },
  },
  {
    name: '500',
    payload: { status: 500, data: body('INTERNAL_ERROR') },
    shows: { key: 'errors.codes.INTERNAL_ERROR', duration: NEVER_DISMISSED },
  },
  {
    name: '503 with a code',
    payload: { status: 503, data: body('AUTHORITY_UNAVAILABLE') },
    shows: { key: 'errors.codes.AUTHORITY_UNAVAILABLE', duration: NEVER_DISMISSED },
  },
  {
    name: 'network failure',
    payload: { status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' },
    shows: { key: 'toast.error.networkError', duration: 10000 },
  },
  {
    name: 'timeout',
    payload: { status: 'TIMEOUT_ERROR', error: 'AbortError: timed out' },
    shows: { key: 'toast.error.timeoutError', duration: 8000 },
  },
  {
    name: '504',
    payload: { status: 504, data: {} },
    shows: { key: 'toast.error.timeoutError', duration: 8000 },
  },
  {
    name: 'aborted',
    payload: { status: 'FETCH_ERROR', error: 'AbortError' },
    meta: { aborted: true },
    shows: null,
  },
  {
    name: 'skipped because the answer was cached',
    meta: { condition: true, rejectedWithValue: false },
    shows: null,
  },
  {
    name: 'parsing error on a successful status',
    payload: html(200),
    shows: null,
  },
  {
    name: 'parsing error without an original status',
    payload: { status: 'PARSING_ERROR', data: '', error: 'Bad JSON' },
    shows: null,
  },
  {
    name: 'parsing error on a proxy 503',
    payload: html(503),
    shows: { key: 'toast.error.serviceUnavailable', duration: NEVER_DISMISSED },
  },
  {
    name: 'parsing error on a proxy 502',
    payload: html(502),
    shows: { key: 'toast.error.badGateway', duration: 5000 },
  },
  {
    name: 'parsing error on a proxy 429',
    payload: html(429),
    shows: { key: 'toast.error.tooManyRequests', duration: 5000 },
  },
  {
    name: 'a code with no catalogue entry',
    payload: { status: 400, data: body('SOMETHING_NEW') },
    shows: { key: 'toast.error.validationFailed', duration: 5000 },
  },
  {
    name: 'a code only the server knows',
    payload: { status: 404, data: body('ROLE_NOT_FOUND') },
    shows: { key: 'toast.error.notFound', duration: 5000 },
  },
  {
    name: 'a rejection that was thrown, not returned',
    meta: { rejectedWithValue: false },
    shows: { key: 'toast.error.unknownError', duration: 5000 },
  },
];

function reject(row: Row) {
  const action = {
    type: 'api/executeMutation/rejected',
    payload: row.payload,
    error: { name: 'Error', message: 'The response is malformed' },
    meta: {
      requestId: 'fixture',
      requestStatus: 'rejected',
      rejectedWithValue: true,
      aborted: false,
      condition: false,
      arg: { endpointName: row.endpoint ?? 'createRole' },
      ...row.meta,
    },
  };
  const next = vi.fn();
  const dispatch = vi.fn();
  errorInterceptor({
    dispatch,
    getState: () => ({ auth: { isAuthenticated: row.signedIn ?? true } }),
  })(next)(action);
  expect(next).toHaveBeenCalledWith(action);
  return dispatch;
}

let messages: AbstractIntlMessages;
let format: MessageFormatter;

beforeAll(async () => {
  messages = await loadMessages('en');
  format = formatter('en', messages);
});

afterEach(() => vi.clearAllMocks());

describe('what a person is told about a rejected request', () => {
  it.each(ROWS)('$name', (row) => {
    const dispatch = reject(row);

    const shown = vi
      .mocked(toast.show)
      .mock.calls.map(([type, message, options]) => [
        type,
        toastText(message, 'en', messages),
        options?.duration,
      ]);
    expect(shown).toEqual(
      row.shows ? [['error', format(row.shows.key, row.shows.values), row.shows.duration]] : [],
    );
    expect(dispatch).toHaveBeenCalledTimes(row.checksSession ? 1 : 0);
  });

  it.each(ROWS.filter((row) => row.shows))('never shows the server text: $name', (row) => {
    reject(row);

    const [, message] = vi.mocked(toast.show).mock.calls[0] ?? [];
    expect(toastText(message, 'en', messages)).not.toContain(SERVER_TEXT);
  });
});
