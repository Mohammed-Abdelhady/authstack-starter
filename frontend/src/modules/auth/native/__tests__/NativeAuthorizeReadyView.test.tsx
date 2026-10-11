// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import ar from '@/i18n/messages/ar.json'; // feature:locale-ar
import { directionOf, registerRtlDocument } from '@/tests/direction';
import { NativeAuthorizeReadyView } from '../NativeAuthorizeReadyView';

afterEach(cleanup);
registerRtlDocument();

const LOCALES = [
  { locale: 'en', messages: en },
  { locale: 'ar', messages: ar }, // feature:locale-ar
];

/** A leading digit is what a right-to-left line moves to the far end. */
const EMAIL = '123layla@example.com';

it.each(LOCALES)(
  'keeps the account address left to right in an rtl page in $locale',
  ({ locale, messages }) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
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
  },
);
