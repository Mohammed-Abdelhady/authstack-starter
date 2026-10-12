// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { AppLocale } from '@/i18n/load-messages';
import {
  descriptions,
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

registerFormTestLifecycle();

/** The form beside something else that can take the focus, as on the sign-in page. */
async function renderBesideAnotherControl(locale: AppLocale) {
  const requests = stubNetwork(() => success({}));
  const view = await renderForm(
    locale,
    <>
      <input data-testid="other-form-field" />
      <MagicLinkRequestForm redirect={null} isOnlyMethod={false} />
    </>,
  );
  return {
    ...view,
    requests,
    other: screen.getByTestId('other-form-field'),
    email: screen.getByRole('textbox', { name: view.message('auth.magicLink.email') }),
  };
}

/** Moves the focus the way Tab or a click does, and lets validation settle. */
async function moveFocus(from: HTMLElement, to: HTMLElement) {
  await act(async () => {
    from.focus();
    to.focus();
  });
}

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('magic link request validation in %s', (locale) => {
  it('says nothing when the focus leaves the empty field for another form', async () => {
    const { email, other } = await renderBesideAnotherControl(locale);

    await moveFocus(email, other);

    expect(email.getAttribute('aria-invalid')).toBe('false');
    expect(descriptions(email)).toEqual([]);
  });

  it('names a wrong address once the field is left', async () => {
    const { email, other, message } = await renderBesideAnotherControl(locale);
    type(email, 'layla@');

    await moveFocus(email, other);

    await waitFor(() =>
      expect(descriptions(email)).toEqual([message('auth.login.errors.emailInvalid')]),
    );
    expect(email.getAttribute('aria-invalid')).toBe('true');
  });

  it('takes the message away when the wrong address is erased before leaving', async () => {
    const { email, other, message } = await renderBesideAnotherControl(locale);
    type(email, 'layla@');
    await moveFocus(email, other);
    await waitFor(() =>
      expect(descriptions(email)).toEqual([message('auth.login.errors.emailInvalid')]),
    );

    type(email, '');
    await moveFocus(email, other);

    expect(descriptions(email)).toEqual([]);
    expect(email.getAttribute('aria-invalid')).toBe('false');
  });

  it('marks the empty field on submit, focuses it and sends nothing', async () => {
    const { email, other, message, requests } = await renderBesideAnotherControl(locale);
    await moveFocus(email, other);

    fireEvent.submit(screen.getByTestId('magic-link-form'));

    await waitFor(() =>
      expect(descriptions(email)).toEqual([message('auth.login.errors.emailRequired')]),
    );
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(email);
    expect(requests).toEqual([]);
  });

  it('keeps the message of a submitted empty field when the focus moves on', async () => {
    const { email, other, message } = await renderBesideAnotherControl(locale);
    fireEvent.submit(screen.getByTestId('magic-link-form'));
    await waitFor(() =>
      expect(descriptions(email)).toEqual([message('auth.login.errors.emailRequired')]),
    );

    await moveFocus(email, other);

    expect(descriptions(email)).toEqual([message('auth.login.errors.emailRequired')]);
  });
});
