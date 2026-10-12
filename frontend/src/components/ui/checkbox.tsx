'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { BUSY_PRESS_CLASSES, busyPressProps } from './busy';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    /** The request of its form is running: it keeps focus and cannot be changed. */
    busy?: boolean;
  }
>(({ className, busy, onClick, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
      BUSY_PRESS_CLASSES,
      // The box stays 16px; the pointer target grows to the 24px minimum
      "relative before:absolute before:-inset-1 before:content-['']",
      className,
    )}
    {...props}
    {...busyPressProps(busy, onClick)}
  >
    <CheckboxPrimitive.Indicator className={cn('grid place-content-center text-current')}>
      <Check className="h-4 w-4" aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
