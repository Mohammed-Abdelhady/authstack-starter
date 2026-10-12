// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import enCommon from '@/i18n/messages/en.json';
import enPermissions from '@/i18n/messages/permissions.en.json';
const en = { ...enCommon, ...enPermissions };
import arCommon from '@/i18n/messages/ar.json'; // feature:locale-ar
import arPermissions from '@/i18n/messages/permissions.ar.json'; // feature:locale-ar
const ar = { ...arCommon, ...arPermissions }; // feature:locale-ar
import { CodeBlock } from './code-block';

afterEach(cleanup);

const LOCALES = [
  { locale: 'en', messages: en },
  { locale: 'ar', messages: ar }, // feature:locale-ar
];

function renderIn(locale: string, messages: typeof en, children: ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>,
  );
}

it.each(['ltr', 'rtl'] as const)('keeps code LTR within a %s container', (dir) => {
  renderIn(
    'en',
    en,
    <div dir={dir}>
      <CodeBlock testId="sample">{'const x = 1;'}</CodeBlock>
    </div>,
  );
  expect(screen.getByTestId('sample').getAttribute('dir')).toBe('ltr');
});

it('keeps direction for an empty sample', () => {
  renderIn('en', en, <CodeBlock testId="sample">{''}</CodeBlock>);
  expect(screen.getByTestId('sample').getAttribute('dir')).toBe('ltr');
});

it.each(LOCALES)(
  'names the scroll region from the catalogue in $locale',
  ({ locale, messages }) => {
    renderIn(locale, messages, <CodeBlock>{'const x = 1;'}</CodeBlock>);
    const region = screen.getByRole('region', { name: messages.common.codeSample });
    expect(region.textContent).toBe('const x = 1;');
  },
);

it.each(LOCALES)('is a keyboard tab stop that accepts focus in $locale', ({ locale, messages }) => {
  renderIn(locale, messages, <CodeBlock>{'const x = 1;'}</CodeBlock>);
  const region = screen.getByRole('region', { name: messages.common.codeSample });
  region.focus();
  expect(document.activeElement).toBe(region);
  expect(region.tabIndex).toBe(0);
});

it('prefers the label the caller supplies', () => {
  const label = en.permissions.demo.routeCodeTitle;
  renderIn('en', en, <CodeBlock label={label}>{'const x = 1;'}</CodeBlock>);
  expect(screen.getByRole('region', { name: label })).toBeTruthy();
  expect(screen.queryByRole('region', { name: en.common.codeSample })).toBeNull();
});

it('gives each sample on a page its own name', () => {
  renderIn(
    'en',
    en,
    <>
      <CodeBlock label={en.permissions.demo.allCodeTitle}>{'a'}</CodeBlock>
      <CodeBlock label={en.permissions.demo.anyCodeTitle}>{'b'}</CodeBlock>
    </>,
  );
  expect(screen.getByRole('region', { name: en.permissions.demo.allCodeTitle }).textContent).toBe(
    'a',
  );
  expect(screen.getByRole('region', { name: en.permissions.demo.anyCodeTitle }).textContent).toBe(
    'b',
  );
});
