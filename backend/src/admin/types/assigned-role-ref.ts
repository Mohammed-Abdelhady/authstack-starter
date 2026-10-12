export interface AssignedRoleRef {
  roleId: string;
  assignedSlug: string;
  previousRoleId?: string;
  created?: { updatedAt: Date; sessionVersion: number };
}
