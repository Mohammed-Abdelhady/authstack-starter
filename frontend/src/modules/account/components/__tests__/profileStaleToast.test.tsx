// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import { refuseFirstWrite, sendRefusedThenAgain, toastOrder } from '@/tests/staleToast';
import { UpdateProfileCard } from '../UpdateProfileCard';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

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

describe('the toast of a refused profile save', () => {
  it('is taken down once: when the form is sent again, and not on the save after that', async () => {
    refuseFirstWrite({ ...USER, name: 'Layla H' }, () => USER);
    const { message } = await renderForm('en', <UpdateProfileCard />);
    const name = await screen.findByRole('textbox', { name: message('settings.profile.name') });
    await waitFor(() => expect(name).toHaveProperty('value', 'Layla Haddad'));
    const isIdle = () => !name.hasAttribute('disabled');
    const save = (value: string) => () => {
      fireEvent.change(name, { target: { value } });
      fireEvent.submit(screen.getByTestId('update-profile-form'));
    };

    await sendRefusedThenAgain(save('Layla H'), isIdle);
    await waitFor(() => expect(toastOrder()).toEqual(['error', 'dismiss', 'success']));
    await waitFor(() => expect(isIdle()).toBe(true));
    save('Layla Had')();

    await waitFor(() => expect(toastOrder()).toEqual(['error', 'dismiss', 'success', 'success']));
  });
});
