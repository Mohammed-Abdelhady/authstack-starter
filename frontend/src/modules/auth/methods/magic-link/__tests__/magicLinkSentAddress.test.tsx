// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  SERVER_TEXT,
  refusalWith,
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { unreachable } from '@/tests/busyControls';
import { MagicLinkRequestForm } from '../MagicLinkRequestForm';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  Link: () => null,
}));

/** A leading digit is what a right-to-left sentence moves to the far end. */
const EMAIL = '123layla@example.com';
/** First strong isolate and pop directional isolate, written out. */
const ISOLATED_EMAIL = `⁦${EMAIL}⁩`;

registerFormTestLifecycle();

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('magic link confirmation in %s', (locale) => {
  it('isolates the address left to right inside the translated sentence', async () => {
    stubNetwork(() => success({ email: EMAIL }));
    const { message } = await renderForm(
      locale,
      <MagicLinkRequestForm redirect={null} isOnlyMethod />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: message('auth.magicLink.email') }), {
      target: { value: EMAIL },
    });
    fireEvent.submit(screen.getByTestId('magic-link-form'));

    const sent = await screen.findByRole('status');
    const [before, after] = message('auth.magicLink.sentBody').split('⁦{email}⁩');
    expect(sent.textContent).toContain(`${before}${ISOLATED_EMAIL}${after}`);
  });

  it.each(['the address field', 'the submit button'] as const)(
    'moves focus from %s to the heading of the confirmation that replaces the form',
    async (from) => {
      stubNetwork(() => success({ email: EMAIL }));
      const { message } = await renderForm(
        locale,
        <MagicLinkRequestForm redirect={null} isOnlyMethod />,
      );
      const field = screen.getByRole('textbox', { name: message('auth.magicLink.email') });
      fireEvent.change(field, { target: { value: EMAIL } });
      (from === 'the address field' ? field : screen.getByTestId('magic-link-submit')).focus();

      fireEvent.submit(screen.getByTestId('magic-link-form'));

      const heading = await screen.findByRole('heading', {
        name: message('auth.magicLink.sentTitle'),
      });
      await waitFor(() => expect(document.activeElement).toBe(heading));
      // The confirmation is a status, so it is read out as it appears.
      expect(screen.getByRole('status').contains(heading)).toBe(true);
    },
  );

  it.each([
    [429, 'SOMETHING_NEW', 'toast.error.tooManyRequests'],
    [500, 'INTERNAL_ERROR', 'errors.codes.INTERNAL_ERROR'],
  ] as const)(
    'shows the catalogue message for HTTP %s, once, and not the server text',
    async (status, code, key) => {
      stubNetwork(() => refusalWith(status, code));
      const view = await renderForm(locale, <MagicLinkRequestForm redirect={null} isOnlyMethod />);
      fireEvent.change(
        screen.getByRole('textbox', { name: view.message('auth.magicLink.email') }),
        { target: { value: EMAIL } },
      );

      fireEvent.submit(screen.getByTestId('magic-link-form'));

      const alert = await screen.findByTestId('magic-link-error');
      expect(alert.textContent).toBe(view.message(key));
      expect(view.errorToasts()).toEqual([]);
      expect(document.body.textContent).not.toContain(SERVER_TEXT);
      expect(screen.queryByTestId('magic-link-sent')).toBeNull();
    },
  );

  it('shows a translated network refusal without changing to the sent state', async () => {
    stubNetwork(unreachable);
    const view = await renderForm(locale, <MagicLinkRequestForm redirect={null} isOnlyMethod />);
    fireEvent.change(screen.getByRole('textbox', { name: view.message('auth.magicLink.email') }), {
      target: { value: EMAIL },
    });

    fireEvent.submit(screen.getByTestId('magic-link-form'));

    const alert = await screen.findByTestId('magic-link-error');
    expect(alert.textContent).toBe(view.message('toast.error.networkError'));
    expect(screen.queryByTestId('magic-link-sent')).toBeNull();
  });
});
