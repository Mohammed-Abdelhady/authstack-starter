// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@app/core';
import { baseApi } from '@/store/api/baseApi';
import { showsOwnRefusal } from '@/lib/refusal';
import { usersApi } from '@/modules/users/api/usersApi';
import { storeSignedInAs } from '@/tests/signedIn';
import {
  identitySuccess,
  refusalWith,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { useStaffOperation } from '../hooks/useStaffOperation';
import { freshProofApi } from '../api/freshProofApi';
import { loginFulfilled } from '../store/authSlice';

registerFormTestLifecycle();

const TARGET = 'staff-target';
const STATUS_PATH = `/api/admin/users/${TARGET}/status`;
const USER_PATH = `/api/admin/users/${TARGET}`;
const IDENTITY_PATH = '/api/auth/identity';
const VERIFY_PATH = '/api/auth/proof/code/verify';
const SAVED = { id: TARGET, isDeleted: true, version: 8 };

function setupOperation() {
  const store = storeSignedInAs('admin', ['*']);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(useStaffOperation, { wrapper });
  const write = () =>
    showsOwnRefusal(
      store.dispatch(
        usersApi.endpoints.updateUserStatus.initiate({
          userId: TARGET,
          isActive: false,
          version: 7,
        }),
      ),
    ).unwrap();
  const close = () => {
    hook.unmount();
    store.dispatch(baseApi.util.resetApiState());
  };
  return { ...hook, store, write, close };
}

function holdResponse() {
  let release = () => {};
  const response = new Promise<Response>((resolve) => {
    release = () => resolve(success(SAVED));
  });
  return { response, release: () => release() };
}

describe('staff proof transport handoffs', () => {
  it('keeps a pending write and its session through expected proof refusals', async () => {
    const bodies: unknown[] = [];
    let verifies = 0;
    const requests = stubNetwork(async (request, path) => {
      if (path === STATUS_PATH) {
        bodies.push(await request.json());
        return bodies.length === 1
          ? refusalWith(401, ErrorCode.REAUTH_REQUIRED, {
              required: 'fresh_proof',
              methods: ['email-code'],
            })
          : success(SAVED);
      }
      if (path === VERIFY_PATH) {
        verifies += 1;
        return verifies === 1
          ? refusalWith(401, ErrorCode.ACTIVATION_CODE_INVALID)
          : Response.json({ provedAt: '2099-01-01T00:00:00.000Z' });
      }
      if (path === IDENTITY_PATH) return identitySuccess(null);
      throw new Error('Unexpected proof transport request');
    });
    const operation = setupOperation();
    const generation = operation.store.getState().auth.sessionGeneration;
    let completed = 0;
    try {
      await act(async () => {
        await operation.result.current.start({
          run: operation.write,
          onSuccess: () => {
            completed += 1;
          },
        });
      });
      expect(operation.result.current.methods).toEqual(['email-code']);
      expect(completed).toBe(0);
      const wrong = operation.store.dispatch(
        freshProofApi.endpoints.verifyInvitationProofCode.initiate({ code: '111111' }),
      );
      try {
        await expect(wrong.unwrap()).rejects.toMatchObject({ status: 'CUSTOM_ERROR' });
      } finally {
        wrong.reset();
      }
      expect(operation.result.current.methods).toEqual(['email-code']);
      expect(operation.store.getState().auth.sessionGeneration).toBe(generation);
      const correct = operation.store.dispatch(
        freshProofApi.endpoints.verifyInvitationProofCode.initiate({ code: '222222' }),
      );
      try {
        await correct.unwrap();
      } finally {
        correct.reset();
      }
      await act(async () => {
        await operation.result.current.proved();
      });
      expect(completed).toBe(1);
      expect(bodies).toEqual([
        { isActive: false, version: 7 },
        { isActive: false, version: 7 },
      ]);
      expect(operation.store.getState().auth.sessionGeneration).toBe(generation);
      expect(requests.filter((request) => request === `GET ${IDENTITY_PATH}`)).toEqual([]);
    } finally {
      operation.close();
    }
  });

  it('keeps ordinary authentication refusal on the real identity expiry path', async () => {
    const requests = stubNetwork((_request, path) => {
      if (path === VERIFY_PATH) return refusalWith(401, ErrorCode.SESSION_EXPIRED);
      if (path === IDENTITY_PATH) return identitySuccess(null);
      throw new Error('Unexpected expiry request');
    });
    const operation = setupOperation();
    const generation = operation.store.getState().auth.sessionGeneration;
    const call = operation.store.dispatch(
      freshProofApi.endpoints.verifyInvitationProofCode.initiate({ code: '111111' }),
    );
    try {
      await expect(call.unwrap()).rejects.toMatchObject({ status: 401 });
      await waitFor(() => expect(operation.store.getState().auth.isAuthenticated).toBe(false));
      expect(operation.store.getState().auth.sessionGeneration).toBeGreaterThan(generation);
      expect(requests.filter((request) => request === `GET ${IDENTITY_PATH}`)).toEqual([
        `GET ${IDENTITY_PATH}`,
      ]);
    } finally {
      call.reset();
      operation.close();
    }
  });

  it('returns an unknown outcome for a malformed successful staff reply', async () => {
    const requests = stubNetwork((_request, path) => {
      if (path === STATUS_PATH) return success([]);
      throw new Error('Unexpected malformed-response request');
    });
    const operation = setupOperation();
    let completed = 0;
    let failure: unknown;
    try {
      await act(async () => {
        await operation.result.current.start({
          run: operation.write,
          onSuccess: () => {
            completed += 1;
          },
          onError: (error) => {
            failure = error;
          },
        });
      });
      expect(failure).toMatchObject({ unknownOutcome: true });
      expect(completed).toBe(0);
      expect(requests).toEqual([`PATCH ${STATUS_PATH}`]);
    } finally {
      operation.close();
    }
  });

  it('excludes a second start while the original proof retry is held', async () => {
    const held = holdResponse();
    let writes = 0;
    stubNetwork((_request, path) => {
      if (path !== STATUS_PATH) throw new Error('Unexpected held-retry request');
      writes += 1;
      return writes === 1
        ? refusalWith(401, ErrorCode.REAUTH_REQUIRED, {
            required: 'fresh_proof',
            methods: ['email-code'],
          })
        : held.response;
    });
    const operation = setupOperation();
    let completed = 0;
    let retry: Promise<void> | undefined;
    try {
      await act(async () => {
        await operation.result.current.start({
          run: operation.write,
          onSuccess: () => {
            completed += 1;
          },
        });
      });
      act(() => {
        retry = operation.result.current.proved();
      });
      await waitFor(() => expect(writes).toBe(2));
      await act(async () => {
        await operation.result.current.start({
          run: operation.write,
          onSuccess: () => {
            completed += 1;
          },
        });
      });
      expect(writes).toBe(2);
      held.release();
      await act(async () => {
        await retry;
      });
      expect(completed).toBe(1);
    } finally {
      held.release();
      await Promise.allSettled(retry ? [retry] : []);
      operation.close();
    }
  });

  it('abandons a held old-session write and releases the current view for a new operation', async () => {
    const held = holdResponse();
    let writes = 0;
    stubNetwork((_request, path) => {
      if (path !== STATUS_PATH) throw new Error('Unexpected switched-session request');
      writes += 1;
      return writes === 1 ? held.response : success(SAVED);
    });
    const operation = setupOperation();
    let oldCompleted = 0;
    let newCompleted = 0;
    let first: Promise<void> | undefined;
    try {
      act(() => {
        first = operation.result.current.start({
          run: operation.write,
          onSuccess: () => {
            oldCompleted += 1;
          },
        });
      });
      await waitFor(() => expect(writes).toBe(1));
      act(() => {
        operation.store.dispatch(
          loginFulfilled({
            id: 'next-admin',
            email: 'next@example.test',
            name: 'Next',
            role: 'admin',
            permissions: ['*'],
          }),
        );
      });
      expect(operation.result.current.methods).toBeNull();
      held.release();
      await act(async () => {
        await first;
      });
      expect(oldCompleted).toBe(0);
      expect(operation.result.current.busy).toBe(false);
      await act(async () => {
        await operation.result.current.start({
          run: operation.write,
          onSuccess: () => {
            newCompleted += 1;
          },
        });
      });
      expect(newCompleted).toBe(1);
      expect(writes).toBe(2);
    } finally {
      held.release();
      await Promise.allSettled(first ? [first] : []);
      operation.close();
    }
  });

  it('holds async refusal through a real user refetch', async () => {
    const held = holdResponse();
    const activity = { writes: 0, reads: 0 };
    const failures: unknown[] = [];
    stubNetwork((_request, path) => {
      if (path === STATUS_PATH) {
        activity.writes += 1;
        return refusalWith(403, ErrorCode.FORBIDDEN);
      }
      if (path === USER_PATH) {
        activity.reads += 1;
        return activity.reads === 1 ? success(SAVED) : held.response;
      }
      throw new Error('Unexpected staff reconciliation request');
    });
    const operation = setupOperation();
    const attempt = { run: operation.write, onSuccess: () => undefined };
    const reading = operation.store.dispatch(usersApi.endpoints.getUserById.initiate(TARGET));
    let first: Promise<void> | undefined;
    let errorFlight: Promise<void> | undefined;
    try {
      await reading.unwrap();
      act(() => {
        first = operation.result.current.start({
          ...attempt,
          onError: (error) => {
            errorFlight = reading.refetch().then(() => void failures.push(error));
            return errorFlight;
          },
        });
      });
      await waitFor(() => expect(activity.reads).toBe(2));
      expect(operation.result.current.busy).toBe(true);
      await act(() => operation.result.current.start(attempt));
      expect(activity.writes).toBe(1);
      expect(failures).toEqual([]);
      held.release();
      await act(async () => {
        await first;
      });
      expect(operation.result.current.busy).toBe(false);
      expect(failures).toEqual([expect.objectContaining({ status: 403 })]);
      expect(operation.result.current.error).toBe(failures[0]);
    } finally {
      held.release();
      await Promise.allSettled([first, errorFlight]);
      reading.unsubscribe();
      operation.close();
    }
  });
});
