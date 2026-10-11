// @vitest-environment jsdom
import { createRef, useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from './alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

const PARTS = {
  dialog: {
    Root: Dialog,
    Content: DialogContent,
    Title: DialogTitle,
    Text: DialogDescription,
    cancel: null,
  },
  alert: {
    Root: AlertDialog,
    Content: AlertDialogContent,
    Title: AlertDialogTitle,
    Text: AlertDialogDescription,
    cancel: <AlertDialogCancel />,
  },
} as const;
type Kind = keyof typeof PARTS;

interface PanelProps {
  readonly kind: Kind;
  readonly id: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children?: ReactNode;
}

/** A dialog whose first field takes focus through the `autoFocus` attribute. */
function Panel({ kind, id, open, onOpenChange, children }: PanelProps) {
  const { Root, Content, Title, Text, cancel } = PARTS[kind];
  return (
    <Root open={open} onOpenChange={onOpenChange}>
      <Content data-testid={`${id}-panel`}>
        <Title />
        <Text />
        <input autoFocus data-testid={`${id}-field`} />
        {cancel}
        {children}
      </Content>
    </Root>
  );
}

interface HostProps {
  readonly kind: Kind;
  readonly id?: string;
  /** Mounts the dialog only once it is asked for, already open. */
  readonly mountWhenOpened?: boolean;
  readonly children?: ReactNode;
}

function Host({ kind, id = 'outer', mountWhenOpened = false, children }: HostProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-testid={`${id}-opener`} onClick={() => setOpen(true)} />
      <button data-testid={`${id}-elsewhere`} />
      {(open || !mountWhenOpened) && (
        <Panel kind={kind} id={id} open={open} onOpenChange={setOpen}>
          {children}
        </Panel>
      )}
    </>
  );
}

/** A page that gains its dialog, closed, after the button already holds focus. */
function LateHost({ kind }: { readonly kind: Kind }) {
  const [hasDialog, setHasDialog] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-testid="outer-opener" onClick={() => setOpen(true)} />
      <button data-testid="add-dialog" onClick={() => setHasDialog(true)} />
      {hasDialog && <Panel kind={kind} id="outer" open={open} onOpenChange={setOpen} />}
    </>
  );
}

const focusedId = () => document.activeElement?.getAttribute('data-testid') ?? null;

/** Presses a control and waits until the field of its dialog holds focus. */
async function openOnField(openerId: string, id: string) {
  fireEvent.click(screen.getByTestId(openerId));
  await waitFor(() => expect(focusedId()).toBe(`${id}-field`));
  return screen.getByTestId(`${id}-panel`);
}

/** Where focus is once a dialog has gone and has had its say about it. */
async function focusOnceClosed(panelId: string, expected: string | null) {
  await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
  await waitFor(() => expect(focusedId()).toBe(expected));
  // The return happens a tick after the dialog leaves: let a late move show itself.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return focusedId();
}

registerFormTestLifecycle();
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

describe.each(['dialog', 'alert'] as const)(
  'focus when a %s holding an auto-focused field closes',
  (kind) => {
    it('returns to the button that opened it', async () => {
      await renderForm('en', <Host kind={kind} />);
      screen.getByTestId('outer-opener').focus();
      const panel = await openOnField('outer-opener', 'outer');

      fireEvent.keyDown(panel, { key: 'Escape' });

      expect(await focusOnceClosed('outer-panel', 'outer-opener')).toBe('outer-opener');
    });

    it('returns to the button that opened it when the dialog is mounted already open', async () => {
      await renderForm('en', <Host kind={kind} mountWhenOpened />);
      screen.getByTestId('outer-opener').focus();
      const panel = await openOnField('outer-opener', 'outer');

      fireEvent.keyDown(panel, { key: 'Escape' });

      expect(await focusOnceClosed('outer-panel', 'outer-opener')).toBe('outer-opener');
    });

    it('returns to a button that held focus since before the dialog joined the page', async () => {
      await renderForm('en', <LateHost kind={kind} />);
      screen.getByTestId('outer-opener').focus();
      fireEvent.click(screen.getByTestId('add-dialog'));
      const panel = await openOnField('outer-opener', 'outer');

      fireEvent.keyDown(panel, { key: 'Escape' });

      expect(await focusOnceClosed('outer-panel', 'outer-opener')).toBe('outer-opener');
    });

    it('leaves focus to the library when nothing held focus as it opened', async () => {
      await renderForm('en', <Host kind={kind} />);
      const elsewhere = screen.getByTestId('outer-elsewhere');
      elsewhere.focus();
      elsewhere.blur();
      const panel = await openOnField('outer-opener', 'outer');

      fireEvent.keyDown(panel, { key: 'Escape' });

      expect(await focusOnceClosed('outer-panel', null)).toBeNull();
      expect(document.activeElement).toBe(document.body);
    });

    it('returns an inner dialog to its opener inside the outer one', async () => {
      await renderForm(
        'en',
        <Host kind={kind}>
          <Host kind={kind} id="inner" />
        </Host>,
      );
      screen.getByTestId('outer-opener').focus();
      await openOnField('outer-opener', 'outer');
      screen.getByTestId('inner-opener').focus();
      fireEvent.click(screen.getByTestId('inner-opener'));
      // The outer dialog takes focus back from the field, then the inner one claims it.
      const inner = await screen.findByTestId('inner-panel');
      await waitFor(() => expect(inner.contains(document.activeElement)).toBe(true));

      fireEvent.keyDown(inner, { key: 'Escape' });

      expect(await focusOnceClosed('inner-panel', 'inner-opener')).toBe('inner-opener');
      expect(screen.queryByTestId('outer-panel')).not.toBeNull();
    });
  },
);

describe.each(['dialog', 'alert'] as const)(
  'the content of a %s and the ref of its caller',
  (kind) => {
    const { Root, Content, Title, Text } = PARTS[kind];

    it('hands its element to an object ref and to a function ref', async () => {
      const held = createRef<HTMLDivElement>();
      const received: (string | null)[] = [];
      const receive = (element: HTMLDivElement | null) => {
        received.push(element?.getAttribute('data-testid') ?? null);
      };
      await renderForm(
        'en',
        <>
          <Root open>
            <Content ref={held} data-testid="held">
              <Title />
              <Text />
            </Content>
          </Root>
          <Root open>
            <Content ref={receive} data-testid="received">
              <Title />
              <Text />
            </Content>
          </Root>
        </>,
      );

      expect(held.current).toBe(await screen.findByTestId('held'));
      expect(received).toEqual(['received']);
    });
  },
);
