// @vitest-environment jsdom
import {
  ACTIVATION_BODY,
  AUTH_METHODS,
  NATIVE_CONTINUATION,
  SIGNED_IN_USER,
  acceptActivation,
  change,
  fillActivation,
  navigation,
  submitActivation,
} from './registrationHarness';
import * as React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
  refusalWith,
} from '@/tests/serverRejectionHarness';
import { RegisterForm } from '../RegisterForm';
import { ActivationForm } from '@/modules/auth/components/ActivationForm';
import { LoginForm } from '@/modules/auth/components/LoginForm';

registerFormTestLifecycle();
beforeEach(() => {
  navigation.search = '';
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('registration contract in %s', (locale) => {
  it('sends only email and hands the returned address and validated continuation to activation', async () => {
    navigation.search = 'redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1';
    const bodies: unknown[] = [];
    stubNetwork(async (request, path) => {
      if (path === '/api/auth/register') {
        bodies.push(await request.json());
        return success({ email: 'confirmed@example.com' });
      }
      if (path === '/api/auth/activate') {
        bodies.push(await request.json());
        return success({ requiresTwoFactor: false, user: SIGNED_IN_USER });
      }
      return success(AUTH_METHODS);
    });
    const form = await renderForm(locale, <RegisterForm />);
    expect(
      screen.getByRole('link', { name: form.message('auth.register.signIn') }).getAttribute('href'),
    ).toBe('/auth/login?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1');
    change('register-email-input', '  LAYLA@example.com  ');
    fireEvent.submit(screen.getByTestId('register-form'));
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        '/auth/activate?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1',
      ),
    );
    expect(bodies).toEqual([{ email: 'layla@example.com' }]);
    expect(form.successToasts()).toEqual([form.message('toast.success.registrationSuccess')]);
    form.unmount();
    await renderForm(locale, <ActivationForm />, form.store);
    expect(screen.getByText(form.message('auth.activate.description'))).toBeTruthy();
    const email = screen.getByTestId('activate-email-input');
    expect(email).toHaveProperty('value', 'confirmed@example.com');
    expect(email).toHaveProperty('readOnly', true);
    fillActivation();
    fireEvent.submit(screen.getByTestId('activate-form'));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(NATIVE_CONTINUATION));
    expect(bodies).toEqual([
      { email: 'layla@example.com' },
      {
        email: 'confirmed@example.com',
        code: '000000',
        name: 'Layla Haddad',
        password: 'Passw0rdLayla',
      },
    ]);
  });

  it('preserves the continuation on the sign-up link', async () => {
    navigation.search = 'redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1';
    stubNetwork(() => success(AUTH_METHODS));
    const form = await renderForm(locale, <LoginForm />);
    const link = await screen.findByRole('link', { name: form.message('auth.login.signUp') });
    expect(link.getAttribute('href')).toBe(
      '/auth/register?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1',
    );
  });

  it('submits all four activation fields and excludes confirmation', async () => {
    const bodies: unknown[] = [];
    acceptActivation(bodies);
    await submitActivation(locale);
    await waitFor(() => expect(bodies).toEqual([ACTIVATION_BODY]));
    expect(navigation.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('hands a second-factor response with null user to the challenge with its continuation', async () => {
    navigation.search = 'redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1';
    stubNetwork(() => success({ requiresTwoFactor: true, user: null }));
    await submitActivation(locale);
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        '/auth/2fa?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1',
      ),
    );
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('offers sign-in for a committed account and later completes its native continuation', async () => {
    navigation.search = 'redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1';
    const requests = stubNetwork((_, path) =>
      success(
        path === '/api/auth/activate'
          ? { requiresTwoFactor: false, mustSignIn: true, user: null }
          : path === '/api/auth/methods'
            ? AUTH_METHODS
            : { requiresTwoFactor: false, user: SIGNED_IN_USER },
      ),
    );
    const form = await submitActivation(locale);
    const notice = await screen.findByRole('status');
    expect(notice.textContent).toBe(form.message('auth.activate.signInRequired'));
    const link = screen.getByRole('link', { name: form.message('auth.activate.signIn') });
    expect(link.getAttribute('href')).toBe(
      '/auth/login?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1',
    );
    expect(requests).toEqual(['POST /api/auth/activate']);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(form.successToasts()).toEqual([]);
    navigation.search = new URL(link.getAttribute('href') ?? '', 'https://example.test').search;
    form.unmount();
    await renderForm(locale, <LoginForm />, form.store);
    await screen.findByTestId('login-email-input');
    change('login-email-input', 'layla@example.com');
    change('login-password-input', 'Passw0rdLayla');
    fireEvent.submit(screen.getByTestId('login-form'));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/auth/native/authorize?transaction=txn-1'),
    );
    expect(requests).toEqual([
      'POST /api/auth/activate',
      'GET /api/auth/methods',
      'POST /api/auth/login',
    ]);
  });

  it('drops an unsafe continuation before navigating from registration', async () => {
    navigation.search = 'redirect=javascript%3Aalert(1)';
    stubNetwork((_, path) =>
      success(path === '/api/auth/register' ? { email: 'layla@example.com' } : AUTH_METHODS),
    );
    await renderForm(locale, <RegisterForm />);
    change('register-email-input', 'layla@example.com');
    fireEvent.submit(screen.getByTestId('register-form'));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/auth/activate'));
  });

  it('shows the stable outdated-contract catalogue message and keeps the address', async () => {
    stubNetwork((_, path) =>
      path === '/api/auth/register'
        ? refusalWith(400, ErrorCode.REGISTRATION_CONTRACT_OUTDATED)
        : success(AUTH_METHODS),
    );
    const form = await renderForm(locale, <RegisterForm />);
    change('register-email-input', 'layla@example.com');
    fireEvent.submit(screen.getByTestId('register-form'));
    await waitFor(() =>
      expect(screen.getByTestId('register-error').textContent).toBe(
        form.message('errors.codes.REGISTRATION_CONTRACT_OUTDATED'),
      ),
    );
    expect(screen.getByTestId('register-email-input')).toHaveProperty('value', 'layla@example.com');
  });

  it.each(['', 'invalid'])(
    'does not send registration with an invalid address %s',
    async (value) => {
      const requests = stubNetwork(() => success(AUTH_METHODS));
      await renderForm(locale, <RegisterForm />);
      change('register-email-input', value);
      fireEvent.submit(screen.getByTestId('register-form'));
      await waitFor(() =>
        expect(screen.getByTestId('register-email-input').getAttribute('aria-invalid')).toBe(
          'true',
        ),
      );
      expect(requests).not.toContain('POST /api/auth/register');
    },
  );
});
