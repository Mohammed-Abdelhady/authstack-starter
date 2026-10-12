'use client';

import { withoutUnsafeMarkup } from '@/lib/unsafeMarkup';
import type { SafeMarkupProps } from '@/types/markup';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TEXT_CONTROL_FONT_SIZE } from '@/lib/config/form-styles';
import { BUSY_FIELD_CLASSES, HELD_ATTRIBUTES } from './busy';

interface SelectState {
  busy: boolean;
  /** The values of the options that can be reached and not chosen. */
  unavailable: React.RefObject<Set<string>>;
}

const SelectStateContext = React.createContext<SelectState | null>(null);

/** The keys the library chooses an option with. */
const CHOOSING_KEYS = new Set(['Enter', ' ']);

interface SelectProps extends SafeMarkupProps<React.ComponentProps<typeof SelectPrimitive.Root>> {
  /**
   * A request that depends on it is running: the trigger keeps focus, the list
   * does not open and the value does not change.
   */
  busy?: boolean;
}

function Select({
  busy = false,
  open,
  defaultOpen = false,
  onOpenChange,
  onValueChange,
  ...props
}: SelectProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  const unavailable = React.useRef(new Set<string>());
  const state = React.useMemo(() => ({ busy, unavailable }), [busy]);

  const changeOpen = (next: boolean) => {
    if (busy && next) return;
    setIsOpen(next);
    onOpenChange?.(next);
  };
  // Typing on the closed trigger reaches a value without going through its option.
  const changeValue = (value: string) => {
    if (!busy && !unavailable.current.has(value)) onValueChange?.(value);
  };

  return (
    <SelectStateContext.Provider value={state}>
      <SelectPrimitive.Root
        {...withoutUnsafeMarkup(props)}
        open={open ?? isOpen}
        onOpenChange={changeOpen}
        onValueChange={changeValue}
      />
    </SelectStateContext.Provider>
  );
}

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>>
>(({ className, children, ...props }, ref) => {
  const busy = React.useContext(SelectStateContext)?.busy ?? false;
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        // The gap keeps the chevron off the text when a name is cut at the chevron's side.
        'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:min-w-0 [&>span]:truncate',
        BUSY_FIELD_CLASSES,
        TEXT_CONTROL_FONT_SIZE,
        className,
      )}
      {...withoutUnsafeMarkup(props)}
      {...(busy ? HELD_ATTRIBUTES : undefined)}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...withoutUnsafeMarkup(props)}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...withoutUnsafeMarkup(props)}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-50 max-h-(--radix-select-content-available-height) max-w-(--radix-select-content-available-width) min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 ltr:data-[side=left]:slide-in-from-right-2 ltr:data-[side=right]:slide-in-from-left-2 rtl:data-[side=left]:slide-in-from-left-2 rtl:data-[side=right]:slide-in-from-right-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-select-content-transform-origin)',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 ltr:data-[side=left]:-translate-x-1 ltr:data-[side=right]:translate-x-1 rtl:data-[side=left]:translate-x-1 rtl:data-[side=right]:-translate-x-1 data-[side=top]:-translate-y-1',
        className,
      )}
      position={position}
      {...withoutUnsafeMarkup(props)}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('py-1.5 ps-8 pe-2 text-sm font-semibold', className)}
    {...withoutUnsafeMarkup(props)}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

interface SelectItemProps extends SafeMarkupProps<
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
> {
  /**
   * Why this option cannot be chosen. It is shown in the option and read as
   * its description. The library skips an option given `disabled` with the
   * arrow keys, Home, End and typing, so nobody on a keyboard or a screen
   * reader would ever reach the reason: an option given this stays reachable
   * and only choosing it does nothing.
   */
  unavailableReason?: React.ReactNode;
}

function cancel(event: { preventDefault: () => void }) {
  // The library chooses the option unless the event was cancelled.
  event.preventDefault();
}

function cancelChoosingKey(event: React.KeyboardEvent) {
  if (CHOOSING_KEYS.has(event.key)) event.preventDefault();
}

const SelectItem = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Item>, SelectItemProps>(
  ({ className, children, unavailableReason, value, ...props }, ref) => {
    const reasonId = React.useId();
    const unavailable = React.useContext(SelectStateContext)?.unavailable;
    const isUnavailable = unavailableReason !== undefined && unavailableReason !== null;

    React.useEffect(() => {
      const values = unavailable?.current;
      if (!isUnavailable || !values) return;
      values.add(value);
      return () => {
        values.delete(value);
      };
    }, [isUnavailable, unavailable, value]);

    const held = isUnavailable
      ? {
          'aria-disabled': true,
          'aria-describedby': reasonId,
          onClick: cancel,
          onPointerUp: cancel,
          onKeyDown: cancelChoosingKey,
        }
      : undefined;

    return (
      <SelectPrimitive.Item
        ref={ref}
        value={value}
        className={cn(
          'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 ps-8 pe-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 aria-disabled:cursor-not-allowed',
          className,
        )}
        {...withoutUnsafeMarkup(props)}
        {...held}
      >
        <span className="absolute start-2 flex h-3.5 w-3.5 items-center justify-center">
          <SelectPrimitive.ItemIndicator>
            <Check className="h-4 w-4" />
          </SelectPrimitive.ItemIndicator>
        </span>

        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {isUnavailable && <span id={reasonId}>{unavailableReason}</span>}
      </SelectPrimitive.Item>
    );
  },
);
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  SafeMarkupProps<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-muted', className)}
    {...withoutUnsafeMarkup(props)}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
