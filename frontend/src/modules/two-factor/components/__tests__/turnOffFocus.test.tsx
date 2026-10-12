// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { availability, heldAnswer, HELD } from '@/tests/busyControls';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { TwoFactorCard } from '../TwoFactorCard';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));

const USER = {
  id: 'user-1',
  email: 'layla@example.com',
  name: 'Layla Haddad',
  role: 'user',
  permissions: [],
  twoFactorEnabled: true,
  linkedProviders: ['google'],
};
const METHODS = {
  methods: { password: false, magicLink: false, twoFactor: true, passkeys: false, oauth: [] },
};

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus after two-step verification is turned off in %s', (locale) => {
  it('goes to the heading of its card once the button that turned it off is gone', async () => {
    let enabled = true;
    const held = heldAnswer();
    stubNetwork((request, path) => {
      if (request.method === 'POST') {
        return held.answer;
      }
      return success(
        path === '/api/auth/methods' ? METHODS : { ...USER, twoFactorEnabled: enabled },
      );
    });
    const card = await renderForm(locale, <TwoFactorCard />);
    const opener = await screen.findByTestId('two-factor-disable-open');
    const title = screen.getByRole('heading', { name: card.message('settings.twoFactor.title') });
    opener.focus();
    fireEvent.click(opener);
    const code = await screen.findByTestId('two-factor-code-input');
    fireEvent.change(code, { target: { value: '123456' } });

    fireEvent.submit(screen.getByTestId('two-factor-disable-form'));

    await waitFor(() =>
      expect(availability(screen.getByTestId('two-factor-disable-submit'))).toEqual(HELD),
    );
    expect(screen.getByTestId('two-factor-disable-dialog').contains(document.activeElement)).toBe(
      true,
    );
    enabled = false;
    held.settle(() => success({ message: 'off' }));

    await waitFor(() => expect(screen.queryByTestId('two-factor-disable-dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(title));
    await waitFor(() => expect(screen.queryByTestId('two-factor-disable-open')).toBeNull());
    await settled();
    expect(document.activeElement).toBe(title);
  });

  it('returns to the button that opened the dialog when it is closed without turning it off', async () => {
    stubNetwork((_request, path) => success(path === '/api/auth/methods' ? METHODS : USER));
    await renderForm(locale, <TwoFactorCard />);
    const opener = await screen.findByTestId('two-factor-disable-open');
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByTestId('two-factor-disable-dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
