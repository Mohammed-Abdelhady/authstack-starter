// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { API_PATHS, BROWSER_PROOF_PATHS, type User } from '@app/sdk';
import { ErrorCode } from '@app/core';
import { baseApi } from '@/store/api/baseApi';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import { authApi } from '@/modules/auth/store/authApi';
import { storeSignedInAs } from '@/tests/signedIn';
import {
  identitySuccess,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { DeleteAccountCard } from '../DeleteAccountCard';

registerFormTestLifecycle();
const ID = {
  OPEN: 'account-deletion-open',
  CONFIRM: 'account-deletion-confirm',
  PROOF: 'invitation-proof-send',
  SEND: 'invitation-proof-send',
  CODE: 'invitation-proof-code',
  VERIFY: 'invitation-proof-verify',
  CANCEL: 'invitation-proof-cancel',
};
const PROVED_AT = '2026-01-01T00:00:00.000Z';
const ACTOR = {
  id: 'actor-user',
  email: 'user@example.com',
  name: 'Signed In',
  role: 'user',
  permissions: [],
  locale: 'en',
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false, // feature:totp
  passkeyCount: 0, // feature:passkeys
  linkedProviders: [],
} satisfies User;
function requiredProof() {
  return refusalWith(401, ErrorCode.REAUTH_REQUIRED, {
    required: 'fresh_proof',
    methods: ['email-code'],
  });
}
function heldReply() {
  let release = () => {};
  const response = new Promise<Response>((resolve) => {
    release = () => resolve(success({ message: 'Deleted' }));
  });
  return { response, release: () => release() };
}
async function startDeletion(subscribeIdentity = false) {
  const store = storeSignedInAs('user');
  const identity = subscribeIdentity
    ? store.dispatch(authApi.endpoints.getIdentity.initiate())
    : undefined;
  if (identity) await identity.unwrap();
  const view = await renderForm('en', <DeleteAccountCard />, store);
  fireEvent.click(screen.getByTestId(ID.OPEN));
  fireEvent.click(screen.getByTestId(ID.CONFIRM));
  await screen.findByTestId(ID.PROOF);
  return {
    ...view,
    unmount: () => {
      identity?.unsubscribe();
      view.unmount();
    },
  };
}
async function submitProof() {
  fireEvent.click(screen.getByTestId(ID.SEND));
  const code = await screen.findByTestId(ID.CODE);
  await waitFor(() =>
    expect(screen.getByTestId(ID.SEND).getAttribute('aria-disabled')).not.toBe('true'),
  );
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.click(screen.getByTestId(ID.VERIFY));
}

describe('own-account deletion proof continuation', () => {
  it('keeps proof in the subscribed session until deletion commits', async () => {
    const held = heldReply();
    let deletes = 0;
    let verifies = 0;
    const requests = stubNetwork((_request, path) => {
      if (path === API_PATHS.accountDeletion.account) {
        deletes += 1;
        return deletes === 1 ? requiredProof() : held.response;
      }
      if (path === BROWSER_PROOF_PATHS.code) return Response.json({ expiresInMinutes: 10 });
      if (path === BROWSER_PROOF_PATHS.verifyCode) {
        verifies += 1;
        return verifies === 1
          ? refusalWith(401, ErrorCode.ACTIVATION_CODE_INVALID)
          : Response.json({ provedAt: PROVED_AT });
      }
      if (path === API_PATHS.auth.identity) return identitySuccess(deletes < 2 ? ACTOR : null);
      throw new Error('Unexpected deletion proof request');
    });
    const view = await startDeletion(true);
    const generation = view.store.getState().auth.sessionGeneration;
    try {
      expect(deletes).toBe(1);
      expect(requests.filter((name) => name === `GET ${API_PATHS.auth.identity}`)).toHaveLength(1);
      expect(screen.getByTestId(ID.CONFIRM).getAttribute('aria-disabled')).toBe('true');
      await submitProof();
      await waitFor(() =>
        expect(screen.getByTestId(ID.VERIFY).getAttribute('aria-disabled')).not.toBe('true'),
      );
      expect(deletes).toBe(1);
      expect(view.store.getState().auth.sessionGeneration).toBe(generation);
      fireEvent.click(screen.getByTestId(ID.VERIFY));
      await waitFor(() => expect(deletes).toBe(2));
      expect(screen.getByTestId(ID.CONFIRM).getAttribute('aria-disabled')).toBe('true');
      expect(requests.filter((name) => name === `GET ${API_PATHS.auth.identity}`)).toHaveLength(1);
      held.release();
      await waitFor(() =>
        expect(requests.filter((name) => name === `GET ${API_PATHS.auth.identity}`)).toHaveLength(
          2,
        ),
      );
    } finally {
      held.release();
      view.unmount();
      view.store.dispatch(baseApi.util.resetApiState());
    }
  });

  it('refetches subscribed identity when the final deletion answer is lost', async () => {
    let deletes = 0;
    const requests = stubNetwork((_request, path) => {
      if (path === API_PATHS.accountDeletion.account) {
        deletes += 1;
        if (deletes === 1) return requiredProof();
        return Promise.reject(new TypeError('Request interrupted'));
      }
      if (path === BROWSER_PROOF_PATHS.code) return Response.json({ expiresInMinutes: 10 });
      if (path === BROWSER_PROOF_PATHS.verifyCode) return Response.json({ provedAt: PROVED_AT });
      if (path === API_PATHS.auth.identity) return identitySuccess(deletes < 2 ? ACTOR : null);
      throw new Error('Unexpected deletion outcome request');
    });
    const view = await startDeletion(true);
    try {
      await submitProof();
      await waitFor(() =>
        expect(requests.filter((name) => name === `GET ${API_PATHS.auth.identity}`)).toHaveLength(
          2,
        ),
      );
      expect(deletes).toBe(2);
    } finally {
      view.unmount();
      view.store.dispatch(baseApi.util.resetApiState());
    }
  });

  it('cancels proof without retrying deletion or claiming success', async () => {
    let deletes = 0;
    stubNetwork((_request, path) => {
      if (path === API_PATHS.accountDeletion.account) {
        deletes += 1;
        return requiredProof();
      }
      throw new Error('Unexpected canceled-proof request');
    });
    const view = await startDeletion();
    try {
      fireEvent.click(screen.getByTestId(ID.CANCEL));
      expect(screen.queryByTestId(ID.PROOF)).toBeNull();
      expect(screen.getByTestId(ID.CONFIRM).getAttribute('aria-disabled')).not.toBe('true');
      expect(deletes).toBe(1);
    } finally {
      view.unmount();
      view.store.dispatch(baseApi.util.resetApiState());
    }
  });

  it.each(['session change', 'unmount'] as const)(
    'cannot resume an abandoned proof after %s',
    async (departure) => {
      let release = () => {};
      const response = new Promise<Response>((resolve) => {
        release = () => resolve(Response.json({ provedAt: PROVED_AT }));
      });
      let deletes = 0;
      let verifies = 0;
      stubNetwork((_request, path) => {
        if (path === API_PATHS.accountDeletion.account) {
          deletes += 1;
          return requiredProof();
        }
        if (path === BROWSER_PROOF_PATHS.code) return Response.json({ expiresInMinutes: 10 });
        if (path === BROWSER_PROOF_PATHS.verifyCode) {
          verifies += 1;
          return response;
        }
        throw new Error('Unexpected abandoned-proof request');
      });
      const view = await startDeletion();
      try {
        await submitProof();
        await waitFor(() => expect(verifies).toBe(1));
        if (departure === 'unmount') view.unmount();
        else
          act(() =>
            view.store.dispatch(
              loginFulfilled({
                id: 'next-user',
                email: 'next@example.test',
                name: 'Next',
                role: 'user',
                permissions: [],
              }),
            ),
          );
        await act(async () => {
          release();
          await response;
        });
        expect(deletes).toBe(1);
      } finally {
        release();
        view.unmount();
        view.store.dispatch(baseApi.util.resetApiState());
      }
    },
  );
});
