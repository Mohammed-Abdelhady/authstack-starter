// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { ServerCrash } from 'lucide-react';
import { afterEach, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import ar from '@/i18n/messages/ar.json'; // feature:locale-ar
import { directionOf, registerRtlDocument } from '@/tests/direction';
import { ErrorPageLayout } from './ErrorPageLayout';

afterEach(cleanup);
registerRtlDocument();

const LOCALES = [
  { locale: 'en', messages: en },
  { locale: 'ar', messages: ar }, // feature:locale-ar
];

/** Digits before letters is the shape a right-to-left line reorders. */
const DIGEST = '123abc456';

it.each(LOCALES)(
  'keeps the error id left to right beside its translated label in $locale',
  ({ messages }) => {
    const label = messages.errors['500'].errorId;
    render(
      <ErrorPageLayout
        code="500"
        title={messages.errors['500'].title}
        description={messages.errors['500'].description}
        subtitle={messages.errors['500'].subtitle}
        icon={ServerCrash}
        variant="destructive"
        actions={null}
        errorDigest={DIGEST}
        errorIdLabel={label}
      />,
    );

    const digest = screen.getByTestId('error-digest');
    const line = digest.parentElement;
    expect({
      text: digest.textContent,
      digest: digest.getAttribute('dir'),
      line: line ? directionOf(line) : null,
      lineText: line?.textContent,
    }).toEqual({ text: DIGEST, digest: 'ltr', line: 'rtl', lineText: `${label}: ${DIGEST}` });
  },
);
