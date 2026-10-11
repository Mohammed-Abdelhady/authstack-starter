'use client';

import { lazy, Suspense, Activity } from 'react';
import { useTranslations } from 'next-intl';
import { LoadingRegion } from '@/components/layout/LoadingRegion';
import type { RemovalLanding } from '@/hooks/useRemovalFocus';
import type { Role } from '@/modules/roles/types';

const CreateRoleDialog = lazy(() =>
  import('@/modules/permissions/components/roles/CreateRoleDialog').then((mod) => ({
    default: mod.CreateRoleDialog,
  })),
);

const EditRoleDialog = lazy(() =>
  import('@/modules/permissions/components/roles/EditRoleDialog').then((mod) => ({
    default: mod.EditRoleDialog,
  })),
);

const DeleteRoleDialog = lazy(() =>
  import('@/modules/permissions/components/roles/DeleteRoleDialog').then((mod) => ({
    default: mod.DeleteRoleDialog,
  })),
);

export interface RoleDialogsProps {
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  editOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
  deleteOpen: boolean;
  onDeleteOpenChange: (open: boolean) => void;
  roleToEdit: Role | null;
  onSuccess: () => void;
  /** The heading that takes focus once a role is deleted. */
  deleteLanding?: RemovalLanding;
}

export function RoleDialogs({
  createOpen,
  onCreateOpenChange,
  editOpen,
  onEditOpenChange,
  deleteOpen,
  onDeleteOpenChange,
  roleToEdit,
  onSuccess,
  deleteLanding,
}: RoleDialogsProps) {
  const tCommon = useTranslations('common');

  return (
    <>
      <Activity mode={createOpen ? 'visible' : 'hidden'}>
        <Suspense
          fallback={
            <LoadingRegion
              label={tCommon('loading')}
              rows={2}
              testId="create-role-dialog-loading"
            />
          }
        >
          <CreateRoleDialog
            open={createOpen}
            onOpenChange={onCreateOpenChange}
            onSuccess={onSuccess}
          />
        </Suspense>
      </Activity>

      <Activity mode={editOpen ? 'visible' : 'hidden'}>
        <Suspense
          fallback={
            <LoadingRegion label={tCommon('loading')} rows={2} testId="edit-role-dialog-loading" />
          }
        >
          <EditRoleDialog
            open={editOpen}
            onOpenChange={onEditOpenChange}
            role={roleToEdit}
            onSuccess={onSuccess}
          />
        </Suspense>
      </Activity>

      <Activity mode={deleteOpen ? 'visible' : 'hidden'}>
        <Suspense
          fallback={
            <LoadingRegion
              label={tCommon('loading')}
              rows={2}
              testId="delete-role-dialog-loading"
            />
          }
        >
          <DeleteRoleDialog
            open={deleteOpen}
            onOpenChange={onDeleteOpenChange}
            role={roleToEdit}
            onSuccess={onSuccess}
            landing={deleteLanding}
          />
        </Suspense>
      </Activity>
    </>
  );
}
