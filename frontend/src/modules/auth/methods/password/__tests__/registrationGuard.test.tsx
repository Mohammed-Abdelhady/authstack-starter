// @vitest-environment jsdom
import { fillActivation, navigation, SIGNED_IN_USER } from './registrationHarness';
import * as React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ActivationGuard } from '@/components/providers/ActivationGuard';
import { ActivationForm } from '@/modules/auth/components/ActivationForm';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import { availability, IDLE } from '@/tests/busyControls';
import {
  makeStore,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('activation guard in %s', (locale) => {
  it.each([
    ['', [], '/dashboard'],
    ['', ['*'], '/admin/dashboard'],
    [
      'redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1',
      [],
      '/auth/native/authorize?transaction=txn-1',
    ],
  ])(
    'uses the sign-in destination for an existing session %s',
    async (search, permissions, path) => {
      navigation.search = search;
      const requests = stubNetwork(() => success({}));
      const store = makeStore();
      store.dispatch(loginFulfilled({ ...SIGNED_IN_USER, permissions }));
      await renderForm(
        locale,
        <ActivationGuard>
          <ActivationForm />
        </ActivationGuard>,
        store,
      );
      await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(path));
      expect(screen.queryByTestId('activate-submit')).toBeNull();
      expect(requests).toEqual([]);
    },
  );

  it('keeps activation available for a null-user second-factor response', async () => {
    stubNetwork(() => success({ requiresTwoFactor: true, user: null }));
    await renderForm(
      locale,
      <ActivationGuard>
        <ActivationForm />
      </ActivationGuard>,
    );
    fillActivation();
    fireEvent.submit(screen.getByTestId('activate-form'));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/auth/2fa'));
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(availability(screen.getByTestId('activate-submit'))).toEqual(IDLE);
  });
});
