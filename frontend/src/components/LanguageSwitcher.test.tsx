// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react'; // feature:locale-ar
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAGIC_LINK_VERIFY_PATH } from '@/modules/auth/constants/authMethods'; // feature:locale-ar
import { getRedirectPath } from '@/modules/auth/utils/authHelpers'; // feature:locale-ar
import { LanguageSwitcher } from './LanguageSwitcher';

const state = vi.hoisted(() => ({
  locales: ['en'] as string[],
  pathname: '/auth/login',
  replace: vi.fn<(href: string, options: { locale: string }) => void>(),
}));

vi.mock('@/i18n/routing', () => ({
  routing: {
    get locales() {
      return state.locales;
    },
    defaultLocale: 'en',
  },
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: state.replace }),
}));

const MESSAGES = {
  common: {
    switchToEnglish: 'English',
    switchToArabic: 'Arabic', // feature:locale-ar
  },
};

function renderSwitcher(): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="UTC">
      <LanguageSwitcher />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.locales = ['en'];
  state.pathname = '/auth/login';
  state.replace.mockClear();
  window.history.replaceState({}, '', '/');
});

describe('LanguageSwitcher', () => {
  it('renders no button when the router serves only one locale', () => {
    state.locales = ['en'];

    renderSwitcher();

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  // feature:locale-ar:start

  it('carries the native continuation from locale navigation into the login redirect reader', () => {
    state.locales = ['en', 'ar'];
    window.history.replaceState(
      {},
      '',
      '/en/auth/login?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-abc123',
    );
    renderSwitcher();

    fireEvent.click(screen.getByTestId('language-switcher-ar'));

    expect(state.replace).toHaveBeenCalledWith(
      '/auth/login?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-abc123',
      { locale: 'ar' },
    );
    const href = state.replace.mock.calls[0][0];
    const selected = new URL(href, 'https://client.example');
    expect(getRedirectPath(selected.searchParams.get('redirect'), '')).toBe(
      '/auth/native/authorize?transaction=txn-abc123',
    );
  });

  it('preserves duplicate keys, an empty value, and the fragment', () => {
    state.locales = ['en', 'ar'];
    window.history.replaceState({}, '', '/en/auth/login?factor=one&factor=two&hint=#help');
    renderSwitcher();

    fireEvent.click(screen.getByTestId('language-switcher-ar'));

    expect(state.replace).toHaveBeenCalledWith('/auth/login?factor=one&factor=two&hint=#help', {
      locale: 'ar',
    });
  });

  it('keeps an encoded native redirect nested without admitting extra continuation keys', () => {
    state.locales = ['en', 'ar'];
    window.history.replaceState(
      {},
      '',
      '/en/auth/login?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-abc123%26stage%3Dconsent',
    );
    renderSwitcher();

    fireEvent.click(screen.getByTestId('language-switcher-ar'));

    const href = state.replace.mock.calls[0][0];
    const selected = new URL(href, 'https://client.example');
    expect(selected.searchParams.getAll('redirect')).toEqual([
      '/auth/native/authorize?transaction=txn-abc123&stage=consent',
    ]);
    expect(selected.searchParams.has('stage')).toBe(false);
    expect(getRedirectPath(selected.searchParams.get('redirect'), '')).toBe('');
  });

  it('passes an unsafe redirect unchanged for the existing login reader to reject', () => {
    state.locales = ['en', 'ar'];
    window.history.replaceState(
      {},
      '',
      '/en/auth/login?redirect=https%3A%2F%2Foutside.example%2Faccount',
    );
    renderSwitcher();

    fireEvent.click(screen.getByTestId('language-switcher-ar'));

    const href = state.replace.mock.calls[0][0];
    const selected = new URL(href, 'https://client.example');
    expect(selected.searchParams.get('redirect')).toBe('https://outside.example/account');
    expect(getRedirectPath(selected.searchParams.get('redirect'), '')).toBe('');
  });

  it('does not navigate from the one-use magic link verification page', () => {
    state.locales = ['en', 'ar'];
    state.pathname = MAGIC_LINK_VERIFY_PATH;
    window.history.replaceState({}, '', '/en/auth/magic-link/verify?token=once');
    renderSwitcher();

    const english = screen.getByTestId('language-switcher-en');
    const arabic = screen.getByTestId('language-switcher-ar');
    expect(english.getAttribute('aria-disabled')).toBe('true');
    expect(arabic.getAttribute('aria-disabled')).toBe('true');
    expect(english.hasAttribute('disabled')).toBe(false);
    expect(arabic.hasAttribute('disabled')).toBe(false);
    english.focus();
    expect(document.activeElement).toBe(english);
    fireEvent.click(english);
    fireEvent.click(arabic);

    expect(state.replace).not.toHaveBeenCalled();
  });
  // feature:locale-ar:end
});
