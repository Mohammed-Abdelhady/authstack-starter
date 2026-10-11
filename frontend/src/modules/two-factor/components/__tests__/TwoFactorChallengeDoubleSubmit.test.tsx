// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { submitTwiceInOneTick, writesOf } from '@/modules/auth/__tests__/submitTwice';
import { TwoFactorChallengePanel } from '../TwoFactorChallengePanel';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => navigation,
  Link: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement('a', props, children),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
};

registerFormTestLifecycle();

describe('two-factor challenge', () => {
  it('answers once when the form is submitted twice in one tick', async () => {
    const requests = stubNetwork((request) =>
      request.method === 'POST'
        ? success({ requiresTwoFactor: false, user: USER })
        : success({ methods: { password: true, magicLink: false, passkeys: false, oauth: [] } }),
    );
    const { message } = await renderForm('en', <TwoFactorChallengePanel redirect={null} />);
    fireEvent.change(screen.getByRole('textbox', { name: message('auth.twoFactor.code') }), {
      target: { value: '123456' },
    });

    submitTwiceInOneTick(screen.getByTestId('two-factor-form'));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'));
    expect(writesOf(requests)).toEqual(['POST /api/auth/2fa/verify']);
  });
});
