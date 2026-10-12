// @vitest-environment jsdom
import { createRef, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderForm, registerFormTestLifecycle } from '@/tests/serverRejectionHarness';
import { FormDescription, FormField, FormItem } from '@/components/ui/form';
import { FormInput } from '../FormInput';
import { FormPassword } from '../FormPassword';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
registerFormTestLifecycle();

const HINT = 'hint-for-the-test';
const PROBLEM = 'problem-for-the-test';

interface Values {
  plain: string;
  hinted: string;
  secret: string;
}

function Fields({ secretHint: initialSecretHint }: { secretHint?: string }) {
  const [secretHint, setSecretHint] = useState(initialSecretHint);
  const form = useForm<Values>({ defaultValues: { plain: '', hinted: '', secret: '' } });
  const fail = (name: keyof Values) => () => form.setError(name, { message: PROBLEM });
  return (
    <FormProvider {...form}>
      <FormInput<Values> name="plain" data-testid="plain" />
      <FormInput<Values> name="hinted" description={HINT} data-testid="hinted" />
      <FormPassword<Values> name="secret" description={secretHint} data-testid="secret" />
      <button type="button" data-testid="fail-plain" onClick={fail('plain')} />
      <button type="button" data-testid="fail-hinted" onClick={fail('hinted')} />
      <button type="button" data-testid="fail-secret" onClick={fail('secret')} />
      <button type="button" data-testid="drop-hint" onClick={() => setSecretHint(undefined)} />
    </FormProvider>
  );
}

function HintWithRef({ hintRef }: { hintRef: React.RefObject<HTMLParagraphElement | null> }) {
  const form = useForm<Values>({ defaultValues: { plain: '', hinted: '', secret: '' } });
  return (
    <FormProvider {...form}>
      <FormField
        control={form.control}
        name="hinted"
        render={() => (
          <FormItem>
            <FormDescription ref={hintRef}>{HINT}</FormDescription>
          </FormItem>
        )}
      />
    </FormProvider>
  );
}

/** What each id in `aria-describedby` points at: its text, or null for no element. */
function described(testId: string): Array<string | null> {
  const ids = screen.getByTestId(testId).getAttribute('aria-describedby');
  if (ids === null) return [];
  return ids.split(' ').map((id) => document.getElementById(id)?.textContent ?? null);
}

describe('what a form control says describes it', () => {
  it('names nothing for a field with no hint and no error', async () => {
    await renderForm('en', <Fields />);

    expect(screen.getByTestId('plain').hasAttribute('aria-describedby')).toBe(false);
    expect(screen.getByTestId('secret').hasAttribute('aria-describedby')).toBe(false);
  });

  it('names the hint of a field that has one', async () => {
    await renderForm('en', <Fields secretHint={HINT} />);

    expect(described('hinted')).toEqual([HINT]);
    expect(described('secret')).toEqual([HINT]);
  });

  it('names the error alone on a field with no hint', async () => {
    await renderForm('en', <Fields />);

    fireEvent.click(screen.getByTestId('fail-plain'));
    fireEvent.click(screen.getByTestId('fail-secret'));

    expect(described('plain')).toEqual([PROBLEM]);
    expect(described('secret')).toEqual([PROBLEM]);
  });

  it('names the hint and then the error on a field with both', async () => {
    await renderForm('en', <Fields />);

    fireEvent.click(screen.getByTestId('fail-hinted'));

    expect(described('hinted')).toEqual([HINT, PROBLEM]);
  });

  it('still hands the hint paragraph to a ref the caller passes', async () => {
    const hintRef = createRef<HTMLParagraphElement>();
    await renderForm('en', <HintWithRef hintRef={hintRef} />);

    expect(hintRef.current?.textContent).toBe(HINT);
  });

  it('stops naming a hint that has left the page', async () => {
    await renderForm('en', <Fields secretHint={HINT} />);
    expect(described('secret')).toEqual([HINT]);

    fireEvent.click(screen.getByTestId('drop-hint'));

    expect(described('secret')).toEqual([]);
  });
});
