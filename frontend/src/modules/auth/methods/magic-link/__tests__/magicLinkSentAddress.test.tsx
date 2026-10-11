// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
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
});
