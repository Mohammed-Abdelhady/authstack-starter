import { ConfigService } from '@nestjs/config';
import { partialMock } from '../../../common/testing/test-doubles.harness-spec';
import type { VerifiedPasskeyProof } from '../../contracts/types/passkey-proof';
import { PasskeyStore } from '../stores/passkey.store';
import { LegacyPasskeyFacts } from './legacy-passkey-facts';
import { PasskeyConfigService } from './passkey-config.service';

const USER_ID = 'user-one';
const APP_RP_ID = 'app.example.test';
const VERIFIED: VerifiedPasskeyProof = {
  userId: USER_ID,
  rpId: APP_RP_ID,
  credentialId: 'Y3JlZGVudGlhbC1vbmU',
  userVerified: true,
};

/** What the fact is given, and the account and relying party it is asked about. */
type Asked = [string, VerifiedPasskeyProof | undefined, string, string];

const NOT_VERIFIED: Asked[] = [
  ['no proof at all', undefined, USER_ID, APP_RP_ID],
  [
    'a touch without verification',
    { ...VERIFIED, userVerified: false },
    USER_ID,
    APP_RP_ID,
  ],
  ['a proof of another account', VERIFIED, 'user-two', APP_RP_ID],
  ['a proof for another relying party', VERIFIED, USER_ID, 'localhost'],
  [
    'a proof with no credential',
    { ...VERIFIED, credentialId: '' },
    USER_ID,
    APP_RP_ID,
  ],
];

describe('LegacyPasskeyFacts.userWasVerified', () => {
  const facts = new LegacyPasskeyFacts(
    partialMock<PasskeyStore>({}),
    new PasskeyConfigService(
      new ConfigService({ passkeys: { rpId: 'localhost' } }),
    ),
  );

  it('is true for a verified proof of the account, for an app relying party too', () => {
    expect(facts.userWasVerified(VERIFIED, USER_ID, APP_RP_ID)).toBe(true);
  });

  it.each(NOT_VERIFIED)('is false for %s', (_label, proof, userId, rpId) => {
    expect(facts.userWasVerified(proof, userId, rpId)).toBe(false);
  });
});
