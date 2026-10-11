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
import { PasskeysCard } from '../PasskeysCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// The browser ceremony is the boundary: jsdom has no authenticator.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  platformAuthenticatorIsAvailable: async () => true,
  startRegistration: vi.fn(),
}));

const PASSKEY = {
  id: 'pk-1',
  name: 'Laptop',
  deviceType: 'singleDevice',
  backedUp: false,
  createdAt: '2026-01-05T10:00:00.000Z',
  lastUsedAt: null,
};

registerFormTestLifecycle();

describe('every field on the passkey name form reaches its request', () => {
  it('renames a passkey with the name that was typed', async () => {
    const writes: Array<[string, unknown]> = [];
    stubNetwork(async (request, path) => {
      if (request.method === 'PATCH') {
        writes.push([`PATCH ${path}`, await request.json()]);
        return success({ ...PASSKEY, name: 'Work laptop' });
      }
      if (path === '/api/auth/passkeys') return success({ passkeys: [PASSKEY], canRemove: true });
      return success({ methods: { password: true, passkeys: true, oauth: [] } });
    });
    await renderForm('en', <PasskeysCard />);
    fireEvent.click(await screen.findByTestId('passkey-rename-pk-1'));
    const form = await screen.findByTestId('passkey-name-form');
    expect(fieldNames(form)).toEqual(['name']);
    fireEvent.change(screen.getByTestId('passkey-name-input'), {
      target: { value: 'Work laptop' },
    });

    fireEvent.submit(form);

    await waitFor(() =>
      expect(writes).toEqual([['PATCH /api/auth/passkeys/pk-1', { name: 'Work laptop' }]]),
    );
  });
});
