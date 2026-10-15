import { hasPermission } from '@app/core';
import type { RootState } from '@/store/store';
import type { AdminSessionScope } from '../types/admin-session.types';

export function sessionScopeIsCurrent(
  state: RootState,
  scope: AdminSessionScope,
  permission: string,
): boolean {
  const { auth } = state;
  return (
    auth.isAuthenticated &&
    auth.user?.id === scope.actorId &&
    auth.sessionGeneration === scope.sessionGeneration &&
    auth.user.id.toLowerCase() !== scope.userId.toLowerCase() &&
    hasPermission(auth.user.permissions, permission)
  );
}
