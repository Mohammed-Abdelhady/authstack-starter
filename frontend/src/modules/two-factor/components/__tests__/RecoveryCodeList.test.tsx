// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/settings.en.json';
import ar from '@/i18n/messages/settings.ar.json'; // feature:locale-ar
import { directionOf, registerRtlDocument } from '@/tests/direction';
import { RecoveryCodeList } from '../RecoveryCodeList';

afterEach(cleanup);
registerRtlDocument();

const LOCALES = [
  { locale: 'en', messages: en },
  { locale: 'ar', messages: ar }, // feature:locale-ar
];

/** Digits before letters is the shape a right-to-left line reorders. */
const CODES = ['23456ABCDE', 'K3M7QRTVWX'];

it.each(LOCALES)(
  'keeps each recovery code left to right in an rtl page in $locale',
  ({ locale, messages }) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <RecoveryCodeList codes={CODES} />
      </NextIntlClientProvider>,
    );

    const list = screen.getByRole('list');
    const codes = within(list).getAllByRole('listitem');
    expect({
      codes: codes.map((code) => [code.textContent, code.getAttribute('dir')]),
      list: directionOf(list),
    }).toEqual({
      codes: [
        ['23456ABCDE', 'ltr'],
        ['K3M7QRTVWX', 'ltr'],
      ],
      list: 'rtl',
    });
  },
);

it('announces copy success and reports a denied copy without claiming it worked', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RecoveryCodeList codes={CODES} />
    </NextIntlClientProvider>,
  );

  fireEvent.click(screen.getByTestId('two-factor-copy-recovery-codes'));

  const failure = await screen.findByTestId('two-factor-recovery-copy-status');
  expect(failure.getAttribute('role')).toBe('alert');
  expect(failure.textContent).toBe(en.settings.twoFactor.recoveryCodes.copyFailure);
  expect(screen.getByTestId('two-factor-copy-recovery-codes').textContent).toBe(
    en.settings.twoFactor.recoveryCodes.copy,
  );
});
