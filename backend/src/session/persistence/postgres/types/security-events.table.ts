import { ColumnType, Generated } from 'kysely';
import {
  ActivityDetails,
  SecurityEventKind,
} from '../../../events/types/activity-event';

export interface SecurityEventsTable {
  id: Generated<string>;
  event_id: string;
  kind: Generated<SecurityEventKind>;
  details: Generated<ActivityDetails>;
  target_user_id: string | null;
  client_id: string | null;
  session_id: string | null;
  action: string;
  outcome: string;
  occurred_at: ColumnType<Date, Date, Date>;
  actor_id: string | null;
  reason_code: string | null;
  assigned_role_id: string | null;
  previous_role_id: string | null;
  assignment_session_version: number | null;
  deleted_role_id: string | null;
  deleted_role_slug: string | null;
  deletion_sweep_id: string | null;
  deletion_pending: boolean | null;
  request_id: string | null;
  purge_after: ColumnType<Date, Date | undefined, never>;
}
