// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { focusAfterOpenAndEscape } from '@/tests/dialogFocus';
import { availability, heldAnswer, HELD } from '@/tests/busyControls';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { TwoFactorCard } from '../TwoFactorCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const USER = {
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
const OPENER = 'two-factor-regenerate-open';
const DIALOG = 'two-factor-regenerate-dialog';

function answer(request: Request, path: string): Response {
  if (request.method === 'POST') return success({ recoveryCodes: ['aaaa-bbbb'] });
  return success(path === '/api/auth/methods' ? METHODS : USER);
}

registerFormTestLifecycle();

describe('focus when the new recovery codes dialog closes', () => {
  it('returns to the button that opened it after Escape, though its code field took focus', async () => {
    stubNetwork(answer);
    await renderForm('en', <TwoFactorCard />);

    expect(await focusAfterOpenAndEscape(OPENER, DIALOG)).toBe(OPENER);
  });

  it('requires a password, then returns to the opener after the new codes are dismissed', async () => {
    const held = heldAnswer();
    const bodies: unknown[] = [];
    stubNetwork(async (request, path) => {
      if (request.method === 'POST') {
        bodies.push(await request.json());
        return held.answer;
      }
      return answer(request, path);
    });
    const view = await renderForm('en', <TwoFactorCard />);
    const opener = await screen.findByTestId(OPENER);
    opener.focus();
    fireEvent.click(opener);
    const password = await screen.findByLabelText(
      view.message('settings.password.currentPassword'),
    );
    await waitFor(() => expect(document.activeElement).toBe(password));
    fireEvent.change(password, { target: { value: 'Passw0rdLayla' } });
    const code = await screen.findByLabelText(view.message('auth.twoFactor.code'));
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.submit(screen.getByTestId('two-factor-regenerate-form'));

    await waitFor(() =>
      expect(availability(screen.getByTestId('two-factor-regenerate-submit'))).toEqual(HELD),
    );
    expect(bodies).toEqual([{ code: '123456', password: 'Passw0rdLayla' }]);
    expect(screen.getByTestId(DIALOG).contains(document.activeElement)).toBe(true);
    held.settle(() => success({ recoveryCodes: ['aaaa-bbbb'] }));

    fireEvent.click(await screen.findByTestId('two-factor-regenerate-done'));

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
