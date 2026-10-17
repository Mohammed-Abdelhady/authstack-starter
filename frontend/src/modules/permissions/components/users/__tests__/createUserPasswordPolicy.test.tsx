// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  descriptions,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { CreateUserDialog } from '../CreateUserDialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
registerFormTestLifecycle();
const ROLES = {
  roles: [
    {
      id: 'role-user',
      slug: 'user',
      name: 'User',
      permissions: [],
      isSystemRole: true,
      isProtected: false,
    },
  ],
  total: 1,
  page: 1,
};

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('admin password policy in %s', (locale) => {
  async function submit(password: string) {
    const bodies: unknown[] = [];
    stubNetwork(async (request) => {
      if (request.method === 'GET') return success(ROLES);
      bodies.push(await request.json());
      return success({});
    });
    const form = await renderForm(locale, <CreateUserDialog open onOpenChange={() => undefined} />);
    const role = screen.getByRole('combobox', { name: form.message('users.createUser.role') });
    await waitFor(() => expect(role.matches(':disabled')).toBe(false));
    fireEvent.change(
      screen.getByRole('textbox', { name: form.message('users.createUser.email') }),
      { target: { value: 'layla@example.com' } },
    );
    fireEvent.change(screen.getByRole('textbox', { name: form.message('users.createUser.name') }), {
      target: { value: 'Layla Haddad' },
    });
    const input = screen.getByLabelText(form.message('users.createUser.password'));
    fireEvent.change(input, { target: { value: password } });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: form.message('users.createUser.submit') }),
      );
    });
    return { ...form, bodies, input };
  }

  it.each([
    ['', 'required'],
    ['Aa12345', 'min'],
    ['Aa1😀😀', 'min'],
    ['a1234567', 'uppercase'],
    ['A1234567', 'lowercase'],
    ['Abcdefgh', 'number'],
    ['Aa1' + 'é'.repeat(35), 'tooLong'],
  ])('refuses %s with the shared localized error and no write', async (password, key) => {
    const form = await submit(password);
    expect
      .soft(descriptions(form.input))
      .toEqual([form.message(`auth.passwordRules.errors.${key}`)]);
    expect.soft(form.bodies).toEqual([]);
  });

  it.each([
    ' Aa123456 ',
    'Aa123456',
    'Aa1' + 'é'.repeat(34),
    'Aa1' + 'é'.repeat(34) + 'x',
    'Aa1😀😀x',
  ])('submits a shared-valid password without requiring punctuation %s', async (password) => {
    const { bodies } = await submit(password);
    await waitFor(() =>
      expect(bodies).toEqual([
        { email: 'layla@example.com', name: 'Layla Haddad', password, role: 'user' },
      ]),
    );
  });
});
