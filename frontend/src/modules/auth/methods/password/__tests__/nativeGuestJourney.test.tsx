// @vitest-environment jsdom
import { navigation, SIGNED_IN_USER, AUTH_METHODS } from './registrationHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ActivationGuard } from '@/components/providers/ActivationGuard';
import { ActivationForm } from '@/modules/auth/components/ActivationForm';
import { loginFulfilled } from '@/modules/auth/store/authSlice';
import {
  makeStore,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { RegisterPage } from '../RegisterPage';
import { ForgotPasswordPage } from '../ForgotPasswordPage';
import { LoginPage } from '@/modules/auth/pages/LoginPage';

const CONTINUATION_QUERY = 'redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-guest';
registerFormTestLifecycle();
beforeEach(() => {
  navigation.push.mockClear();
  navigation.replace.mockClear();
});

function signedInStore() {
  const store = makeStore();
  store.dispatch(loginFulfilled(SIGNED_IN_USER));
  return store;
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('explicit native guest journey in %s', (locale) => {
  it('passes registration output to activation despite the previous signed-in account', async () => {
    navigation.search = `${CONTINUATION_QUERY}&flow=registration`;
    stubNetwork((_request, path) =>
      path === '/api/auth/methods'
        ? success(AUTH_METHODS)
        : path === '/api/auth/register'
          ? success({ email: 'new@example.com' })
          : success({ providers: [] }),
    );
    const store = signedInStore();
    const registration = await renderForm(locale, <RegisterPage />, store);
    const email = await screen.findByTestId('register-email-input');
    fireEvent.change(email, { target: { value: 'new@example.com' } });
    fireEvent.submit(screen.getByTestId('register-form'));
    const expected =
      '/auth/activate?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-guest&flow=registration';
    await waitFor(() => expect(navigation.push).toHaveBeenCalledExactlyOnceWith(expected));
    expect(navigation.replace).not.toHaveBeenCalled();
    const actual: unknown = navigation.push.mock.calls[0]?.[0];
    if (typeof actual !== 'string') throw new Error('No activation navigation');
    navigation.search = actual.slice(actual.indexOf('?') + 1);
    registration.unmount();
    await renderForm(
      locale,
      <ActivationGuard>
        <ActivationForm />
      </ActivationGuard>,
      store,
    );
    expect(await screen.findByTestId('activate-submit')).toBeDefined();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it.each([
    { password: true, linkId: 'signin-link', submitId: 'login-submit' },
    // feature:magic-link:start
    { password: false, linkId: 'register-sign-in-link', submitId: 'magic-link-submit' },
    // feature:magic-link:end
  ])(
    'passes the registration $linkId to fresh login with the previous account present',
    async ({ password, linkId, submitId }) => {
      navigation.search = `${CONTINUATION_QUERY}&flow=registration`;
      stubNetwork((_request, path) =>
        path === '/api/auth/methods'
          ? success({ methods: { ...AUTH_METHODS.methods, password, magicLink: true } })
          : success({ providers: [] }),
      );
      const store = signedInStore();
      const registration = await renderForm(locale, <RegisterPage />, store);
      const link = await screen.findByTestId(linkId);
      const actual = link.getAttribute('href');
      const expected =
        '/auth/login?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-guest&flow=registration';
      expect(actual).toBe(expected);
      if (!actual) throw new Error('No sign-in destination');
      navigation.search = actual.slice(actual.indexOf('?') + 1);
      registration.unmount();
      await renderForm(locale, <LoginPage />, store);
      expect(await screen.findByTestId(submitId)).toBeDefined();
      expect(navigation.replace).not.toHaveBeenCalled();
    },
  );

  it('shows the requested recovery form without logging out an existing session', async () => {
    navigation.search = `${CONTINUATION_QUERY}&flow=recovery`;
    const requests = stubNetwork(() => success({}));
    await renderForm(locale, <ForgotPasswordPage />, signedInStore());
    expect(await screen.findByTestId('forgot-password-submit')).toBeDefined();
    await act(async () => {});
    expect(navigation.push).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('keeps fresh sign-in available after recovery while another browser account exists', async () => {
    navigation.search = `${CONTINUATION_QUERY}&flow=recovery`;
    const requests = stubNetwork((_request, path) =>
      path === '/api/auth/methods' ? success(AUTH_METHODS) : success({ providers: [] }),
    );
    await renderForm(locale, <LoginPage />, signedInStore());
    expect(await screen.findByTestId('login-submit')).toBeDefined();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(requests.every((entry) => entry.startsWith('GET '))).toBe(true);
  });

  it.each([
    '',
    `${CONTINUATION_QUERY}&flow=signIn`,
    'redirect=https%3A%2F%2Fevil.example&flow=registration',
    `${CONTINUATION_QUERY}&flow=registration&flow=registration`,
    'redirect=%2Fdashboard&flow=registration',
  ])('preserves ordinary registration guarding for %s', async (search) => {
    navigation.search = search;
    stubNetwork(() => success({}));
    await renderForm(locale, <RegisterPage />, signedInStore());
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('register-submit')).toBeNull();
  });
});
