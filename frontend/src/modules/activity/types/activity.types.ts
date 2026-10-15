export interface ActivityEvent {
  id: string;
  actorId: string | null;
  targetUserId: string | null;
  clientId: string | null;
  sessionId: string | null;
  action: string;
  outcome: string;
  occurredAt: string;
  details: Record<string, string | number | boolean | string[]>;
  roleAssignment: { assignedRoleId: string; previousRoleId: string | null } | null;
}

export interface ActivityFilters {
  actor?: string;
  action?: string;
  target?: string;
  from?: string;
  to?: string;
}

export interface ActivityQuery extends ActivityFilters {
  actorId: string;
  sessionGeneration: number;
  page: number;
  limit: number;
}

export interface ActivityPage {
  data: ActivityEvent[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
