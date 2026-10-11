// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { NextIntlClientProvider } from 'next-intl';
import { ErrorCode } from '@app/core';
import { FormInput } from '@/components/forms';
import { loadMessages, type AppLocale } from '@/i18n/load-messages';
import { lookupMessage } from '@/i18n/__tests__/message-tree';
import { SERVER_TEXT, descriptions } from '@/tests/serverRejectionHarness';
import {
  useFormFieldTarget,
  useLocalFieldTarget,
  useServerFieldErrors,
  type ServerFieldErrorTarget,
} from '../useServerFieldErrors';

/** Declared in a different order from the one the fields have on screen. */
interface HarnessValues {
  address: { city: string };
  email: string;
  name: string;
}

interface HarnessProps {
  error: unknown;
  startsSubmitting: boolean;
  onResult: (marked: boolean) => void;
}

function rejection(code: string, details?: Record<string, unknown>) {
  return {
    status: 400,
    data: { success: false, error: { code, message: 'Validation failed', details } },
  };
}

function validationRejection(fieldNames: string[]) {
  return rejection(ErrorCode.VALIDATION_ERROR, {
    fields: Object.fromEntries(fieldNames.map((name) => [name, [SERVER_TEXT]])),
  });
}

/** A form whose fields are held while a request runs, as the real forms are. */
function Harness({ error, startsSubmitting, onResult }: HarnessProps) {
  const [submitting, setSubmitting] = useState(startsSubmitting);
  const formRef = useRef<HTMLFormElement>(null);
  const form = useForm<HarnessValues>({
    defaultValues: { address: { city: '' }, email: '', name: '' },
  });
  const applyServerFieldErrors = useServerFieldErrors(
    useFormFieldTarget(form.setError, formRef),
    submitting,
  );

  return (
    <FormProvider {...form}>
      <form ref={formRef}>
        <FormInput<HarnessValues> name="name" label="Name" busy={submitting} />
        <FormInput<HarnessValues> name="email" label="Email" busy={submitting} />
        <FormInput<HarnessValues> name="address.city" label="City" busy={submitting} />
        <button type="button" onClick={() => onResult(applyServerFieldErrors(error))}>
          Reject
        </button>
        <button type="button" onClick={() => setSubmitting(true)}>
          Submit
        </button>
        <button type="button" onClick={() => setSubmitting(false)}>
          Finish
        </button>
      </form>
    </FormProvider>
  );
}

function press(buttonName: string) {
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
}

async function reject(locale: AppLocale, error: unknown, startsSubmitting = false) {
  const messages = await loadMessages(locale);
  const onResult = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <Harness error={error} startsSubmitting={startsSubmitting} onResult={onResult} />
    </NextIntlClientProvider>,
  );
  press('Reject');
  return {
    onResult,
    expectedMessage: lookupMessage(messages, 'errors.codes.INVALID_INPUT'),
    name: screen.getByRole('textbox', { name: 'Name' }),
    email: screen.getByRole('textbox', { name: 'Email' }),
    city: screen.getByRole('textbox', { name: 'City' }),
  };
}

function invalidFlags(fields: HTMLElement[]): (string | null)[] {
  return fields.map((field) => field.getAttribute('aria-invalid'));
}

afterEach(() => cleanup());

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('useServerFieldErrors in %s', (locale) => {
  it('marks the field the server rejected with the catalogue message', async () => {
    const { onResult, expectedMessage, name, email, city } = await reject(
      locale,
      validationRejection(['email']),
    );

    expect(expectedMessage.trim().length).toBeGreaterThan(0);
    expect(invalidFlags([name, email, city])).toEqual(['false', 'true', 'false']);
    expect(descriptions(email)).toEqual([expectedMessage]);
    expect(descriptions(name)).toEqual([]);
    expect(document.body.textContent).not.toContain(SERVER_TEXT);
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it('ignores names the form has no control for and leaves the focus alone', async () => {
    const { onResult, name, email, city } = await reject(
      locale,
      validationRejection(['nickname', 'address.zip', 'name.first']),
    );

    expect(invalidFlags([name, email, city])).toEqual(['false', 'false', 'false']);
    expect(document.activeElement).toBe(document.body);
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('marks the known field when an unknown one came with it', async () => {
    const { onResult, name, email, city } = await reject(
      locale,
      validationRejection(['nickname', 'email']),
    );

    expect(invalidFlags([name, email, city])).toEqual(['false', 'true', 'false']);
    expect(document.activeElement).toBe(email);
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it.each([
    ['a validation error without fields', rejection(ErrorCode.VALIDATION_ERROR)],
    [
      'fields on an error that is not a validation error',
      rejection(ErrorCode.RATE_LIMIT_EXCEEDED, { fields: { email: [SERVER_TEXT] } }),
    ],
    ['an error that is not a response', new Error('offline')],
  ])('marks nothing for %s', async (_label, error) => {
    const { onResult, name, email, city } = await reject(locale, error);

    expect(invalidFlags([name, email, city])).toEqual(['false', 'false', 'false']);
    expect(document.activeElement).toBe(document.body);
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('focuses the first marked field as the fields appear on screen', async () => {
    // The server names the city first, and so does the form's values object.
    const { name, email, city } = await reject(
      locale,
      validationRejection(['address.city', 'email']),
    );

    expect(invalidFlags([name, email, city])).toEqual(['false', 'true', 'true']);
    expect(document.activeElement).toBe(email);
  });

  it('marks and focuses a nested field by its dotted path', async () => {
    const { expectedMessage, name, email, city } = await reject(
      locale,
      validationRejection(['address.city']),
    );

    expect(invalidFlags([name, email, city])).toEqual(['false', 'false', 'true']);
    expect(descriptions(city)).toEqual([expectedMessage]);
    expect(document.activeElement).toBe(city);
  });

  it('moves the focus once the request is over and the fields are enabled', async () => {
    const { email } = await reject(locale, validationRejection(['email']), true);

    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(document.body);

    press('Finish');

    expect(document.activeElement).toBe(email);
  });

  it('does not take the focus back when a later request ends', async () => {
    const { email } = await reject(locale, validationRejection(['email']));
    expect(document.activeElement).toBe(email);

    const finish = screen.getByRole('button', { name: 'Finish' });
    finish.focus();
    press('Submit');
    press('Finish');

    expect(document.activeElement).toBe(finish);
  });
});

describe('field targets', () => {
  /** Renders again and returns the target each render produced. */
  function targetsOf(useTarget: () => ServerFieldErrorTarget): ServerFieldErrorTarget[] {
    const targets: ServerFieldErrorTarget[] = [];
    function Probe() {
      const [, setRenders] = useState(0);
      const target = useTarget();
      return (
        <button type="button" onClick={() => setRenders((count) => count + 1)}>
          Render again {targets.push(target)}
        </button>
      );
    }
    render(<Probe />);
    fireEvent.click(screen.getByRole('button'));
    return targets;
  }

  it('keeps the target of a local-state form the same between renders', () => {
    const targets = targetsOf(() => {
      const [, setErrors] = useState<Record<string, string>>({});
      return useLocalFieldTarget(setErrors, 'form-1');
    });

    expect(targets).toHaveLength(2);
    expect(targets[1]).toBe(targets[0]);
  });

  it('keeps the target of a react-hook-form form the same between renders', () => {
    const targets = targetsOf(() => {
      const form = useForm<HarnessValues>();
      const formRef = useRef<HTMLFormElement>(null);
      return useFormFieldTarget(form.setError, formRef);
    });

    // react-hook-form renders once more on mount.
    expect(targets).toHaveLength(3);
    expect(targets[1]).toBe(targets[0]);
    expect(targets[2]).toBe(targets[0]);
  });
});
