// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
import * as LibraryDialog from '@radix-ui/react-dialog';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

type Kind = 'dialog' | 'alert';

interface HostProps {
  readonly kind: Kind;
  readonly busy: boolean;
  /** Left out, the library keeps the open state itself. */
  readonly controlled?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onEscapeKeyDown?: (event: KeyboardEvent) => void;
}

function Host({ kind, busy, controlled = true, onOpenChange, onEscapeKeyDown }: HostProps) {
  const [open, setOpen] = useState(true);
  const change = (next: boolean) => {
    onOpenChange?.(next);
    setOpen(next);
  };
  const state = controlled ? { open, onOpenChange: change } : { defaultOpen: true };
  if (kind === 'alert') {
    return (
      <AlertDialog busy={busy} {...state}>
        <AlertDialogContent data-testid="content" onEscapeKeyDown={onEscapeKeyDown}>
          <AlertDialogTitle />
          <AlertDialogDescription />
          <AlertDialogCancel data-testid="cancel" />
          <AlertDialogAction data-testid="confirm" />
        </AlertDialogContent>
      </AlertDialog>
    );
  }
  return (
    <Dialog busy={busy} {...state}>
      <DialogContent data-testid="content" onEscapeKeyDown={onEscapeKeyDown}>
        <DialogTitle />
        <DialogDescription />
        <DialogClose data-testid="own-close" />
        <LibraryDialog.Close data-testid="library-close" />
      </DialogContent>
    </Dialog>
  );
}

/** A dialog that is busy until the button beside it ends its request. */
function Settles(props: Omit<HostProps, 'busy'>) {
  const [busy, setBusy] = useState(true);
  return (
    <>
      <Host {...props} busy={busy} />
      <button data-testid="end-request" onClick={() => setBusy(false)} />
    </>
  );
}

/** Lets the library attach the document listener it uses for a press outside. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

const ROUTES = {
  escape: () => fireEvent.keyDown(screen.getByTestId('content'), { key: 'Escape' }),
  outside: () => fireEvent.pointerDown(document.body),
  closeControl: () => fireEvent.click(screen.getByTestId('dialog-close-button')),
  ownClose: () => fireEvent.click(screen.getByTestId('own-close')),
  // A close the wrappers of this folder never see.
  libraryClose: () => fireEvent.click(screen.getByTestId('library-close')),
  cancel: () => fireEvent.click(screen.getByTestId('cancel')),
  confirm: () => fireEvent.click(screen.getByTestId('confirm')),
} as const;
type Route = keyof typeof ROUTES;

const CASES: [Kind, Route][] = [
  ['dialog', 'escape'],
  ['dialog', 'outside'],
  ['dialog', 'closeControl'],
  ['dialog', 'ownClose'],
  ['dialog', 'libraryClose'],
  ['alert', 'escape'],
  ['alert', 'cancel'],
  ['alert', 'confirm'],
];

registerFormTestLifecycle();

describe('a dialog whose request is in flight', () => {
  it.each(CASES)(
    '%s stays open through %s when the library keeps the state',
    async (kind, route) => {
      await renderForm('en', <Host kind={kind} busy controlled={false} />);
      await settle();

      ROUTES[route]();
      await settle();

      expect(screen.queryByTestId('content')).not.toBeNull();
    },
  );

  it.each(CASES)('%s closes through %s once the request has settled', async (kind, route) => {
    const onOpenChange = vi.fn();
    await renderForm('en', <Settles kind={kind} onOpenChange={onOpenChange} />);
    await settle();
    ROUTES[route]();
    await settle();
    expect(onOpenChange.mock.calls).toEqual([]);

    fireEvent.click(screen.getByTestId('end-request'));
    ROUTES[route]();

    await waitFor(() => expect(onOpenChange.mock.calls).toEqual([[false]]));
    await waitFor(() => expect(screen.queryByTestId('content')).toBeNull());
  });

  it.each(['dialog', 'alert'] as const)(
    '%s closes on Escape when idle and the library keeps the state',
    async (kind) => {
      await renderForm('en', <Host kind={kind} busy={false} controlled={false} />);
      ROUTES.escape();
      await waitFor(() => expect(screen.queryByTestId('content')).toBeNull());
    },
  );

  it.each(['dialog', 'alert'] as const)(
    '%s does not tell the caller about Escape, and tells it once idle',
    async (kind) => {
      const onEscapeKeyDown = vi.fn();
      const { unmount } = await renderForm(
        'en',
        <Host kind={kind} busy onEscapeKeyDown={onEscapeKeyDown} />,
      );
      ROUTES.escape();
      expect(onEscapeKeyDown.mock.calls.length).toBe(0);
      unmount();

      await renderForm('en', <Host kind={kind} busy={false} onEscapeKeyDown={onEscapeKeyDown} />);
      ROUTES.escape();
      expect(onEscapeKeyDown.mock.calls.length).toBe(1);
    },
  );

  it('says its close control is unavailable, and available again once idle', async () => {
    const { unmount } = await renderForm('en', <Host kind="dialog" busy />);
    expect(availability(screen.getByTestId('dialog-close-button'))).toEqual(HELD);
    expect(availability(screen.getByTestId('own-close'))).toEqual(HELD);
    unmount();

    await renderForm('en', <Host kind="dialog" busy={false} />);
    expect(availability(screen.getByTestId('dialog-close-button'))).toEqual(IDLE);
    expect(availability(screen.getByTestId('own-close'))).toEqual(IDLE);
  });

  it('holds the buttons of a confirmation, and frees them once idle', async () => {
    const { unmount } = await renderForm('en', <Host kind="alert" busy />);
    expect(availability(screen.getByTestId('cancel'))).toEqual(HELD);
    expect(availability(screen.getByTestId('confirm'))).toEqual(HELD);
    unmount();

    await renderForm('en', <Host kind="alert" busy={false} />);
    expect(availability(screen.getByTestId('cancel'))).toEqual(IDLE);
    expect(availability(screen.getByTestId('confirm'))).toEqual(IDLE);
  });
});
