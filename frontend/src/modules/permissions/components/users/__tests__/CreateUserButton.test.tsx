// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import en from '@/i18n/messages/users.en.json';
import ar from '@/i18n/messages/users.ar.json'; // feature:locale-ar
import { CreateUserButton } from '../CreateUserButton';

afterEach(cleanup);
const LOCALES = [
  { locale: 'en', messages: en },
  { locale: 'ar', messages: ar }, // feature:locale-ar
];

it.each(LOCALES)('uses the catalogue button name in $locale', ({ locale, messages }) => {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CreateUserButton />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByRole('button', { name: messages.users.addUser }).getAttribute('data-testid'),
  ).toBe('create-user-button');
});
