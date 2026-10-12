import { FilterQuery, Types } from 'mongoose';
import { CredentialPurpose } from '../../constants/credential-purpose';
import { AUTH_SCHEMA_VERSION } from '../../constants/session-policy';
import { Session } from './schemas/session.schema';

/** Sessions stored as live at `now` for these versions. A prefilter, not the rule. */
export function currentSessionCandidateFilter(
  userId: Types.ObjectId,
  now: Date,
  userVersion: number,
  authEpoch: number,
  credentialPurposes: CredentialPurpose[],
): FilterQuery<Session> {
  return {
    user: userId,
    isValid: true,
    revokedAt: null,
    expiresAt: { $gt: now, $type: 'date' },
    idleExpiresAt: { $gt: now, $type: 'date' },
    authenticatedAt: { $type: 'date' },
    lastActivityAt: { $type: 'date' },
    clientId: { $type: 'string', $ne: '' },
    clientVersion: { $type: 'number' },
    grantVersion: { $type: 'number' },
    credentialPurpose: { $in: credentialPurposes },
    authEpoch,
    schemaVersion: AUTH_SCHEMA_VERSION,
    userVersion,
  };
}
