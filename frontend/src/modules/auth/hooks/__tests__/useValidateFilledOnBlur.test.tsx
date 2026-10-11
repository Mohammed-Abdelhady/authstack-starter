// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type Control, type FieldValues } from 'react-hook-form';
import { z } from 'zod';
import { useValidateFilledOnBlur } from '../useValidateFilledOnBlur';

const REQUIRED = 'required-for-the-test';
const schema = z.object({
  first: z.string().min(1, REQUIRED),
  second: z.string().min(1, REQUIRED),
});
type Values = z.infer<typeof schema>;

/**
 * The helper reads these two flags from the control. If the library drops the
 * member or renames a flag, this type stops compiling and the typecheck
 * fails here, before the sign-in form loses a message again.
 */
type SubmitState = Pick<Control<FieldValues>['_formState'], 'isSubmitting' | 'isSubmitted'>;

/** A form on the real library that never reads the submit flags while rendering. */
function TwoFields({ onSecondLeft }: { onSecondLeft: (state: SubmitState) => void }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { first: '', second: '' },
    mode: 'onSubmit',
  });
  const { control } = form;
  const onSecondBlur = useValidateFilledOnBlur(form, 'second');
  // Registered in page order: the library focuses the first invalid field it was given.
  const first = form.register('first');
  const second = form.register('second', {
    onBlur: () => {
      const { isSubmitting, isSubmitted } = control._formState;
      onSecondLeft({ isSubmitting, isSubmitted });
      onSecondBlur();
    },
  });
  const error = form.getFieldState('second', form.formState).error?.message;

  return (
    <form data-testid="form" noValidate onSubmit={form.handleSubmit(() => undefined)}>
      <input data-testid="first" {...first} />
      <input data-testid="second" {...second} />
      <output data-testid="second-error">{error ?? ''}</output>
    </form>
  );
}

/** Submits from the empty second field and returns what the control held at each blur of it. */
async function submitFromTheSecondField() {
  const atBlur: SubmitState[] = [];
  render(<TwoFields onSecondLeft={(state) => atBlur.push(state)} />);
  const form = screen.getByTestId('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('not a form');
  act(() => screen.getByTestId('second').focus());

  act(() => form.requestSubmit());

  // The library moves the focus to the first invalid field.
  await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('first')));
  return atBlur;
}

afterEach(cleanup);

describe('the submit state the blur helper depends on', () => {
  it('finds the control saying a submit is running when the library moves the focus', async () => {
    const atBlur = await submitFromTheSecondField();

    expect(atBlur).toEqual([{ isSubmitting: true, isSubmitted: false }]);
  });

  it('finds the control saying the form was submitted once the submit is over', async () => {
    const atBlur = await submitFromTheSecondField();
    await waitFor(() => expect(screen.getByTestId('second-error').textContent).toBe(REQUIRED));

    act(() => screen.getByTestId('second').focus());
    act(() => screen.getByTestId('first').focus());

    expect(atBlur).toEqual([
      { isSubmitting: true, isSubmitted: false },
      { isSubmitting: false, isSubmitted: true },
    ]);
  });

  it('keeps the message the submit gave the empty field, through both moves', async () => {
    await submitFromTheSecondField();
    await waitFor(() => expect(screen.getByTestId('second-error').textContent).toBe(REQUIRED));

    act(() => screen.getByTestId('second').focus());
    act(() => screen.getByTestId('first').focus());

    expect(screen.getByTestId('second-error').textContent).toBe(REQUIRED);
  });
});
