import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { RoleAudience } from '../../../host/types/host-role.type';
import type { RoleChangeStore } from '../../stores/role-change.store';
import {
  bumpRoleHolderSessions,
  moveRoleHolders,
} from '../../sweeps/role-holder-sweep';

interface EditedRoleHolders {
  previousSlug: string;
  nextSlug: string;
  actorId: string;
  renamed: boolean;
  audience?: RoleAudience;
  audiencePolicyEnabled: boolean;
}

export async function revokeEditedRoleHolders(
  changes: RoleChangeStore,
  unitOfWork: UnitOfWork,
  edit: EditedRoleHolders,
): Promise<number> {
  const restrictMove = edit.renamed && edit.audiencePolicyEnabled;
  const moved = await moveRoleHolders(changes, unitOfWork, {
    fromSlugs: [edit.previousSlug],
    toSlug: edit.nextSlug,
    actorId: edit.actorId,
    ...(restrictMove ? { audience: edit.audience } : {}),
  });
  if (restrictMove) {
    // Remaining holders lose the old role's authority even when they cannot move.
    await bumpRoleHolderSessions(changes, unitOfWork, {
      fromSlugs: [edit.previousSlug],
      excludingAudience: edit.audience,
      actorId: edit.actorId,
    });
  }
  return moved;
}
