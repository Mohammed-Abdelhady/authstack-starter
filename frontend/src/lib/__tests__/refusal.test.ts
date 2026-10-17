import { describe, expect, it, vi } from 'vitest';
import { errorInterceptor } from '@/store/middleware/errorInterceptor';
import { toast } from '@/lib/toast';
import { isOwnRefusal, refusalMessage, refusedField, showsOwnRefusal } from '../refusal';

vi.mock('@/lib/toast', () => ({ toast: { show: vi.fn(), error: vi.fn() } }));

/** Text the server sends. It is English only and must never be the message. */
const SERVER_TEXT = 'Server sentence in English';

const refused = (status: number, code: string, details?: Record<string, unknown>) => ({
  status,
  data: { success: false, error: { code, message: SERVER_TEXT, details } },
});

describe('refusalMessage', () => {
  it.each([
    [
      'a code the catalogue knows',
      refused(409, 'EMAIL_ALREADY_EXISTS'),
      {
        messageKey: 'errors.codes.EMAIL_ALREADY_EXISTS',
        fallbackKey: 'errors.codes.CONFLICT',
        values: {},
      },
    ],
    [
      'a code with a number in its details',
      refused(400, 'ROLE_HAS_USERS', { count: 3 }),
      {
        messageKey: 'errors.codes.ROLE_HAS_USERS',
        fallbackKey: 'toast.error.validationFailed',
        values: { count: 3 },
      },
    ],
    [
      'a code this build does not know',
      refused(404, 'SOMETHING_NEW'),
      { messageKey: 'toast.error.notFound' },
    ],
    [
      'a status with no body',
      { status: 500, data: undefined },
      {
        messageKey: 'errors.codes.INTERNAL_ERROR',
        fallbackKey: 'toast.error.serverError',
        values: {},
      },
    ],
    [
      'a lost connection',
      { status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' },
      { messageKey: 'toast.error.networkError' },
    ],
    [
      'a timeout',
      { status: 'TIMEOUT_ERROR', error: 'timed out' },
      { messageKey: 'toast.error.timeoutError' },
    ],
    ['a gateway timeout', { status: 504, data: 'x' }, { messageKey: 'toast.error.timeoutError' }],
    ['a thrown error', new Error(SERVER_TEXT), { messageKey: 'toast.error.unknownError' }],
    ['nothing at all', undefined, { messageKey: 'toast.error.unknownError' }],
  ])('names the catalogue message for %s', (_name, error, expected) => {
    expect(refusalMessage(error)).toEqual(expected);
  });
});

describe('refusedField', () => {
  it.each([
    ['EMAIL_ALREADY_EXISTS', 409, 'email'],
    ['ROLE_NAME_TAKEN', 409, 'name'],
    ['INVALID_CURRENT_PASSWORD', 400, 'currentPassword'],
    ['SAME_PASSWORD', 400, 'newPassword'],
  ])('%s names a field', (code, status, field) => {
    expect(refusedField(refused(status, code))).toBe(field);
  });

  it.each([
    ['a refusal about no field', refused(400, 'ROLE_HAS_USERS', { count: 1 })],
    ['a lost connection', { status: 'FETCH_ERROR', error: 'x' }],
    ['a code this build does not know', refused(409, 'SOMETHING_NEW')],
  ])('names none for %s', (_name, error) => {
    expect(refusedField(error)).toBeUndefined();
  });
});

/** A request as the query layer returns it, settled by the test. */
function request(requestId: string) {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  // Nobody awaits it in these tests but the code under test.
  promise.catch(() => undefined);
  return { requestId, unwrap: () => promise, resolve, reject };
}

function rejection(requestId: string) {
  return {
    type: 'api/executeMutation/rejected',
    payload: refused(409, 'EMAIL_ALREADY_EXISTS'),
    error: { message: 'Rejected' },
    meta: {
      requestId,
      requestStatus: 'rejected',
      rejectedWithValue: true,
      aborted: false,
      condition: false,
      arg: { endpointName: 'createUser' },
    },
  };
}

function pass(action: unknown) {
  const next = vi.fn();
  errorInterceptor({ dispatch: vi.fn(), getState: () => ({}) })(next)(action);
  return next;
}

describe('a request whose caller shows its refusal itself', () => {
  it('raises no toast when it is refused, and still reaches the store', () => {
    showsOwnRefusal(request('owned-1'));

    const next = pass(rejection('owned-1'));

    expect(vi.mocked(toast.show).mock.calls).toEqual([]);
    expect(next.mock.calls.length).toBe(1);
  });

  it('leaves the toast of any other request alone', () => {
    vi.mocked(toast.show).mockClear();
    showsOwnRefusal(request('owned-2'));

    pass(rejection('someone-else'));

    expect(vi.mocked(toast.show).mock.calls.length).toBe(1);
  });

  it.each(['resolve', 'reject'] as const)('is forgotten once it %ss', async (ending) => {
    const pending = request(`owned-${ending}`);
    showsOwnRefusal(pending);
    expect(isOwnRefusal(`owned-${ending}`)).toBe(true);

    pending[ending](refused(409, 'EMAIL_ALREADY_EXISTS'));
    await pending.unwrap().catch(() => undefined);
    await Promise.resolve();

    expect(isOwnRefusal(`owned-${ending}`)).toBe(false);
  });
});
