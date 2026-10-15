import type { ApplicationSignInMethods } from '../../applications/types/application-sign-in-methods';
import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import type { SIGN_UP_POLICY } from '../../../config/constants/host-contracts';
import type { RoleAudience } from '../../../host/types/host-role.type';
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
  sign_up: (typeof SIGN_UP_POLICY)[keyof typeof SIGN_UP_POLICY];
  require_passkey: boolean;
  sign_in_methods: ApplicationSignInMethods | null;
  account_audience: RoleAudience | null;
  policy_version: number;
  session_cap: number | null;
  unbound_absolute_lifetime_ms: string | null;
  unbound_idle_lifetime_ms: string | null;
  absolute_lifetime_ms: string;
  idle_lifetime_ms: string;
}

export const APPLICATION_COLUMNS = [
  'client_id',
  'platform',
  'enabled',
  'session_version',
  'allowed_scopes',
  'sign_up',
  'require_passkey',
  'sign_in_methods',
  'account_audience',
  'policy_version',
  'session_cap',
  'unbound_absolute_lifetime_ms',
  'unbound_idle_lifetime_ms',
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
    signUp: row.sign_up,
    requirePasskey: row.require_passkey,
    signInMethods: row.sign_in_methods ?? null,
    accountAudience: row.account_audience ?? undefined,
    policyVersion: row.policy_version,
    sessionCap: row.session_cap ?? undefined,
    policy: {
      absoluteLifetimeMs: Number.parseInt(row.absolute_lifetime_ms, 10),
      idleLifetimeMs: Number.parseInt(row.idle_lifetime_ms, 10),
      unboundAbsoluteLifetimeMs:
        row.unbound_absolute_lifetime_ms === null
          ? undefined
          : Number.parseInt(row.unbound_absolute_lifetime_ms, 10),
      unboundIdleLifetimeMs:
        row.unbound_idle_lifetime_ms === null
          ? undefined
          : Number.parseInt(row.unbound_idle_lifetime_ms, 10),
    },
  };
}
