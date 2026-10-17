import { useCallback, useRef, useState, type RefObject } from 'react';
import { useStaffOperation } from '@/modules/auth/hooks/useStaffOperation';
import { useStaffDialogIntent } from '@/modules/auth/hooks/useStaffDialogIntent';
import { requireObservedVersion } from '@/modules/auth/utils/observedVersion';
import { showsOwnRefusal } from '@/lib/refusal';
import { useAddPermissionMutation, useRemovePermissionMutation } from '../api/permissionsApi';

interface PermissionView {
  open: boolean;
  userId: string | null;
  version: unknown;
  refetch: () => unknown;
  onAdded: (count: number) => void;
  onRemoved: () => void;
  onAddError: (error: unknown) => void;
  onRemoveError: (error: unknown) => void;
}

const SERVER_ERROR_STATUS_MIN = 500;

function outcomeUnknown(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return true;
  return typeof error.status !== 'number' || error.status >= SERVER_ERROR_STATUS_MIN;
}

interface MutationContext {
  operation: ReturnType<typeof useStaffOperation>;
  intent: ReturnType<typeof useStaffDialogIntent>;
  action: RefObject<'add' | 'remove' | null>;
  setRemoving: (permission: string | null) => void;
}

function canStart(view: PermissionView, context: MutationContext): boolean {
  return (
    view.open &&
    view.userId !== null &&
    context.action.current === null &&
    !context.operation.busy &&
    context.operation.methods === null
  );
}

async function reconcilePermissionRead(view: PermissionView): Promise<void> {
  try {
    await view.refetch();
  } catch {
    return;
  }
}

function addPermissions(
  view: PermissionView,
  context: MutationContext,
  addPermission: ReturnType<typeof useAddPermissionMutation>[0],
) {
  return async (permissions: string[]) => {
    if (!canStart(view, context) || !view.userId || permissions.length === 0) return;
    const userId = view.userId;
    const viewCurrent = context.intent.capture();
    const isCurrent = () => viewCurrent() && context.operation.isCurrent();
    let index = 0;
    let version = view.version;
    context.action.current = 'add';
    await context.operation
      .start({
        isCurrent,
        run: async () => {
          context.action.current = 'add';
          try {
            while (index < permissions.length && isCurrent()) {
              const permission = permissions[index];
              if (permission === undefined) return;
              const saved = await showsOwnRefusal(
                addPermission({
                  userId,
                  permission,
                  version: requireObservedVersion(version),
                }),
              ).unwrap();
              index += 1;
              version = requireObservedVersion(saved.version);
            }
          } finally {
            context.action.current = null;
          }
        },
        onSuccess: () => {
          context.action.current = null;
          view.onAdded(index);
        },
        onError: async (error) => {
          context.action.current = null;
          if (index > 0 || outcomeUnknown(error)) await reconcilePermissionRead(view);
          if (isCurrent()) view.onAddError(error);
        },
      })
      .finally(() => {
        context.action.current = null;
      });
  };
}

function removePermissionAction(
  view: PermissionView,
  context: MutationContext,
  removePermission: ReturnType<typeof useRemovePermissionMutation>[0],
) {
  return async (permission: string) => {
    if (!canStart(view, context) || !view.userId) return;
    const userId = view.userId;
    const viewCurrent = context.intent.capture();
    const isCurrent = () => viewCurrent() && context.operation.isCurrent();
    context.action.current = 'remove';
    context.setRemoving(permission);
    await context.operation
      .start({
        isCurrent,
        run: async () => {
          context.action.current = 'remove';
          try {
            return await showsOwnRefusal(
              removePermission({
                userId,
                permission,
                version: requireObservedVersion(view.version),
              }),
            ).unwrap();
          } finally {
            context.action.current = null;
          }
        },
        onSuccess: () => {
          context.action.current = null;
          context.setRemoving(null);
          view.onRemoved();
        },
        onError: async (error) => {
          context.action.current = null;
          if (outcomeUnknown(error)) await reconcilePermissionRead(view);
          if (!isCurrent()) return;
          context.setRemoving(null);
          view.onRemoveError(error);
        },
      })
      .finally(() => {
        context.action.current = null;
      });
  };
}

export function useUserPermissionMutations(view: PermissionView) {
  const [addPermission] = useAddPermissionMutation();
  const [removePermission] = useRemovePermissionMutation();
  const operation = useStaffOperation();
  const intent = useStaffDialogIntent(view.open, view.userId);
  const [removing, setRemoving] = useState<string | null>(null);
  const action = useRef<'add' | 'remove' | null>(null);
  const busy = operation.busy || operation.methods !== null;
  const { invalidate } = intent;
  const { cancelProof } = operation;
  const cancel = useCallback(() => {
    invalidate();
    cancelProof();
    action.current = null;
    setRemoving(null);
  }, [invalidate, cancelProof]);
  const context = { operation, intent, action, setRemoving };
  return {
    operation,
    add: (permissions: string[]) => addPermissions(view, context, addPermission)(permissions),
    remove: (permission: string) =>
      removePermissionAction(view, context, removePermission)(permission),
    cancel,
    removing: busy ? removing : null,
    busy,
  };
}
