// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import ar from '@/i18n/messages/ar.json'; // feature:locale-ar
import { StatusBadge } from './StatusBadge';

afterEach(cleanup);

const LOCALES = [
  { locale: 'en', messages: en },
  { locale: 'ar', messages: ar }, // feature:locale-ar
];
const STATUSES = [
  'verified',
  'pending',
  'active',
  'inactive',
  'success',
  'warning',
  'danger',
] as const;

it.each(LOCALES)('translates default badges in $locale', ({ locale, messages }) => {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {STATUSES.map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </NextIntlClientProvider>,
  );
  for (const status of STATUSES) {
    expect(screen.getByTestId(`status-badge-${status}`).textContent).toBe(
      messages.common.status[status],
    );
  }
});

it('preserves caller-provided content', () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StatusBadge status="verified">{en.common.welcome}</StatusBadge>
    </NextIntlClientProvider>,
  );
  expect(screen.getByTestId('status-badge-verified').textContent).toBe(en.common.welcome);
});
