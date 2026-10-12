import { forwardRef, type HTMLAttributes } from 'react';
import { DESCRIPTION_ROLE_CLASSES, type DescriptionVariant } from '@/constants/typography';
import { withoutUnsafeMarkup } from '@/lib/unsafeMarkup';
import type { UnsafeMarkupProp } from '@/types/markup';
import { cn } from '@/lib/utils';

export interface DescriptionProps extends Omit<
  HTMLAttributes<HTMLParagraphElement>,
  UnsafeMarkupProp
> {
  /** `lead` is the larger intro under a display title. */
  variant?: DescriptionVariant;
}

export const Description = forwardRef<HTMLParagraphElement, DescriptionProps>(
  ({ variant = 'description', className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn(DESCRIPTION_ROLE_CLASSES[variant], className)}
      {...withoutUnsafeMarkup(props)}
    />
  ),
);

Description.displayName = 'Description';
