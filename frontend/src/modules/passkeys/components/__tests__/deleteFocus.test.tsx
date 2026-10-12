// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import type { AppLocale } from '@/i18n/load-messages';
import { availability, heldAnswer, HELD, IDLE, unreachable } from '@/tests/busyControls';
import {
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { PasskeysCard } from '../PasskeysCard';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
// The browser ceremony is the boundary: jsdom has no authenticator.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  platformAuthenticatorIsAvailable: async () => true,
  startRegistration: vi.fn(),
}));

function passkey(id: string, name: string) {
  return {
    id,
    name,
    deviceType: 'singleDevice',
    backedUp: false,
    createdAt: '2026-01-05T10:00:00.000Z',
    lastUsedAt: null,
  };
}

const ENDINGS = {
  refused: () => refusalWith(400, ErrorCode.PASSKEY_LAST_SIGN_IN_METHOD),
  unreachable,
} as const;

/**
 * The card with two passkeys. A removal is held until settled, and once one is
 * accepted the list holds the second passkey alone.
 */
async function renderCard(locale: AppLocale) {
  const held = heldAnswer();
  let passkeys = [passkey('pk-1', 'Laptop'), passkey('pk-2', 'Phone')];
  stubNetwork((request, path) => {
    if (request.method === 'DELETE') {
      return held.answer.then((response) => {
        if (response.ok) passkeys = passkeys.slice(1);
        return response;
      });
    }
    return success(
      path === '/api/auth/passkeys'
        ? { passkeys, canRemove: true }
        : { methods: { password: true, passkeys: true, oauth: [] } },
    );
  });
  const card = await renderForm(locale, <PasskeysCard />);
  await screen.findByTestId('passkey-delete-pk-1');
  return {
    ...card,
    title: screen.getByRole('heading', { name: card.message('settings.passkeys.title') }),
    accept: () => held.settle(() => success({ message: 'removed' })),
    settle: held.settle,
  };
}

/** Opens the removal dialog of a passkey from its row and waits for it to hold focus. */
async function openRemoval(id: string) {
  const opener = screen.getByTestId(`passkey-delete-${id}`);
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByTestId('passkey-delete-dialog');
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return { opener, dialog };
}

function confirm() {
  const button = screen.getByTestId('passkey-delete-confirm');
  button.focus();
  fireEvent.click(button);
  return button;
}

const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('focus after a passkey is removed in %s', (locale) => {
  it('goes to the heading of the card, and the next dialog closed returns to its own opener', async () => {
    const card = await renderCard(locale);
    await openRemoval('pk-1');
    confirm();

    card.accept();

    await waitFor(() => expect(screen.queryByTestId('passkey-delete-dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card.title));
    await waitFor(() => expect(screen.queryByTestId('passkey-row-pk-1')).toBeNull());
    await settled();
    expect(document.activeElement).toBe(card.title);

    const next = await openRemoval('pk-2');
    fireEvent.keyDown(next.dialog, { key: 'Escape' });

    await waitFor(() => expect(document.activeElement).toBe(next.opener));
  });

  it.each(['refused', 'unreachable'] as const)(
    'stays on the confirm button when the removal is %s, and Escape then returns to the row',
    async (ending) => {
      const card = await renderCard(locale);
      const { opener, dialog } = await openRemoval('pk-1');
      const button = confirm();
      await waitFor(() => expect(availability(button)).toEqual(HELD));

      card.settle(ENDINGS[ending]);

      await waitFor(() => expect(availability(button)).toEqual(IDLE));
      await settled();
      expect(document.activeElement).toBe(button);

      fireEvent.keyDown(dialog, { key: 'Escape' });

      await waitFor(() => expect(document.activeElement).toBe(opener));
    },
  );
});
