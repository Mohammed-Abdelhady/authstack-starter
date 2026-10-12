'use client';

import { useState, lazy, Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { UserPlus } from 'lucide-react';

// Lazy load the dialog for code splitting
const CreateUserDialog = lazy(() =>
  import('./CreateUserDialog').then((mod) => ({
    default: mod.CreateUserDialog,
  })),
);

export interface CreateUserButtonProps {
  /** Optional callback when user is created successfully */
  onSuccess?: () => void;
  /** Additional className for the button */
  className?: string;
}

/**
 * CreateUserButton - Button with co-located create user dialog.
 *
 * Implements the co-location pattern where the button manages its own
 * dialog state internally. The dialog is lazy-loaded for performance.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <CreateUserButton />
 *
 * // With success callback
 * <CreateUserButton onSuccess={() => refetchUsers()} />
 * ```
 */
export function CreateUserButton({ onSuccess, className }: CreateUserButtonProps) {
  const t = useTranslations('users');
  const [open, setOpen] = useState(false);

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
  };

  const handleSuccess = () => {
    setOpen(false);
    onSuccess?.();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} className={className} data-testid="create-user-button">
        <UserPlus className="h-4 w-4 me-2" />
        {t('addUser')}
      </Button>

      {/* Co-located dialog with lazy loading */}
      {open && (
        <Suspense fallback={<div />}>
          <CreateUserDialog open={open} onOpenChange={handleOpenChange} onSuccess={handleSuccess} />
        </Suspense>
      )}
    </>
  );
}

export default CreateUserButton;
