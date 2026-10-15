import { RelyingPartyScope, StoredPasskey } from '../stores/passkey.store';

/**
 * Every read about `rpId`: what is offered, accepted, counted or excluded.
 * Passkeys stored before 0026 have no relying party and were all made for
 * the web one, so only a scope for that id takes them in.
 */
export function relyingPartyScope(
  rpId: string,
  webRpId: string,
): RelyingPartyScope {
  return { rpId, includesUnmarked: rpId === webRpId };
}

/** The relying party a stored passkey belongs to. None stored means the web one. */
export function relyingPartyOf(
  passkey: Pick<StoredPasskey, 'rpId'>,
  webRpId: string,
): string {
  return passkey.rpId ?? webRpId;
}

/** Whether a ceremony at `rpId` may use this passkey at all. */
export function belongsTo(
  passkey: Pick<StoredPasskey, 'rpId'>,
  rpId: string,
  webRpId: string,
): boolean {
  return relyingPartyOf(passkey, webRpId) === rpId;
}
