import type { RoleAudience } from '@app/core';
import type { Session } from '@app/sdk';

export interface AdminSession extends Session {
  clientId: string;
}

export interface AdminSessionList {
  targetClass: RoleAudience;
  sessions: AdminSession[];
  total: number;
}

export interface AdminSessionScope {
  userId: string;
  actorId: string;
  sessionGeneration: number;
}

export interface EndAdminSession extends AdminSessionScope {
  sessionId: string;
}

export type SessionEndTarget = { session: AdminSession } | { all: true };
