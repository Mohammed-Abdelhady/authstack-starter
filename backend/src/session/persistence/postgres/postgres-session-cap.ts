import type { ApplicationSignInMethods } from '../../applications/types/application-sign-in-methods';
import { SIGN_UP_POLICY } from '../../../config/constants/host-contracts';
import type { RoleAudience } from '../../../host/types/host-role.type';
import {
  CREDENTIAL_PURPOSE,
  CredentialPurpose,
} from '../../constants/credential-purpose';
import { SessionCapCandidate } from '../../issuance/browser-issuance.store';

/** One session joined to its application and grant. A missing side is all null. */
export interface SessionCapRow {
  is_valid: boolean;
  proof_key_thumbprint: string | null;
  user_verified: boolean;
  session_policy_version: number;
  sign_up: (typeof SIGN_UP_POLICY)[keyof typeof SIGN_UP_POLICY] | null;
  require_passkey: boolean | null;
  sign_in_methods: ApplicationSignInMethods | null;
  account_audience: RoleAudience | null;
  policy_version: number | null;
  session_cap: number | null;
  unbound_absolute_lifetime_ms: string | null;
  unbound_idle_lifetime_ms: string | null;
  revoked_at: Date | null;
  credential_purpose: string;
  auth_epoch: number;
  schema_version: number;
  client_id: string;
  user_version: number;
  client_version: number;
  grant_version: number;
  authenticated_at: Date;
  expires_at: Date;
  idle_expires_at: Date;
  last_activity_at: Date;
  application_platform: string | null;
  application_enabled: boolean | null;
  application_session_version: number | null;
  application_allowed_scopes: string[] | null;
  absolute_lifetime_ms: string | null;
  idle_lifetime_ms: string | null;
  grant_id: string | null;
  grant_allowed: boolean | null;
  grant_session_version: number | null;
}

const PURPOSES: readonly CredentialPurpose[] =
  Object.values(CREDENTIAL_PURPOSE);

function toCredentialPurpose(stored: string): CredentialPurpose {
  const purpose = PURPOSES.find((known) => known === stored);
  if (!purpose) {
    throw new Error('A stored session has an unknown credential purpose');
  }
  return purpose;
}

function applicationOf(row: SessionCapRow): SessionCapCandidate['application'] {
  if (
    row.application_platform === null ||
    row.application_enabled === null ||
    row.application_session_version === null ||
    row.absolute_lifetime_ms === null ||
    row.idle_lifetime_ms === null
  ) {
    return null;
  }
  return {
    clientId: row.client_id,
    platform: row.application_platform,
    enabled: row.application_enabled,
    sessionVersion: row.application_session_version,
    allowedScopes: row.application_allowed_scopes ?? [],
    signUp: row.sign_up ?? SIGN_UP_POLICY.OPEN,
    requirePasskey: row.require_passkey ?? false,
    signInMethods: row.sign_in_methods ?? null,
    accountAudience: row.account_audience ?? undefined,
    policyVersion: row.policy_version ?? 0,
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

function grantOf(row: SessionCapRow): SessionCapCandidate['grant'] {
  if (
    row.grant_id === null ||
    row.grant_allowed === null ||
    row.grant_session_version === null
  ) {
    return null;
  }
  return {
    id: row.grant_id,
    clientId: row.client_id,
    allowed: row.grant_allowed,
    sessionVersion: row.grant_session_version,
  };
}

export function toSessionCapCandidate(row: SessionCapRow): SessionCapCandidate {
  return {
    session: {
      isValid: row.is_valid,
      proofKeyThumbprint: row.proof_key_thumbprint,
      userVerified: row.user_verified,
      policyVersion: row.session_policy_version,
      revokedAt: row.revoked_at,
      credentialPurpose: toCredentialPurpose(row.credential_purpose),
      authEpoch: row.auth_epoch,
      schemaVersion: row.schema_version,
      clientId: row.client_id,
      userVersion: row.user_version,
      clientVersion: row.client_version,
      grantVersion: row.grant_version,
      authenticatedAt: row.authenticated_at,
      expiresAt: row.expires_at,
      idleExpiresAt: row.idle_expires_at,
      lastActivityAt: row.last_activity_at,
    },
    application: applicationOf(row),
    grant: grantOf(row),
  };
}
