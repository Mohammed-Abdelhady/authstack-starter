// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/load-messages';
import type { AbstractIntlMessages } from 'next-intl';
import { directionOf, registerRtlDocument } from '@/tests/direction';
import { NativeAuthorizeReadyView } from '../NativeAuthorizeReadyView';

afterEach(cleanup);
registerRtlDocument();

const LOCALES = ['en', 'ar'] as const; // feature:locale-ar
const messages: Partial<Record<(typeof LOCALES)[number], AbstractIntlMessages>> = {};

beforeAll(async () => {
  for (const locale of LOCALES) messages[locale] = await loadMessages(locale);
});

/** A leading digit is what a right-to-left line moves to the far end. */
const EMAIL = '123layla@example.com';

it.each(LOCALES)('keeps the account address left to right in an rtl page in %s', (locale) => {
  const catalogue = messages[locale];
  if (!catalogue) throw new Error(`Missing ${locale} catalogue`);
  render(
    <NextIntlClientProvider locale={locale} messages={catalogue}>
      <NativeAuthorizeReadyView
        applicationName="Acme Mobile"
        accountName="Layla Haddad"
        accountEmail={EMAIL}
        accountChanged={false}
        action={null}
        headingRef={createRef<HTMLHeadingElement>()}
        onApprove={() => undefined}
        onDeny={() => undefined}
        onNotYou={() => undefined}
      />
    </NextIntlClientProvider>,
  );

  const address = screen.getByTestId('native-authorize-account-email');
  expect({
    text: address.textContent,
    address: address.getAttribute('dir'),
    line: address.parentElement ? directionOf(address.parentElement) : null,
  }).toEqual({ text: EMAIL, address: 'ltr', line: 'rtl' });
});
