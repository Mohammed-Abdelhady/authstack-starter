// feature:passkeys:start
import { assertionChallenge } from './utils/assertion-challenge';
// feature:passkeys:end
import { ErrorCode } from '../../common/enums/error-code.enum';
import { freshProofRefusal } from './utils/fresh-proof-refusal';

describe('fresh proof refusal', () => {
  // Failure: the caller is offered email proof where only a verified passkey satisfies policy.
  it.each([
    { requirePasskey: true, rp: true, methods: ['passkey'] },
    { requirePasskey: false, rp: true, methods: ['passkey', 'email-code'] },
    { requirePasskey: undefined, rp: false, methods: ['email-code'] },
    { requirePasskey: true, rp: false, methods: [] },
  ])(
    'offers only policy-compatible methods: $methods',
    ({ requirePasskey, rp, methods }) => {
      const refusal = freshProofRefusal({
        requirePasskey,
        passkeyRelyingParty: rp
          ? {
              rpId: 'staff.example.test',
              origins: ['https://staff.example.test'],
            }
          : null,
      });
      expect(refusal.getStatus()).toBe(401);
      expect(refusal.code).toBe(ErrorCode.REAUTH_REQUIRED);
      expect(refusal.details).toEqual({ required: 'fresh_proof', methods });
    },
  );
});

// feature:passkeys:start

describe('assertion challenge', () => {
  // Failure: a different value is hashed than the challenge WebAuthn authenticates.
  it('decodes clientDataJSON and hashes its challenge', () => {
    const clientDataJSON = Buffer.from(
      '{"type":"webauthn.get","challenge":"abc"}',
    ).toString('base64url');
    expect(assertionChallenge({ clientDataJSON })).toEqual({
      challenge: 'abc',
      challengeHash:
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
  });

  // Failure: malformed or absent client data supplies usable proof evidence.
  it.each([
    '{',
    '{}',
    'null',
    '[]',
    '{"challenge":null}',
    '{"challenge":123}',
    '{"challenge":""}',
  ])('refuses invalid client data %s', (json) => {
    expect(() =>
      assertionChallenge({
        clientDataJSON: Buffer.from(json).toString('base64url'),
      }),
    ).toThrow();
  });

  // Failure: a missing or malformed base64url envelope reaches verification.
  it.each([undefined, null, 123, '', '%%%%'])(
    'refuses invalid encoding %s',
    (clientDataJSON) => {
      expect(() => assertionChallenge({ clientDataJSON })).toThrow();
    },
  );
});
// feature:passkeys:end
