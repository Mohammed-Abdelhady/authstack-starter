import type { HashService } from '../../../common/services/hash.service';
import { idempotencyKeyReused } from '../../utils/request-fingerprint';

export async function assertReplayedPassword(
  hashes: Pick<HashService, 'compare'>,
  savedHash: string | null,
  password: string,
): Promise<void> {
  if (savedHash === null || !(await hashes.compare(password, savedHash)))
    throw idempotencyKeyReused();
}
