import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { HEADING_ROLE_CLASSES } from '@/constants/typography';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:start-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:ps-7',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
        warning:
          'border-warning/50 bg-warning text-warning-foreground [&>svg]:text-warning-foreground',
        success:
          'border-success/50 bg-success text-success-foreground [&>svg]:text-success-foreground',
        info: 'border-info/50 bg-info text-info-foreground [&>svg]:text-info-foreground',
        // Soft: a tint of the status colour, for a note inside a page or a dialog.
        // The solid ones above are for the alert a whole page is about.
        infoSoft:
          'border-info/30 bg-info/10 text-foreground dark:border-info/40 dark:bg-info/20 [&>svg]:text-info',
        warningSoft:
          'border-warning/40 bg-warning/15 text-foreground dark:border-warning/40 dark:bg-warning/20 [&>svg]:text-status-warning',
        successSoft:
          'border-success/30 bg-success/10 text-foreground dark:border-success/40 dark:bg-success/20 [&>svg]:text-status-success',
        destructiveSoft:
          'border-destructive/30 bg-destructive/10 text-foreground dark:border-destructive/40 dark:bg-destructive/20 [&>svg]:text-status-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'>, VariantProps<typeof alertVariants> {
  /**
   * `alert` interrupts the screen reader for a live problem. Standing
   * informational banners use `note` so they are read in document order.
   */
  role?: 'alert' | 'note' | 'status';
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, role = 'alert', ...props }, ref) => (
    <div ref={ref} role={role} className={cn(alertVariants({ variant }), className)} {...props} />
  ),
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn(HEADING_ROLE_CLASSES.subsectionTitle, 'mb-1 text-inherit', className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
