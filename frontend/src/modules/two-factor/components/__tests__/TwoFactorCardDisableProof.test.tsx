// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { API_PATHS } from '@app/sdk';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { TWO_FACTOR_PATHS } from '../../constants';
import { TwoFactorCard } from '../TwoFactorCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const PROFILE = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  twoFactorEnabled: true,
  linkedProviders: ['email'],
};
const METHODS = {
  methods: { password: true, magicLink: false, twoFactor: true, passkeys: false, oauth: [] },
};

registerFormTestLifecycle();

it('derives password proof from the account and sends it with the second-factor code', async () => {
  let requestBody: unknown;
  const requests = stubNetwork(async (request, path) => {
    if (path === API_PATHS.auth.methods) return success(METHODS);
    if (path === API_PATHS.user.profile) return success(PROFILE);
    if (path === TWO_FACTOR_PATHS.DISABLE) {
      requestBody = await request.json();
      return success({ message: 'disabled' });
    }
    return success({});
  });
  await renderForm('en', <TwoFactorCard />);

  fireEvent.click(await screen.findByTestId('two-factor-disable-open'));
  const password = await screen.findByTestId('two-factor-disable-password');
  expect(password.hasAttribute('required')).toBe(true);
  fireEvent.change(password, { target: { value: 'Passw0rdLayla' } });
  const code = await screen.findByTestId('two-factor-code-input');
  expect(code.hasAttribute('required')).toBe(true);
  fireEvent.change(code, {
    target: { value: '123456' },
  });
  fireEvent.submit(screen.getByTestId('two-factor-disable-form'));

  await waitFor(() => expect(screen.queryByTestId('two-factor-disable-dialog')).toBeNull());
  expect(requestBody).toEqual({ password: 'Passw0rdLayla', code: '123456' });
  expect(requests).toContain(`POST ${TWO_FACTOR_PATHS.DISABLE}`);
});
