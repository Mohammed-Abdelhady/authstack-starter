// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import ar from '@/i18n/messages/ar.json'; // feature:locale-ar
import { ScanStep } from '../ScanStep';

afterEach(cleanup);

const LOCALES = [
  { locale: 'en', messages: en },
  { locale: 'ar', messages: ar }, // feature:locale-ar
];
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SETUP = {
  secret: SECRET,
  otpauthUrl: `otpauth://totp/App:user@example.com?secret=${SECRET}&issuer=App`,
};

function renderStep(locale: string, messages: typeof en) {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ScanStep setup={SETUP} onContinue={() => undefined} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole('group', { name: messages.settings.twoFactor.setup.scan.secretLabel });
}

it.each(LOCALES)('names the setup key scroll area in $locale', ({ locale, messages }) => {
  expect(renderStep(locale, messages).textContent).toBe(SECRET);
});

it.each(LOCALES)('makes the setup key a keyboard tab stop in $locale', ({ locale, messages }) => {
  const key = renderStep(locale, messages);
  key.focus();
  expect(document.activeElement).toBe(key);
  expect(key.tabIndex).toBe(0);
});

it.each(LOCALES)(
  'keeps the setup key left to right in an rtl page in $locale',
  ({ locale, messages }) => {
    render(
      <div dir="rtl">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ScanStep setup={SETUP} onContinue={() => undefined} />
        </NextIntlClientProvider>
      </div>,
    );
    const key = screen.getByRole('group', {
      name: messages.settings.twoFactor.setup.scan.secretLabel,
    });
    expect(key.getAttribute('dir')).toBe('ltr');
    expect(key.parentElement?.getAttribute('dir')).toBeNull();
  },
);
