'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const DialogBusyContext = createContext(false);

/** Whether the dialog around this element has a request in flight. */
export const useDialogBusy = () => useContext(DialogBusyContext);

interface DialogBusyProviderProps {
  readonly busy: boolean | undefined;
  readonly children: ReactNode;
}

export function DialogBusyProvider({ busy, children }: DialogBusyProviderProps) {
  return <DialogBusyContext.Provider value={busy === true}>{children}</DialogBusyContext.Provider>;
}

interface OpenState {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  busy?: boolean;
}

/**
 * A dialog whose request is in flight stays open until the request settles:
 * a close asked for from any source is dropped while `busy`. The open state is
 * kept here when the caller does not keep it, so the library cannot close the
 * dialog on its own.
 */
export function useHeldOpenState({ open, defaultOpen = false, onOpenChange, busy }: OpenState) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;

  const change = useCallback(
    (next: boolean) => {
      if (busy && !next) return;
      if (!isControlled) setOwnOpen(next);
      onOpenChange?.(next);
    },
    [busy, isControlled, onOpenChange],
  );

  return { open: isControlled ? open : ownOpen, onOpenChange: change };
}

interface Cancellable {
  preventDefault: () => void;
}

/**
 * Wraps a handler of one of the library's closing routes (Escape, a pointer
 * outside, an interaction outside). The library closes unless the event was
 * cancelled, so while busy the event is cancelled and the caller is not told.
 */
export function heldDismiss<E extends Cancellable>(
  busy: boolean,
  handler: ((event: E) => void) | undefined,
) {
  return (event: E) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
