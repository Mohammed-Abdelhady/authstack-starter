// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { registerFormTestLifecycle, renderForm } from '@/tests/serverRejectionHarness';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog';

const PARTS = {
  dialog: {
    Root: Dialog,
    Content: DialogContent,
    Title: DialogTitle,
    Description: DialogDescription,
    Trigger: DialogTrigger,
    dismiss: null,
    dismissId: 'dialog-close-button',
  },
  alert: {
    Root: AlertDialog,
    Content: AlertDialogContent,
    Title: AlertDialogTitle,
    Description: AlertDialogDescription,
    Trigger: AlertDialogTrigger,
    dismiss: <AlertDialogCancel data-testid="dismiss" />,
    dismissId: 'dismiss',
  },
} as const;
type Kind = keyof typeof PARTS;

interface HostProps {
  readonly kind: Kind;
  /** Prefix of the test ids, so two hosts can share a page. */
  readonly id?: string;
  readonly onOpenAutoFocus?: (event: Event) => void;
  readonly onCloseAutoFocus?: (event: Event) => void;
  /** Gives the dialog a trigger the library knows, beside the state that opens it. */
  readonly withLibraryTrigger?: boolean;
  readonly children?: ReactNode;
}

/** A dialog opened through state by a plain button, as most of the app's dialogs are. */
function Host({
  kind,
  id = 'outer',
  onOpenAutoFocus,
  onCloseAutoFocus,
  withLibraryTrigger,
  children,
}: HostProps) {
  const { Root, Content, Title, Description, Trigger, dismiss } = PARTS[kind];
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<'here' | 'disabled' | 'gone'>('here');
  return (
    <>
      {opener !== 'gone' && (
        <button
          data-testid={`${id}-opener`}
          disabled={opener === 'disabled'}
          onClick={() => setOpen(true)}
        />
      )}
      <button data-testid={`${id}-elsewhere`} />
      <Root open={open} onOpenChange={setOpen}>
        {withLibraryTrigger && <Trigger data-testid={`${id}-library-trigger`} />}
        <Content
          data-testid={`${id}-panel`}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Title />
          <Description />
          <button data-testid={`${id}-act`} onClick={() => setOpen(false)} />
          <button data-testid={`${id}-remove-opener`} onClick={() => setOpener('gone')} />
          <button data-testid={`${id}-disable-opener`} onClick={() => setOpener('disabled')} />
          {dismiss}
          {children}
        </Content>
      </Root>
    </>
  );
}

const focusedId = () => document.activeElement?.getAttribute('data-testid') ?? null;

/** Focuses a control and presses it, as a keyboard does, then waits for its dialog. */
async function openFrom(openerId: string, panelId: string) {
  const opener = screen.getByTestId(openerId);
  opener.focus();
  fireEvent.click(opener);
  const panel = await screen.findByTestId(panelId);
  await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
  return panel;
}

async function closed(panelId: string) {
  await waitFor(() => expect(screen.queryByTestId(panelId)).toBeNull());
}

/** Where focus is once a dialog has gone and has had its say about it. */
async function focusOnceClosed(panelId: string, expected: string | null) {
  await closed(panelId);
  await waitFor(() => expect(focusedId()).toBe(expected));
  // The return happens a tick after the dialog leaves: let a late move show itself.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return focusedId();
}

registerFormTestLifecycle();
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

describe.each(['dialog', 'alert'] as const)(
  'focus when a %s opened through state closes',
  (kind) => {
    it('returns to the button that opened it after Escape', async () => {
      await renderForm('en', <Host kind={kind} />);
      const panel = await openFrom('outer-opener', 'outer-panel');

      fireEvent.keyDown(panel, { key: 'Escape' });

      expect(await focusOnceClosed('outer-panel', 'outer-opener')).toBe('outer-opener');
    });

    it('returns to the button that opened it after its close control', async () => {
      await renderForm('en', <Host kind={kind} />);
      await openFrom('outer-opener', 'outer-panel');

      fireEvent.click(screen.getByTestId(PARTS[kind].dismissId));

      expect(await focusOnceClosed('outer-panel', 'outer-opener')).toBe('outer-opener');
    });

    it('returns to the button that opened it after an action inside closes it', async () => {
      await renderForm('en', <Host kind={kind} />);
      await openFrom('outer-opener', 'outer-panel');

      fireEvent.click(screen.getByTestId('outer-act'));

      expect(await focusOnceClosed('outer-panel', 'outer-opener')).toBe('outer-opener');
    });

    it.each(['remove', 'disable'] as const)(
      'leaves focus to the library when the opener can no longer take it: %s',
      async (change) => {
        await renderForm('en', <Host kind={kind} />);
        const panel = await openFrom('outer-opener', 'outer-panel');
        fireEvent.click(screen.getByTestId(`outer-${change}-opener`));

        fireEvent.keyDown(panel, { key: 'Escape' });

        expect(await focusOnceClosed('outer-panel', null)).toBeNull();
        expect(document.activeElement).toBe(document.body);
      },
    );

    it('returns an inner dialog to its opener inside the outer one, which stays open', async () => {
      await renderForm(
        'en',
        <Host kind={kind}>
          <Host kind={kind} id="inner" />
        </Host>,
      );
      await openFrom('outer-opener', 'outer-panel');
      const inner = await openFrom('inner-opener', 'inner-panel');

      fireEvent.keyDown(inner, { key: 'Escape' });

      expect(await focusOnceClosed('inner-panel', 'inner-opener')).toBe('inner-opener');
      expect(screen.getByTestId('outer-panel').contains(document.activeElement)).toBe(true);
    });

    it('leaves focus where the caller put it when the caller handles the close', async () => {
      const sendElsewhere = (event: Event) => {
        event.preventDefault();
        screen.getByTestId('outer-elsewhere').focus();
      };
      await renderForm('en', <Host kind={kind} onCloseAutoFocus={sendElsewhere} />);
      const panel = await openFrom('outer-opener', 'outer-panel');

      fireEvent.keyDown(panel, { key: 'Escape' });

      expect(await focusOnceClosed('outer-panel', 'outer-elsewhere')).toBe('outer-elsewhere');
    });

    it('still runs the caller handlers that do not take the open or the close over', async () => {
      const opened = vi.fn();
      const closing = vi.fn();
      await renderForm(
        'en',
        <Host kind={kind} onOpenAutoFocus={opened} onCloseAutoFocus={closing} />,
      );
      const panel = await openFrom('outer-opener', 'outer-panel');

      fireEvent.keyDown(panel, { key: 'Escape' });

      expect(await focusOnceClosed('outer-panel', 'outer-opener')).toBe('outer-opener');
      expect({ opened: opened.mock.calls.length, closing: closing.mock.calls.length }).toEqual({
        opened: 1,
        closing: 1,
      });
    });
  },
);

describe.each(['dialog', 'alert'] as const)(
  'focus when a %s with a library trigger closes',
  (kind) => {
    it('returns to the trigger that opened it, as before', async () => {
      await renderForm('en', <Host kind={kind} withLibraryTrigger />);
      const panel = await openFrom('outer-library-trigger', 'outer-panel');

      fireEvent.keyDown(panel, { key: 'Escape' });

      expect(await focusOnceClosed('outer-panel', 'outer-library-trigger')).toBe(
        'outer-library-trigger',
      );
    });

    it('goes to the trigger even when another button opened it through state, as before', async () => {
      await renderForm('en', <Host kind={kind} withLibraryTrigger />);
      const panel = await openFrom('outer-opener', 'outer-panel');

      fireEvent.keyDown(panel, { key: 'Escape' });

      expect(await focusOnceClosed('outer-panel', 'outer-library-trigger')).toBe(
        'outer-library-trigger',
      );
    });
  },
);
