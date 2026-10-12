// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/load-messages';
import { lookupMessage } from '@/i18n/__tests__/message-tree';
import { ThemeSwitcher } from './ThemeSwitcher';

const state = vi.hoisted(() => ({ resolvedTheme: 'light', setTheme: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', ...state }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('system theme control in %s', (locale) => {
  it.each([
    { current: 'light', next: 'dark', label: 'common.switchToDarkMode' },
    { current: 'dark', next: 'light', label: 'common.switchToLightMode' },
  ])('switches the resolved $current theme to $next', async ({ current, next, label }) => {
    state.resolvedTheme = current;
    const messages = await loadMessages(locale);
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        <ThemeSwitcher />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: lookupMessage(messages, label) }));
    expect(state.setTheme).toHaveBeenCalledWith(next);
  });
});
