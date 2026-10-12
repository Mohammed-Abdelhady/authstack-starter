'use client';

import { withoutUnsafeMarkup } from '@/lib/unsafeMarkup';
import type { SafeMarkupProps } from '@/types/markup';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';

import { FOCUS_RING_CLASSES } from '@/constants/focusStyles';
import { DESCRIPTION_ROLE_CLASSES, HEADING_ROLE_CLASSES } from '@/constants/typography';
import { WRAP_ANYWHERE_CLASSES } from '@/constants/textWrap';
import { useOpenerFocus } from '@/hooks/useOpenerFocus';
import { cn } from '@/lib/utils';
import { busyPressProps } from './busy';
import { DialogBusyProvider, heldDismiss, useDialogBusy, useHeldOpenState } from './dialog-busy';

export interface DialogProps extends SafeMarkupProps<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>
> {
  /** Its request is in flight: it cannot be closed until the request settles. */
  busy?: boolean;
}

function Dialog({ busy, open, defaultOpen, onOpenChange, children, ...props }: DialogProps) {
  const state = useHeldOpenState({ open, defaultOpen, onOpenChange, busy });
  return (
    <DialogPrimitive.Root {...withoutUnsafeMarkup(props)} {...state}>
      <DialogBusyProvider busy={busy}>{children}</DialogBusyProvider>
    </DialogPrimitive.Root>
  );
}

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Close>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>>
>(({ onClick, ...props }, ref) => {
  const busy = useDialogBusy();
  return (
    <DialogPrimitive.Close
      ref={ref}
      {...withoutUnsafeMarkup(props)}
      {...busyPressProps(busy, onClick)}
    />
  );
});
DialogClose.displayName = DialogPrimitive.Close.displayName;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...withoutUnsafeMarkup(props)}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>
>(
  (
    {
      className,
      children,
      onCloseAutoFocus,
      onEscapeKeyDown,
      onPointerDownOutside,
      onInteractOutside,
      ...props
    },
    ref,
  ) => {
    const t = useTranslations('common');
    const busy = useDialogBusy();
    const { contentRef, returnToOpener } = useOpenerFocus(ref, onCloseAutoFocus);

    return (
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={contentRef}
          className={cn(
            'fixed start-1/2 top-1/2 z-50 grid w-full max-w-lg grid-cols-[minmax(0,1fr)] ltr:-translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ltr:data-[state=closed]:slide-out-to-left-1/2 ltr:data-[state=open]:slide-in-from-left-1/2 rtl:data-[state=closed]:slide-out-to-right-1/2 rtl:data-[state=open]:slide-in-from-right-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
            className,
          )}
          {...withoutUnsafeMarkup(props)}
          onCloseAutoFocus={returnToOpener}
          onEscapeKeyDown={heldDismiss(busy, onEscapeKeyDown)}
          onPointerDownOutside={heldDismiss(busy, onPointerDownOutside)}
          onInteractOutside={heldDismiss(busy, onInteractOutside)}
        >
          {children}
          <DialogClose
            className={cn(
              'absolute end-4 top-4 flex h-9 w-9 items-center justify-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 aria-disabled:cursor-progress aria-disabled:opacity-50 data-[state=open]:bg-accent data-[state=open]:text-muted-foreground',
              FOCUS_RING_CLASSES,
            )}
            data-testid="dialog-close-button"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('close')}</span>
          </DialogClose>
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: SafeMarkupProps<React.HTMLAttributes<HTMLDivElement>>) => (
  <div
    className={cn('flex flex-col space-y-1.5 text-center sm:text-start', className)}
    {...withoutUnsafeMarkup(props)}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({
  className,
  ...props
}: SafeMarkupProps<React.HTMLAttributes<HTMLDivElement>>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2', className)}
    {...withoutUnsafeMarkup(props)}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(HEADING_ROLE_CLASSES.sectionTitle, WRAP_ANYWHERE_CLASSES, className)}
    {...withoutUnsafeMarkup(props)}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(DESCRIPTION_ROLE_CLASSES.description, WRAP_ANYWHERE_CLASSES, className)}
    {...withoutUnsafeMarkup(props)}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
