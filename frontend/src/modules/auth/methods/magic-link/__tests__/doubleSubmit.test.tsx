// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import {
  registerFormTestLifecycle,
  renderForm,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';
import { submitTwiceInOneTick } from '@/modules/auth/__tests__/submitTwice';
import { MagicLinkRequestForm } from '../MagicLinkRequestForm';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  Link: () => null,
}));

const EMAIL = 'layla@example.com';

registerFormTestLifecycle();

describe('magic link request', () => {
  it('asks for one link when the form is submitted twice in one tick', async () => {
    const requests = stubNetwork(() => success({ email: EMAIL }));
    const { message } = await renderForm(
      'en',
      <MagicLinkRequestForm redirect={null} isOnlyMethod />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: message('auth.magicLink.email') }), {
      target: { value: EMAIL },
    });

    submitTwiceInOneTick(screen.getByTestId('magic-link-form'));

    await screen.findByRole('status');
    expect(requests).toEqual(['POST /api/auth/magic-link/request']);
  });
});
