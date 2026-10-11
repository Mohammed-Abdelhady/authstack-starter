// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ErrorCode } from '@app/core';
import { expectFocusKeptThroughRequest, heldAnswer, unreachable } from '@/tests/busyControls';
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

const ENDINGS = {
  refused: () => refusalWith(500, ErrorCode.INTERNAL_ERROR),
  unreachable,
} as const;

registerFormTestLifecycle();

describe('focus on the add passkey button while adding one fails', () => {
  it.each(['refused', 'unreachable'] as const)(
    'stays on the button during the request and after it is %s',
    async (ending) => {
      const held = heldAnswer();
      stubNetwork((request, path) => {
        if (request.method !== 'GET') return held.answer;
        return success(
          path === '/api/auth/passkeys'
            ? { passkeys: [], canRemove: true }
            : { methods: { password: true, passkeys: true, oauth: [] } },
        );
      });
      await renderForm('en', <PasskeysCard />);
      const add = await screen.findByTestId('passkey-add');
      add.focus();

      fireEvent.click(add);

      await expectFocusKeptThroughRequest(add, () => held.settle(ENDINGS[ending]));
      await waitFor(() => expect(screen.queryByTestId('passkey-add-error')).not.toBeNull());
      expect(add.getAttribute('aria-busy')).toBe('false');
    },
  );
});
