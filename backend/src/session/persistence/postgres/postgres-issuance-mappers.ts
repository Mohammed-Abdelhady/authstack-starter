import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import { IssuanceApplication } from '../../issuance/browser-issuance.store';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refuses a malformed id before it reaches the server, where the failed cast
 * would also abort the transaction it arrived in.
 */
export function toUuid(id: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw new MalformedIdError();
  }
  return id.toLowerCase();
}

export interface ApplicationRow {
  client_id: string;
  platform: string;
  enabled: boolean;
  session_version: number;
  allowed_scopes: string[];
  absolute_lifetime_ms: string;
  idle_lifetime_ms: string;
}

export const APPLICATION_COLUMNS = [
  'client_id',
  'platform',
  'enabled',
  'session_version',
  'allowed_scopes',
  'absolute_lifetime_ms',
  'idle_lifetime_ms',
] as const;

export function toIssuanceApplication(
  row: ApplicationRow,
): IssuanceApplication {
  return {
    clientId: row.client_id,
    platform: row.platform,
    enabled: row.enabled,
    sessionVersion: row.session_version,
    allowedScopes: row.allowed_scopes,
    policy: {
      absoluteLifetimeMs: Number.parseInt(row.absolute_lifetime_ms, 10),
      idleLifetimeMs: Number.parseInt(row.idle_lifetime_ms, 10),
    },
  };
}
