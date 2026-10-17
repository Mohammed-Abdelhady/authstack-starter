import { THROTTLE_TTL_15_MIN } from '../../../common/constants/throttle';

/** How long a started link waits for its finish. */
export const PROVIDER_LINK_TTL_MS = 10 * 60_000;

export const PROVIDER_LINK_RANDOM_BYTES = 32;
export const PROVIDER_LINK_STATE_BYTES = 16;
/** A link id is 32 random bytes in base64url. */
export const PROVIDER_LINK_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const THROTTLE_PROVIDER_LINK = {
  default: { limit: 10, ttl: THROTTLE_TTL_15_MIN },
} as const;
