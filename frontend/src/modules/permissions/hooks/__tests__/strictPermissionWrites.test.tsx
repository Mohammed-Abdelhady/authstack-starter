// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { permissionsApi } from '../../api/permissionsApi';
import { useUserPermissionMutations } from '../useUserPermissionMutations';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import { heldAnswer } from '@/tests/busyControls';
import {
  makeStore,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';

registerFormTestLifecycle();
const USER_ID = 'target';
const READ = 'profile:read:own';
const UPDATE = 'profile:update:own';

function signedIn(store: ReturnType<typeof makeStore>, id: string) {
  store.dispatch(
    loginFulfilled({
      id,
      email: `${id}@example.test`,
      name: id,
      role: 'admin',
      permissions: ['*'],
    }),
  );
}

async function openPermissions(options: {
  version?: number;
  respond: (request: Request) => Response | Promise<Response>;
}) {
  const writes: Array<{ method: string; version: unknown }> = [];
  stubNetwork(async (request) => {
    if (request.method === 'GET')
      return success({
        userId: USER_ID,
        role: 'user',
        permissions: [],
        ...(options.version === undefined ? {} : { version: options.version }),
      });
    const version =
      request.method === 'DELETE'
        ? new URL(request.url).searchParams.get('version')
        : ((await request.clone().json()) as { version?: unknown }).version;
    writes.push({ method: request.method, version });
    return options.respond(request);
  });
  const store = makeStore();
  signedIn(store, 'actor');
  const reading = store.dispatch(permissionsApi.endpoints.getUserPermissions.initiate(USER_ID));
  const listed = await reading.unwrap();
  reading.unsubscribe();
  const onAdded = vi.fn();
  const onAddError = vi.fn();
  const refetch = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    ({ open, version }: { open: boolean; version: unknown }) =>
      useUserPermissionMutations({
        open,
        userId: USER_ID,
        version,
        refetch,
        onAdded,
        onAddError,
        onRemoved: vi.fn(),
        onRemoveError: vi.fn(),
      }),
    {
      wrapper,
      initialProps: { open: true, version: listed.version },
    },
  );
  return { ...hook, writes, store, onAdded, onAddError, refetch };
}

it('uses the permission read and each actual write response version for the next grant', async () => {
  let response = 0;
  const view = await openPermissions({
    version: 0,
    respond: () => {
      response += 1;
      return success({ userId: USER_ID, permissions: [], version: response === 1 ? 9 : 12 });
    },
  });
  await act(() => view.result.current.add([READ, UPDATE]));
  expect(view.writes).toEqual([
    { method: 'POST', version: 0 },
    { method: 'POST', version: 9 },
  ]);
  expect(view.onAdded).toHaveBeenCalledWith(2);
  expect(view.onAddError).not.toHaveBeenCalled();
});

it('refuses a legacy response without an observed version before any permission write', async () => {
  const view = await openPermissions({ respond: () => success({}) });
  await act(() => view.result.current.add([READ]));
  expect(view.writes).toEqual([]);
  expect(view.onAddError).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  expect(view.onAdded).not.toHaveBeenCalled();
});

it('surfaces a stale version without fetching a replacement then retrying the write', async () => {
  const view = await openPermissions({
    version: 7,
    respond: () =>
      Response.json(
        {
          success: false,
          error: { code: 'VERSION_CONFLICT' },
        },
        { status: 409 },
      ),
  });
  await act(() => view.result.current.add([READ]));
  expect(view.writes).toEqual([{ method: 'POST', version: 7 }]);
  expect(view.onAddError).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
  expect(view.refetch).not.toHaveBeenCalled();
  expect(view.onAdded).not.toHaveBeenCalled();
});

const PROOF_REQUIRED = () =>
  Response.json(
    {
      success: false,
      error: {
        code: 'REAUTH_REQUIRED',
        details: { required: 'fresh_proof', methods: ['email-code'] },
      },
    },
    { status: 401 },
  );

it('cannot resume a discarded permission intent after its proof callback arrives', async () => {
  const view = await openPermissions({ version: 7, respond: PROOF_REQUIRED });
  await act(() => view.result.current.add([READ]));
  expect(view.result.current.operation.methods).toEqual(['email-code']);
  view.rerender({ open: false, version: 7 });
  view.rerender({ open: true, version: 7 });
  await act(() => view.result.current.operation.proved());
  expect(view.writes).toEqual([{ method: 'POST', version: 7 }]);
  expect(view.onAdded).not.toHaveBeenCalled();
});

it('retains the original observed version through proof even when the view later reads a newer one', async () => {
  let attempt = 0;
  const view = await openPermissions({
    version: 7,
    respond: () => {
      attempt += 1;
      return attempt === 1
        ? PROOF_REQUIRED()
        : Response.json({ success: false, error: { code: 'VERSION_CONFLICT' } }, { status: 409 });
    },
  });
  await act(() => view.result.current.add([READ]));
  view.rerender({ open: true, version: 9 });
  await act(() => view.result.current.operation.proved());
  expect(view.writes).toEqual([
    { method: 'POST', version: 7 },
    { method: 'POST', version: 7 },
  ]);
  expect(view.onAdded).not.toHaveBeenCalled();
  expect(view.onAddError).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
});

it('stops the batch if another account replaces the actor while its first response is pending', async () => {
  const held = heldAnswer();
  const view = await openPermissions({ version: 0, respond: () => held.answer });
  let writing: Promise<void> | undefined;
  try {
    act(() => {
      writing = view.result.current.add([READ, UPDATE]);
    });
    await waitFor(() => expect(view.writes).toHaveLength(1));
    act(() => signedIn(view.store, 'replacement'));
    held.settle(() => success({ userId: USER_ID, permissions: [READ], version: 9 }));
    await act(async () => {
      await writing;
    });
    expect(view.writes).toEqual([{ method: 'POST', version: 0 }]);
    expect(view.onAdded).not.toHaveBeenCalled();
  } finally {
    held.settle(() => success({ userId: USER_ID, permissions: [READ], version: 9 }));
    await writing;
  }
});

it('shares one exclusion boundary between add and remove before React can render busy state', async () => {
  const held = heldAnswer();
  const view = await openPermissions({ version: 0, respond: () => held.answer });
  let adding: Promise<void> | undefined;
  try {
    act(() => {
      adding = view.result.current.add([READ]);
      void view.result.current.remove(UPDATE);
    });
    await waitFor(() => expect(view.writes).toHaveLength(1));
    held.settle(() => success({ userId: USER_ID, permissions: [READ], version: 9 }));
    await act(async () => {
      await adding;
    });
    expect(view.writes).toEqual([{ method: 'POST', version: 0 }]);
  } finally {
    held.settle(() => success({ userId: USER_ID, permissions: [READ], version: 9 }));
    await adding;
  }
});

it('refreshes and stops after an unknown grant outcome without sending the next grant', async () => {
  const view = await openPermissions({
    version: 0,
    respond: () => {
      throw new TypeError('network');
    },
  });
  await act(() => view.result.current.add([READ, UPDATE]));
  expect(view.writes).toEqual([{ method: 'POST', version: 0 }]);
  expect(view.refetch).toHaveBeenCalledOnce();
  expect(view.onAdded).not.toHaveBeenCalled();
  expect(view.onAddError).toHaveBeenCalledOnce();
});
