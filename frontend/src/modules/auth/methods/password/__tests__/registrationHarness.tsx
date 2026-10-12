import * as React from 'react';
import { vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import type { User } from '@app/sdk';
import { renderForm, success, stubNetwork } from '@/tests/serverRejectionHarness';
import { ActivationForm } from '@/modules/auth/components/ActivationForm';

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: '',
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => navigation,
  Link: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('a', props, children),
}));
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

export const SIGNED_IN_USER: User = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false,
  passkeyCount: 0,
  linkedProviders: ['email'],
};
export const NATIVE_CONTINUATION = '/auth/native/authorize?transaction=txn-1';
export const ACTIVATION_BODY = {
  email: 'layla@example.com',
  code: '000000',
  name: 'Layla Haddad',
  password: 'Passw0rdLayla',
};
export const AUTH_METHODS = {
  methods: { password: true, magicLink: false, passkeys: false, oauth: [] },
};

export function change(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

export function fillActivation(password = 'Passw0rdLayla', name = 'Layla Haddad') {
  const email = screen.getByTestId('activate-email-input');
  if (!email.hasAttribute('readonly')) change('activate-email-input', 'layla@example.com');
  change('activate-code-input', '000000');
  change('activate-name-input', name);
  change('activate-password-input', password);
  change('activate-confirm-password-input', password);
}

export async function submitActivation(locale: AppLocale) {
  const form = await renderForm(locale, <ActivationForm />);
  fillActivation();
  fireEvent.submit(screen.getByTestId('activate-form'));
  return form;
}

export function acceptActivation(bodies: unknown[]) {
  return stubNetwork(async (request, path) => {
    if (path === '/api/auth/methods') return success(AUTH_METHODS);
    if (request.method === 'POST') {
      bodies.push(await request.json());
      return success({ requiresTwoFactor: false, user: SIGNED_IN_USER });
    }
    return success(SIGNED_IN_USER);
  });
}

export { navigation };
