import { Types } from 'mongoose';
import { MalformedIdError } from '../../../common/persistence/persistence-errors';
import {
  IssuanceAccount,
  IssuanceApplication,
  IssuanceGrant,
} from '../../issuance/browser-issuance.store';

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/** The stored id for an opaque one. Anything but 24 hex digits is refused. */
export function toObjectId(id: string): Types.ObjectId {
  if (!OBJECT_ID_PATTERN.test(id)) {
    throw new MalformedIdError();
  }
  return new Types.ObjectId(id);
}

export function toIssuanceAccount(user: {
  _id: Types.ObjectId;
  isDeleted?: boolean;
  sessionVersion?: number;
}): IssuanceAccount {
  return {
    id: user._id.toString(),
    isDeleted: Boolean(user.isDeleted),
    sessionVersion: user.sessionVersion ?? 0,
  };
}

export function toIssuanceApplication(application: {
  clientId: string;
  platform: string;
  enabled: boolean;
  sessionVersion?: number;
  allowedScopes: string[];
  policy: { absoluteLifetimeMs: number; idleLifetimeMs: number };
}): IssuanceApplication {
  return {
    clientId: application.clientId,
    platform: application.platform,
    enabled: application.enabled,
    sessionVersion: application.sessionVersion ?? 0,
    allowedScopes: [...application.allowedScopes],
    policy: {
      absoluteLifetimeMs: application.policy.absoluteLifetimeMs,
      idleLifetimeMs: application.policy.idleLifetimeMs,
    },
  };
}

export function toIssuanceGrant(grant: {
  _id: Types.ObjectId;
  clientId: string;
  allowed?: boolean;
  sessionVersion?: number;
}): IssuanceGrant {
  return {
    id: grant._id.toString(),
    clientId: grant.clientId,
    allowed: Boolean(grant.allowed),
    sessionVersion: grant.sessionVersion ?? 0,
  };
}
