import { StoredPasskey } from '../stores/passkey.store';
import { PasskeySummaryDto } from '../dto/passkey-summary.dto';

/** What a passkey looks like outside the server: no key, no counter, no id. */
export function toPasskeySummary(passkey: StoredPasskey): PasskeySummaryDto {
  return {
    id: passkey.id,
    name: passkey.name,
    deviceType: passkey.deviceType,
    backedUp: passkey.backedUp,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt,
  };
}
