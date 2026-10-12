import * as React from 'react';
import { useFormContext } from 'react-hook-form';
import { cn } from '@/lib/utils';

export interface FormRootErrorProps {
  id?: string;
  error?: string | null;
  testId?: string;
  className?: string;
}

export function FormRootError({
  id,
  error,
  testId = 'form-root-error',
  className,
}: FormRootErrorProps): React.JSX.Element | null {
  const formContext = useFormContext();
  const rootError = error ?? (formContext?.formState?.errors?.root?.message as string | undefined);

  if (!rootError) {
    return null;
  }

  return (
    <div
      id={id}
      className={cn(
        'mb-4 p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md',
        className,
      )}
      role="alert"
      aria-atomic="true"
      data-testid={testId}
    >
      {rootError}
    </div>
  );
}
