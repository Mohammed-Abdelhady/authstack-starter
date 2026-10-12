// @vitest-environment jsdom
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { availability, HELD, IDLE } from '@/tests/busyControls';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from './alert-dialog';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Input } from './input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { Textarea } from './textarea';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const focusedId = () => document.activeElement?.getAttribute('data-testid') ?? null;

/** A control that turns busy when the button beside it is pressed. */
function BecomesBusy({ children }: { readonly children: (busy: boolean) => React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      {children(busy)}
      <button data-testid="start" onClick={() => setBusy(true)} />
    </>
  );
}

interface FruitSelectProps {
  readonly busy: boolean;
  readonly onValueChange: (value: string) => void;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

function FruitSelect({ busy, onValueChange, open, onOpenChange }: FruitSelectProps) {
  return (
    <Select
      value="apple"
      busy={busy}
      onValueChange={onValueChange}
      open={open}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger data-testid="control">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
      </SelectContent>
    </Select>
  );
}

interface ConfirmationProps {
  readonly busy: boolean;
  readonly onConfirm: () => void;
}

function Confirmation({ busy, onConfirm }: ConfirmationProps) {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogContent data-testid="confirmation">
        <AlertDialogTitle />
        <AlertDialogDescription />
        <AlertDialogCancel busy={busy} data-testid="cancel" />
        <AlertDialogAction busy={busy} onClick={onConfirm} data-testid="confirm" />
      </AlertDialogContent>
    </AlertDialog>
  );
}

beforeAll(() => {
  // The list of a select needs two DOM methods jsdom does not have.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => undefined;
});

registerFormTestLifecycle();

describe('a control that turns busy while it holds focus', () => {
  it.each([
    ['button', (busy: boolean) => <Button busy={busy} data-testid="control" />],
    ['text field', (busy: boolean) => <Input busy={busy} data-testid="control" />],
    ['text area', (busy: boolean) => <Textarea busy={busy} data-testid="control" />],
    ['checkbox', (busy: boolean) => <Checkbox busy={busy} data-testid="control" />],
    ['select', (busy: boolean) => <FruitSelect busy={busy} onValueChange={() => undefined} />],
  ] as const)('keeps the focus and says it is unavailable: %s', async (_name, control) => {
    await renderForm('en', <BecomesBusy>{control}</BecomesBusy>);
    const element = screen.getByTestId('control');
    element.focus();
    expect(availability(element)).toEqual(IDLE);

    fireEvent.click(screen.getByTestId('start'));

    await waitFor(() => expect(availability(element)).toEqual(HELD));
    // The page body would hold focus here had the control been disabled.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(focusedId()).toBe('control');
  });
});

describe('a busy button', () => {
  it('takes a press itself: nothing around it hears the click, and it keeps the focus', async () => {
    const heardAround = vi.fn();
    await renderForm(
      'en',
      <div onClick={heardAround} data-testid="around">
        <Button busy data-testid="b" />
        <Button data-testid="idle" />
      </div>,
    );
    const button = screen.getByTestId('b');
    button.focus();

    fireEvent.click(button);

    expect(heardAround.mock.calls.length).toBe(0);
    expect(document.activeElement).toBe(button);
    // An idle button is heard as before.
    fireEvent.click(screen.getByTestId('idle'));
    expect(heardAround.mock.calls.length).toBe(1);
  });

  it('ignores a press, and obeys it again once it is idle', async () => {
    const onClick = vi.fn();
    const { unmount } = await renderForm('en', <Button busy onClick={onClick} data-testid="b" />);
    fireEvent.click(screen.getByTestId('b'));
    expect(onClick.mock.calls.length).toBe(0);
    unmount();

    await renderForm('en', <Button busy={false} onClick={onClick} data-testid="b" />);
    fireEvent.click(screen.getByTestId('b'));
    expect(onClick.mock.calls.length).toBe(1);
  });

  it.each([
    [true, 0],
    [false, 1],
  ])('as the submit button of a form: busy %s sends the form %i times', async (busy, sent) => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    await renderForm(
      'en',
      <form onSubmit={onSubmit}>
        <Button type="submit" busy={busy} data-testid="send" />
      </form>,
    );

    fireEvent.click(screen.getByTestId('send'));

    expect(onSubmit.mock.calls.length).toBe(sent);
  });

  it('leaves a caller that marks the button unavailable itself in charge of the press', async () => {
    const onClick = vi.fn();
    await renderForm('en', <Button aria-disabled onClick={onClick} data-testid="b" />);

    fireEvent.click(screen.getByTestId('b'));

    expect(onClick.mock.calls.length).toBe(1);
    expect(availability(screen.getByTestId('b'))).toEqual(HELD);
  });
});

describe('a busy text field', () => {
  it.each([
    ['text field', Input],
    ['text area', Textarea],
  ] as const)('cannot be edited, and can again once idle: %s', async (_name, Field) => {
    const { unmount } = await renderForm('en', <Field busy data-testid="f" />);
    expect(screen.getByTestId('f')).toHaveProperty('readOnly', true);
    unmount();

    await renderForm('en', <Field busy={false} data-testid="f" />);
    expect(screen.getByTestId('f')).toHaveProperty('readOnly', false);
  });

  it('keeps a field read-only when its caller says so, busy or not', async () => {
    await renderForm('en', <Input busy={false} readOnly data-testid="f" />);

    expect(screen.getByTestId('f')).toHaveProperty('readOnly', true);
    expect(availability(screen.getByTestId('f'))).toEqual(IDLE);
  });
});

describe('a busy checkbox', () => {
  it.each([
    [true, []],
    [false, [true]],
  ])('busy %s reports these changes when pressed: %j', async (busy, changes) => {
    const seen: unknown[] = [];
    await renderForm(
      'en',
      <Checkbox busy={busy} onCheckedChange={(next) => seen.push(next)} data-testid="c" />,
    );

    fireEvent.click(screen.getByTestId('c'));

    expect(seen).toEqual(changes);
  });
});

describe('a busy select', () => {
  it('does not open and does not change its value from the keyboard', async () => {
    const onValueChange = vi.fn();
    await renderForm('en', <FruitSelect busy onValueChange={onValueChange} />);
    const trigger = screen.getByTestId('control');
    trigger.focus();

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    // Typing on a closed select picks the option that starts with the letter.
    fireEvent.keyDown(trigger, { key: 'b' });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onValueChange.mock.calls).toEqual([]);
  });

  it('opens from the keyboard and reports the chosen value once it is idle', async () => {
    const onValueChange = vi.fn();
    await renderForm('en', <FruitSelect busy={false} onValueChange={onValueChange} />);
    const trigger = screen.getByTestId('control');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'Banana' }), { key: 'Enter' });

    expect(onValueChange.mock.calls).toEqual([['banana']]);
  });

  it('picks an option by its first letter while closed and idle', async () => {
    const onValueChange = vi.fn();
    await renderForm('en', <FruitSelect busy={false} onValueChange={onValueChange} />);

    fireEvent.keyDown(screen.getByTestId('control'), { key: 'b' });

    await waitFor(() => expect(onValueChange.mock.calls).toEqual([['banana']]));
  });

  it('still follows a caller that owns whether it is open', async () => {
    const onOpenChange = vi.fn();
    await renderForm(
      'en',
      <FruitSelect busy={false} onValueChange={() => undefined} open onOpenChange={onOpenChange} />,
    );

    fireEvent.keyDown(await screen.findByRole('listbox'), { key: 'Escape' });

    expect(onOpenChange.mock.calls).toEqual([[false]]);
    expect(screen.queryByRole('listbox')).not.toBeNull();
  });
});

describe('the buttons of a confirmation while its request runs', () => {
  it('neither act nor close it when pressed', async () => {
    const onConfirm = vi.fn();
    await renderForm('en', <Confirmation busy onConfirm={onConfirm} />);
    await screen.findByTestId('confirmation');

    fireEvent.click(screen.getByTestId('confirm'));
    fireEvent.click(screen.getByTestId('cancel'));

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(onConfirm.mock.calls.length).toBe(0);
    expect(screen.queryByTestId('confirmation')).not.toBeNull();
    expect(availability(screen.getByTestId('confirm'))).toEqual(HELD);
    expect(availability(screen.getByTestId('cancel'))).toEqual(HELD);
  });

  it.each(['confirm', 'cancel'] as const)('close it when idle and pressed: %s', async (button) => {
    const onConfirm = vi.fn();
    await renderForm('en', <Confirmation busy={false} onConfirm={onConfirm} />);
    await screen.findByTestId('confirmation');

    fireEvent.click(screen.getByTestId(button));

    await waitFor(() => expect(screen.queryByTestId('confirmation')).toBeNull());
    expect(onConfirm.mock.calls.length).toBe(button === 'confirm' ? 1 : 0);
  });
});
