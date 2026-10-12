import {
  mapMongoDriverError,
  MongoIndexConstraints,
} from '../../../common/persistence/mongo/mongo-driver-errors';
import { ROLE_CONSTRAINT } from '../../../role/stores/role-records';
import { ISSUANCE_CONSTRAINT } from '../../issuance/browser-issuance.store';

/** Index name to the rule's shared name. An unlisted index keeps its own name. */
const MONGO_INDEX_CONSTRAINTS: MongoIndexConstraints = {
  eventId_1: ISSUANCE_CONSTRAINT.SECURITY_EVENT_ID,
  tokenHash_unique: ISSUANCE_CONSTRAINT.SESSION_TOKEN_HASH,
  grant_user_client_unique: ISSUANCE_CONSTRAINT.GRANT_USER_CLIENT,
  slug_1: ROLE_CONSTRAINT.SLUG,
};

/**
 * The shared error for a driver failure. Anything else, an application error or
 * one that is already shared, comes back as it went in.
 */
export function mapMongoError(error: unknown): unknown {
  return mapMongoDriverError(error, MONGO_INDEX_CONSTRAINTS);
}
