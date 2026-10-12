// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
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
