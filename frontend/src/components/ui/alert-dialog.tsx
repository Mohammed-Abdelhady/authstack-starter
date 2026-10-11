'use client';

import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';

import { DESCRIPTION_ROLE_CLASSES, HEADING_ROLE_CLASSES } from '@/constants/typography';
import { useOpenerFocus } from '@/hooks/useOpenerFocus';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { busyPressProps } from './busy';
import { DialogBusyProvider, heldDismiss, useDialogBusy, useHeldOpenState } from './dialog-busy';

export interface AlertDialogProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Root
> {
  /** Its request is in flight: it cannot be closed until the request settles. */
  busy?: boolean;
}

function AlertDialog({
  busy,
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: AlertDialogProps) {
  const state = useHeldOpenState({ open, defaultOpen, onOpenChange, busy });
  return (
    <AlertDialogPrimitive.Root {...props} {...state}>
      <DialogBusyProvider busy={busy}>{children}</DialogBusyProvider>
    </AlertDialogPrimitive.Root>
  );
}

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, onCloseAutoFocus, onEscapeKeyDown, ...props }, ref) => {
  const busy = useDialogBusy();
  const { contentRef, returnToOpener } = useOpenerFocus(ref, onCloseAutoFocus);
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={contentRef}
        className={cn(
          'fixed start-1/2 top-1/2 z-50 grid w-full max-w-lg ltr:-translate-x-1/2 rtl:translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 ltr:data-[state=closed]:slide-out-to-left-1/2 ltr:data-[state=open]:slide-in-from-left-1/2 rtl:data-[state=closed]:slide-out-to-right-1/2 rtl:data-[state=open]:slide-in-from-right-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
          className,
        )}
        {...props}
        onCloseAutoFocus={returnToOpener}
        onEscapeKeyDown={heldDismiss(busy, onEscapeKeyDown)}
      />
    </AlertDialogPortal>
  );
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-start', className)} {...props} />
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2', className)}
    {...props}
  />
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn(HEADING_ROLE_CLASSES.sectionTitle, className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn(DESCRIPTION_ROLE_CLASSES.description, className)}
    {...props}
  />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

interface BusyProps {
  /** The request it belongs to is running: it keeps focus and ignores presses. */
  busy?: boolean;
}

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & BusyProps
>(({ className, busy, onClick, ...props }, ref) => {
  const dialogBusy = useDialogBusy();
  return (
    <AlertDialogPrimitive.Action
      ref={ref}
      className={cn(buttonVariants(), className)}
      {...props}
      {...busyPressProps(busy || dialogBusy, onClick)}
    />
  );
});
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel> & BusyProps
>(({ className, busy, onClick, ...props }, ref) => {
  const dialogBusy = useDialogBusy();
  return (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      className={cn(buttonVariants({ variant: 'outline' }), 'mt-2 sm:mt-0', className)}
      {...props}
      {...busyPressProps(busy || dialogBusy, onClick)}
    />
  );
});
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
