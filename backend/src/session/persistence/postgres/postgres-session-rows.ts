import { StoredSession } from '../../authority/session-authority.store';
import {
  CREDENTIAL_PURPOSE,
  CredentialPurpose,
} from '../../constants/credential-purpose';
import { SessionDeviceLabel } from '../../issuance/browser-issuance.store';
import { RevocableSession } from '../../revocation/session-revocation.store';

export const STORED_SESSION_COLUMNS = [
  'id',
  'user_id',
  'user_agent',
  'ip',
  'device',
  'device_name',
  'last_used_at',
  'is_valid',
  'revoked_at',
  'credential_purpose',
  'auth_epoch',
  'schema_version',
  'client_id',
  'user_version',
  'client_version',
  'grant_version',
  'authenticated_at',
  'expires_at',
  'idle_expires_at',
  'last_activity_at',
  'proof_key_thumbprint',
  'csrf_token',
  'authentication_methods',
  'created_at',
] as const;

export interface StoredSessionRow {
  id: string;
  user_id: string;
  user_agent: string;
  ip: string;
  device: unknown;
  device_name: string | null;
  last_used_at: Date;
  is_valid: boolean;
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
  proof_key_thumbprint: string | null;
  csrf_token: string | null;
  authentication_methods: string[];
  created_at: Date;
}

export const REVOCABLE_SESSION_COLUMNS = [
  'id',
  'user_id',
  'client_id',
  'is_valid',
  'revoked_at',
  'user_version',
] as const;

export interface RevocableSessionRow {
  id: string;
  user_id: string;
  client_id: string;
  is_valid: boolean;
  revoked_at: Date | null;
  user_version: number;
}

const PURPOSES: readonly CredentialPurpose[] =
  Object.values(CREDENTIAL_PURPOSE);
const DEVICE_TYPES: readonly SessionDeviceLabel['type'][] = [
  'mobile',
  'tablet',
  'desktop',
  'unknown',
];

function toCredentialPurpose(stored: string): CredentialPurpose {
  const purpose = PURPOSES.find((known) => known === stored);
  if (!purpose) {
    throw new Error('A stored session has an unknown credential purpose');
  }
  return purpose;
}

function optionalText(source: object, field: string): string | undefined {
  const value: unknown = Reflect.get(source, field);
  return typeof value === 'string' ? value : undefined;
}

function toDeviceLabel(stored: unknown): SessionDeviceLabel | null {
  if (typeof stored !== 'object' || stored === null) {
    return null;
  }
  const type = DEVICE_TYPES.find(
    (known) => known === optionalText(stored, 'type'),
  );
  return {
    type: type ?? 'unknown',
    browser: optionalText(stored, 'browser'),
    os: optionalText(stored, 'os'),
    name: optionalText(stored, 'name'),
  };
}

export function toStoredSession(row: StoredSessionRow): StoredSession {
  return {
    id: row.id,
    userId: row.user_id,
    userAgent: row.user_agent,
    ip: row.ip,
    device: toDeviceLabel(row.device),
    deviceName: row.device_name,
    lastUsedAt: row.last_used_at,
    proofKeyThumbprint: row.proof_key_thumbprint,
    csrfToken: row.csrf_token,
    authenticationMethods: [...row.authentication_methods],
    createdAt: row.created_at,
    isValid: row.is_valid,
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
  };
}

export function toRevocableSession(row: RevocableSessionRow): RevocableSession {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    isValid: row.is_valid,
    revoked: row.revoked_at !== null,
    userVersion: row.user_version,
  };
}
