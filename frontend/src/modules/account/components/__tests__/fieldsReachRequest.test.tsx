// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { fieldNames } from '@/modules/auth/__tests__/fieldNames';
import { UpdateProfileCard } from '../UpdateProfileCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  isVerified: true,
  linkedProviders: ['email'],
};

registerFormTestLifecycle();

describe('every field on the profile form reaches its request', () => {
  it('saves the name that was typed', async () => {
    const writes: Array<[string, unknown]> = [];
    stubNetwork(async (request, path) => {
      if (request.method === 'GET') return success(USER);
      writes.push([`${request.method} ${path}`, await request.json()]);
      return success({ ...USER, name: 'Layla H' });
    });
    const { message } = await renderForm('en', <UpdateProfileCard />);
    const name = await screen.findByRole('textbox', { name: message('settings.profile.name') });
    await waitFor(() => expect(name).toHaveProperty('value', 'Layla Haddad'));
    const form = screen.getByTestId('update-profile-form');
    // The address is shown for reference: it has no name and cannot be edited here.
    expect(fieldNames(form)).toEqual(['name']);
    const email = screen.getByTestId('profile-email-input');
    expect(email).toHaveProperty('readOnly', true);
    expect(email).toHaveProperty('disabled', false);
    email.focus();
    expect(document.activeElement).toBe(email);
    fireEvent.change(name, { target: { value: 'Layla H' } });

    fireEvent.submit(form);

    await waitFor(() => expect(writes).toEqual([['PATCH /api/user/profile', { name: 'Layla H' }]]));
  });
});
